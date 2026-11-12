// Import: paste one or more IOS configurations ('show running-config' output,
// or Networky's own Cisco export) and apply them.
//
// The importer does NOT parse IOS itself. It replays every line through the
// same CLI engine you type into (cli/ios.ts execute), in configuration mode.
// So an import can never do anything the CLI couldn't, the error messages are
// the CLI's own, and there is one parser to maintain, not two.
//
// What it adds on top of the CLI:
//   - sections: each 'hostname X' starts a device. An existing device with
//     that hostname receives the config; otherwise a router (or a switch, if
//     the config has switchport lines) is created.
//   - indentation: like IOS, an unindented line leaves any sub-mode.
//   - forward references: a top-level line that fails is retried once at the
//     end (IOS prints 'ip dhcp excluded-address' before the pool it belongs to).
//   - safety: exec commands (ping, copy, write, do ...) are never run, and
//     credentials (enable secret, username ...) are never imported.
//   - one undo step: everything runs on a copy; the caller applies the result.

import { execute, type CliEnv, type CliSession } from '../cli/ios';
import { addDevice, resetNetworkConfig } from '../model/ops';
import type { DeviceKind, Layout, Topology } from '../model/types';
import type { ImportNote, ImportOptions, ImportResult } from './types';

export const IMPORT_LIMITS = { bytes: 200_000, lines: 5_000, lineLength: 512, devices: 50 } as const;

/** Lines with no meaning in the simulator. Skipped with a note, never an error. */
const UNSUPPORTED = [
  'version', 'service', 'boot', 'boot-start-marker', 'boot-end-marker', 'aaa', 'no aaa', 'line', 'logging', 'ntp', 'snmp-server', 'clock',
  'license', 'crypto', 'ip domain', 'ip domain-name', 'no ip domain-lookup', 'no ip domain lookup', 'ip cef', 'no ip cef', 'ipv6 cef', 'memory',
  'control-plane', 'redundancy', 'spanning-tree mode', 'spanning-tree extend', 'vtp', 'cdp', 'no cdp', 'lldp', 'ip ssh', 'ip http', 'no ip http',
  'archive', 'multilink', 'ip forward-protocol', 'ip classless', 'login', 'diagnostic', 'platform', 'security', 'hardware', 'call-home', 'description', 'duplex', 'speed', 'media-type', 'negotiation',
];
/** Credentials: never imported, whatever the mode. */
const SECRET = ['enable secret', 'enable password', 'username', 'key chain', 'password', 'secret'];
/** Exec commands people paste along with configs. They are not configuration. */
const EXEC = ['enable', 'configure', 'conf', 'copy', 'write', 'wr', 'reload', 'do', 'ping', 'traceroute', 'show', 'end', 'disable', 'terminal'];
/** Banners and other noise at the top of 'show running-config' output. */
const BANNER_LINE = /^(Building configuration|Current configuration|Last configuration change|NVRAM config last updated)/i;

const startsWithWords = (line: string, phrase: string) => {
  const l = line.toLowerCase();
  return l === phrase || l.startsWith(phrase + ' ');
};
const matchAny = (line: string, list: string[]) => list.find((p) => startsWithWords(line, p));

interface Section {
  hostname: string;
  /** [1-based line number, raw line] */
  lines: [number, string][];
}

/** Split pasted text into device sections. Lines before the first 'hostname' go to `preamble`. */
export function splitSections(text: string): { sections: Section[]; preamble: [number, string][] } {
  const sections: Section[] = [];
  const preamble: [number, string][] = [];
  text.split(/\r?\n/).forEach((raw, k) => {
    const m = /^hostname\s+(\S+)\s*$/i.exec(raw);
    if (m) sections.push({ hostname: m[1], lines: [] });
    (sections.length ? sections[sections.length - 1].lines : preamble).push([k + 1, raw]);
  });
  return { sections, preamble };
}

function guessKind(lines: [number, string][]): DeviceKind {
  return lines.some(([, l]) => /^\s*(switchport|spanning-tree vlan)\b/i.test(l)) ? 'switch' : 'router';
}

/** An offline CliEnv over a private copy of the topology. Exec features refuse. */
function offlineEnv(start: Topology): CliEnv & { current(): Topology } {
  let t = start;
  const refuse = (): never => {
    throw new Error('not available while importing');
  };
  return {
    topology: () => t,
    apply: (change) => {
      t = change(t);
    },
    sim: refuse,
    probe: refuse,
    traceroute: refuse,
    current: () => t,
  };
}

