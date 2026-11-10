// Save / load. A .networky file is UNTRUSTED input: someone may hand a
// classmate a crafted file. Loading goes through three gates:
//
//   1. Size: refuse huge files before parsing (a 500 MB JSON would freeze the tab).
//   2. Schema (Zod, .strict()): every field has a type, a format and a bound.
//      Unknown keys are REJECTED rather than silently dropped, so a typo or an
//      injected field is reported. Strings are length-capped; addresses must
//      parse; counts are capped so the simulator cannot be made to loop forever.
//   3. Invariants (checkIntegrity): references point at things that exist,
//      links are symmetric, and so on.
//
// Prototype pollution: JSON.parse turns {"__proto__": ...} into an ordinary
// own key, but copying such a key into a fresh object later (Zod records,
// Immer drafts) can replace that object's prototype. Every record key must
// therefore match a strict id pattern AND equal the id stored inside it,
// and the reserved names are refused outright.
//
// What the file cannot do: it holds data only. No field is ever executed or
// rendered as HTML (React escapes all text), so there is no script injection.

import { z } from 'zod';
import { isValidIPv4 } from './ip';
import { isValidIPv6, normalizeIPv6 } from './ip6';
import { checkIntegrity } from './ops';
import { dnsServerSchema, servicesSchema } from './servicesSchema';
import type { Layout, Topology } from './types';

export const LIMITS = {
  fileBytes: 2_000_000,
  devices: 300,
  interfaces: 6_000,
  links: 3_000,
  listItems: 256, // routes, ACL rules, pools, networks...
  acls: 64,
  coordinate: 1_000_000,
} as const;

const RESERVED = new Set(['__proto__', 'constructor', 'prototype']);

class ReservedKeyError extends Error {
  constructor(readonly key: string) {
    super(key);
  }
}
const ID = /^[A-Za-z0-9_-]{1,64}$/;

const id = z.string().regex(ID, 'ids use letters, digits, _ and -').refine((s) => !RESERVED.has(s), 'reserved name');
const text = (max: number) => z.string().max(max).regex(/^[^\u0000-\u001f\u007f]*$/, 'control characters are not allowed');
const ipv4 = z.string().max(15).refine(isValidIPv4, 'not an IPv4 address');
const ipv6 = z.string().max(45).refine(isValidIPv6, 'not an IPv6 address').transform((s) => normalizeIPv6(s)!);
const mac = z.string().regex(/^([0-9a-f]{2}:){5}[0-9a-f]{2}$/, 'not a MAC address');
const vlan = z.number().int().min(1).max(4094);
const list = <T extends z.ZodTypeAny>(item: T) => z.array(item).max(LIMITS.listItems);

/** A Record<string, T> whose keys are safe ids, equal to each value's own `id`. */
function recordById<T extends z.ZodObject<{ id: typeof id }>>(value: T, max: number) {
  return z
    .record(id, value)
    .refine((r) => Object.keys(r).length <= max, `at most ${max} entries`)
    .refine((r) => Object.entries(r).every(([k, v]) => k === v.id), 'every key must equal its id');
}

const ipv4Config = z.object({ address: ipv4, prefixLength: z.number().int().min(0).max(32) }).strict();
const ipv6Config = z.object({ address: ipv6, prefixLength: z.number().int().min(1).max(128) }).strict();
const staticRoute = z.object({ prefix: ipv4, prefixLength: z.number().int().min(0).max(32), nextHop: ipv4 }).strict();
const staticRouteV6 = z.object({ prefix: ipv6, prefixLength: z.number().int().min(0).max(128), nextHop: ipv6 }).strict();
const network = z.object({ prefix: ipv4, prefixLength: z.number().int().min(0).max(32) }).strict();

const aclRule = z
  .object({
    action: z.enum(['permit', 'deny']),
    protocol: z.enum(['ip', 'icmp', 'tcp', 'udp']),
    src: ipv4,
    srcWildcard: ipv4,
    dst: ipv4.optional(),
    dstWildcard: ipv4.optional(),
    dstPort: z.number().int().min(1).max(65535).optional(),
  })
  .strict();

const aclName = z.string().regex(/^[A-Za-z0-9_-]{1,32}$/).refine((s) => !RESERVED.has(s), 'reserved name');

const device = z
  .object({
    id,
    kind: z.enum(['pc', 'laptop', 'server', 'hub', 'switch', 'router']),
    hostname: text(63).min(1),
    interfaceIds: z.array(id).max(64),
    defaultGateway: ipv4.optional(),
    staticRoutes: list(staticRoute).optional(),
    defaultGatewayV6: ipv6.optional(),
    stpPriority: z.number().int().min(0).max(61440).multipleOf(4096).optional(),
    dhcpPools: list(
      z
        .object({
          name: text(32).min(1),
          network: ipv4,
          prefixLength: z.number().int().min(0).max(30),
          defaultRouter: ipv4.optional(),
          dnsServer: ipv4.optional(),
          excluded: list(ipv4).optional(),
        })
        .strict(),
    ).optional(),
    acls: z
      .record(aclName, z.object({ type: z.enum(['standard', 'extended']), rules: list(aclRule) }).strict())
      .refine((r) => Object.keys(r).length <= LIMITS.acls, `at most ${LIMITS.acls} ACLs`)
      .optional(),
    nat: z
      .object({
        statics: list(z.object({ local: ipv4, global: ipv4 }).strict()),
        overload: z.object({ acl: aclName, outsideInterfaceId: id }).strict().optional(),
      })
      .strict()
      .optional(),
    rip: z.object({ networks: list(network) }).strict().optional(),
    ospf: z
      .object({
        routerId: ipv4.optional(),
        networks: list(network.extend({ area: z.number().int().min(0).max(4294967295) })),
      })
      .strict()
      .optional(),
    ipv6StaticRoutes: list(staticRouteV6).optional(),
    dnsServer: dnsServerSchema.optional(),
    services: servicesSchema.optional(),
  })
  .strict();

const iface = z
  .object({
    id,
    deviceId: id,
    name: text(48).min(1),
    portType: z.enum(['fastethernet', 'gigabitethernet', 'serial', 'fiber']),
    mac,
    ipv4: ipv4Config.optional(),
    adminUp: z.boolean(),
    linkId: id.optional(),
    switchport: z
      .object({ mode: z.enum(['access', 'trunk']), accessVlan: vlan, nativeVlan: vlan, allowedVlans: z.array(vlan).max(4094).optional() })
      .strict()
      .optional(),
    parentId: id.optional(),
    vlanTag: vlan.optional(),
    dhcp: z.boolean().optional(),
    ipv6: ipv6Config.optional(),
    ipv6Auto: z.boolean().optional(),
    aclIn: aclName.optional(),
    aclOut: aclName.optional(),
    nat: z.enum(['inside', 'outside']).optional(),
    helperAddress: ipv4.optional(),
    ospfCost: z.number().int().min(1).max(65535).optional(),
  })
  .strict();

const link = z.object({ id, a: id, b: id, cable: z.enum(['copper-straight', 'copper-cross', 'fiber', 'serial']) }).strict();

const topologySchema = z
  .object({
    version: z.literal(1),
    devices: recordById(device, LIMITS.devices),
    interfaces: recordById(iface, LIMITS.interfaces),
    links: recordById(link, LIMITS.links),
  })
  .strict();

const coord = z.number().finite().min(-LIMITS.coordinate).max(LIMITS.coordinate);

const fileSchema = z
  .object({
    format: z.literal('networky'),
    topology: topologySchema,
    layout: z.record(id, z.object({ x: coord, y: coord }).strict()),
  })
  .strict();

export interface NetworkyFile {
  topology: Topology;
  layout: Layout;
}

export function serialize(file: NetworkyFile): string {
  return JSON.stringify({ format: 'networky', topology: file.topology, layout: file.layout }, null, 2);
}

export function deserialize(text: string): NetworkyFile {
  // length counts UTF-16 units; a cheap upper bound check before parsing
  if (text.length > LIMITS.fileBytes) throw new Error(`File is too large (limit ${LIMITS.fileBytes / 1_000_000} MB)`);
  let raw: unknown;
  try {
    // The reviver sees every key as JSON.parse creates it, BEFORE anything
    // copies it. Zod's record copy does `out[key] = value`, and for the key
    // '__proto__' that assignment swaps the object's prototype instead of adding
    // a key, which no schema check after the fact can see. So refuse it here.
    raw = JSON.parse(text, (key, value) => {
      if (RESERVED.has(key)) throw new ReservedKeyError(key);
      return value;
    });
  } catch (e) {
    if (e instanceof ReservedKeyError) throw new Error(`Not a Networky file: the key '${e.key}' is reserved and not allowed`);
    throw new Error('File is not valid JSON');
  }
  const parsed = fileSchema.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    throw new Error(`Not a Networky file: ${first.path.join('.') || '(root)'}: ${first.message}`);
  }
  const topology = parsed.data.topology as Topology;
  const problems = checkIntegrity(topology);
  if (problems.length) throw new Error(`File is inconsistent: ${problems[0]}`);
  // Layout entries for devices that don't exist are dropped, not trusted.
  const layout: Layout = {};
  for (const [k, v] of Object.entries(parsed.data.layout)) if (topology.devices[k]) layout[k] = v;
  return { topology, layout };
}