/** A block: one top-level line and its indented children. */
interface Block {
  head: [number, string];
  children: [number, string][];
}

/**
 * 'banner motd ^C' starts free text that runs until the delimiter appears
 * again (IOS prints the ETX delimiter as the two characters ^C). That text is
 * not commands, so it is folded into the banner's block and never executed.
 */
function bannerDelimiter(line: string): string | null {
  const m = /^banner\s+\S+\s+(\^C|\S)(.*)$/i.exec(line.trim());
  if (!m) return null;
  return m[2].includes(m[1]) ? null : m[1]; // closed on the same line
}

function blocksOf(lines: [number, string][]): Block[] {
  const blocks: Block[] = [];
  let inBanner: string | null = null;
  for (const [n, raw] of lines) {
    if (inBanner) {
      blocks[blocks.length - 1].children.push([n, raw]);
      if (raw.includes(inBanner)) inBanner = null;
      continue;
    }
    if (!raw.trim() || raw.trim().startsWith('!')) continue;
    if (!/^\s/.test(raw)) inBanner = bannerDelimiter(raw);
    if (/^\s/.test(raw) && blocks.length) blocks[blocks.length - 1].children.push([n, raw]);
    else blocks.push({ head: [n, raw], children: [] });
  }
  return blocks;
}

/**
 * IOS also uses '%' for information: 'switchport access vlan 20' creating
 * VLAN 20, and syslog messages such as '%LINK-5-CHANGED: ...' after
 * 'no shutdown' (format %FACILITY-SEVERITY-MNEMONIC). Those are not errors.
 */
const INFORMATIONAL = [/Creating vlan/i, /^[A-Z][A-Z0-9_]*-[0-7]-[A-Z0-9_]+:/];

/** Errors the CLI printed for one line ('% ...'), without the caret line. */
const errorsOf = (output: string[]) =>
  output
    .filter((l) => l.trimStart().startsWith('%'))
    .map((l) => l.trim().replace(/^%\s*/, ''))
    .filter((l) => !INFORMATIONAL.some((re) => re.test(l)));

export function importCiscoConfig(topology: Topology, layout: Layout, text: string, options: ImportOptions): ImportResult {
  const notes: ImportNote[] = [];
  const fail = (text: string): ImportResult => ({ topology, layout, notes: [{ level: 'error', text }], devices: [] });

  if (text.length > IMPORT_LIMITS.bytes) return fail(`The text is larger than ${IMPORT_LIMITS.bytes / 1000} KB. Import one device or a few at a time.`);
  // Control characters other than tab, CR and LF have no place in a config.
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text)) return fail('The text contains control characters, so it is not a plain-text configuration.');
  const lineCount = text.split('\n').length;
  if (lineCount > IMPORT_LIMITS.lines) return fail(`The text has ${lineCount} lines; the limit is ${IMPORT_LIMITS.lines}.`);

  const { sections, preamble } = splitSections(text);
  if (!sections.length) return fail('No "hostname" line found. Each device configuration must start with "hostname <name>", as "show running-config" does.');
  if (sections.length > IMPORT_LIMITS.devices) return fail(`The text configures ${sections.length} devices; the limit is ${IMPORT_LIMITS.devices}.`);
  if (preamble.some(([, l]) => l.trim() && !l.trim().startsWith('!') && !BANNER_LINE.test(l.trim()) && !matchAny(l.trim(), EXEC)))
    notes.push({ level: 'skipped', text: 'Lines before the first "hostname" were ignored.' });

  const seen = new Set<string>();
  const env = offlineEnv(topology);
  const newLayout: Layout = { ...layout };
  const touched: string[] = [];

  // New devices go in a row under everything already on the canvas.
  const ys = Object.values(layout).map((p) => p.y);
  const xs = Object.values(layout).map((p) => p.x);
  let nextX = xs.length ? Math.min(...xs) : 0;
  const rowY = ys.length ? Math.max(...ys) + 220 : 0;

  for (const section of sections) {
    const key = section.hostname.toLowerCase();
    if (seen.has(key)) {
      notes.push({ level: 'error', line: section.lines[0][0], text: `"${section.hostname}" appears twice; only the first configuration was used.` });
      continue;
    }
    seen.add(key);

    let device = Object.values(env.current().devices).find((d) => d.hostname.toLowerCase() === key);
    if (device && device.kind !== 'router' && device.kind !== 'switch') {
      notes.push({ level: 'error', line: section.lines[0][0], text: `"${device.hostname}" is a ${device.kind}; only routers and switches take IOS configuration.` });
      continue;
    }
    if (!device) {
      const kind = guessKind(section.lines);
      try {
        const r = addDevice(env.current(), kind, { hostname: section.hostname });
        env.apply(() => r.topology);
        device = env.current().devices[r.deviceId];
        newLayout[device.id] = { x: nextX, y: rowY };
        nextX += 180;
        notes.push({ level: 'info', line: section.lines[0][0], text: `Created ${kind} ${section.hostname}. Connect its cables on the canvas: a configuration does not describe cabling.` });
      } catch (e) {
        notes.push({ level: 'error', line: section.lines[0][0], text: (e as Error).message });
        continue;
      }
    } else if (options.mode === 'replace') {
      env.apply((t) => resetNetworkConfig(t, device!.id));
      notes.push({ level: 'info', line: section.lines[0][0], text: `Reset ${device.hostname} to factory settings before applying (replace mode).` });
    }
    touched.push(device.hostname);
    const deviceId = device.id;

    const runBlock = (block: Block, report: boolean): boolean => {
      const [n, raw] = block.head;
      const line = raw.trim().slice(0, IMPORT_LIMITS.lineLength);
      // A skipped line never fails, so it is only seen once: always report it.
      const skipAll = (level: ImportNote['level'], why: string) => {
        notes.push({ level, line: n, text: `${line}: ${why}` });
        return true;
      };
      if (BANNER_LINE.test(line)) return true;
      if (matchAny(line, SECRET)) return skipAll('skipped', 'credentials are never imported.');
      if (matchAny(line, EXEC)) return startsWithWords(line, 'end') || startsWithWords(line, 'enable') || startsWithWords(line, 'configure') || startsWithWords(line, 'conf') ? true : skipAll('skipped', 'an exec command, not configuration, so it is not run.');
      if (startsWithWords(line, 'banner')) return skipAll('skipped', 'banners are not simulated.');
      if (matchAny(line, UNSUPPORTED)) return skipAll('skipped', 'not simulated in Networky.');

      let session: CliSession = { deviceId, mode: 'config' };
      const head = execute(session, line, env);
      const headErrors = errorsOf(head.output);
      if (headErrors.length) {
        if (report) {
          notes.push({ level: 'error', line: n, text: `${line}: ${headErrors.join(' ')}` });
          if (block.children.length) notes.push({ level: 'skipped', line: block.children[0][0], text: `${block.children.length} indented line${block.children.length === 1 ? '' : 's'} under it skipped.` });
        }
        return false;
      }
      session = head.session;
      for (const [cn, craw] of block.children) {
        const child = craw.trim().slice(0, IMPORT_LIMITS.lineLength);
        if (matchAny(child, SECRET)) {
          notes.push({ level: 'skipped', line: cn, text: `${child}: credentials are never imported.` });
          continue;
        }
        if (matchAny(child, UNSUPPORTED) || startsWithWords(child, 'exit-address-family')) {
          notes.push({ level: 'skipped', line: cn, text: `${child}: not simulated in Networky.` });
          continue;
        }
        if (startsWithWords(child, 'do')) {
          notes.push({ level: 'skipped', line: cn, text: `${child}: an exec command, not configuration, so it is not run.` });
          continue;
        }
        const r = execute(session, child, env);
        const errs = errorsOf(r.output);
        if (errs.length) notes.push({ level: 'error', line: cn, text: `${child}: ${errs.join(' ')}` });
        session = r.session;
      }
      return true;
    };

    // The 'hostname' line itself is the section header: the device already has it.
    const blocks = blocksOf(section.lines.slice(1));
    const failed = blocks.filter((b) => !runBlock(b, false));
    // Second pass: forward references (a line that needs something defined later).
    for (const b of failed) runBlock(b, true);
  }

  notes.sort((a, b) => (a.line ?? 0) - (b.line ?? 0));
  return { topology: env.current(), layout: newLayout, notes, devices: touched };
}
