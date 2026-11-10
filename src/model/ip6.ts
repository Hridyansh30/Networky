// IPv6 helpers. 128-bit addresses don't fit in a JS number, so they are BigInts.

const MAX = (1n << 128n) - 1n;

export function parseIPv6(input: string): bigint | null {
  const s = input.trim().toLowerCase();
  if (!/^[0-9a-f:]+$/.test(s) || s.includes(':::')) return null;
  const halves = s.split('::');
  if (halves.length > 2) return null;
  const parse = (part: string) => (part === '' ? [] : part.split(':'));
  const head = parse(halves[0]);
  const tail = halves.length === 2 ? parse(halves[1]) : [];
  if ([...head, ...tail].some((g) => !/^[0-9a-f]{1,4}$/.test(g))) return null;
  const missing = 8 - head.length - tail.length;
  if (halves.length === 1 ? missing !== 0 : missing < 1) return null;
  const groups = [...head, ...Array(halves.length === 2 ? missing : 0).fill('0'), ...tail];
  return groups.reduce((acc, g) => (acc << 16n) | BigInt(parseInt(g, 16)), 0n);
}

export function isValidIPv6(s: string): boolean {
  return parseIPv6(s) !== null;
}

/** RFC 5952 canonical text: lowercase, no leading zeros, longest zero run as '::'. */
export function formatIPv6(n: bigint): string {
  const groups = Array.from({ length: 8 }, (_, i) => Number((n >> BigInt((7 - i) * 16)) & 0xffffn));
  let bestStart = -1;
  let bestLen = 0;
  for (let i = 0; i < 8; ) {
    if (groups[i] !== 0) {
      i++;
      continue;
    }
    let j = i;
    while (j < 8 && groups[j] === 0) j++;
    if (j - i > bestLen && j - i >= 2) {
      bestStart = i;
      bestLen = j - i;
    }
    i = j;
  }
  const hex = groups.map((g) => g.toString(16));
  if (bestStart < 0) return hex.join(':');
  return `${hex.slice(0, bestStart).join(':')}::${hex.slice(bestStart + bestLen).join(':')}`;
}

export function normalizeIPv6(s: string): string | null {
  const n = parseIPv6(s);
  return n === null ? null : formatIPv6(n);
}

export function maskV6(prefixLength: number): bigint {
  return prefixLength === 0 ? 0n : (MAX << BigInt(128 - prefixLength)) & MAX;
}

export function networkOfV6(address: string, prefixLength: number): bigint {
  return (parseIPv6(address) ?? 0n) & maskV6(prefixLength);
}

export function inSubnetV6(address: string, network: string, prefixLength: number): boolean {
  return networkOfV6(address, prefixLength) === networkOfV6(network, prefixLength);
}

/** Modified EUI-64: split the MAC, insert ff:fe, flip the universal/local bit. */
export function eui64(mac: string): bigint {
  const b = mac.split(':').map((x) => parseInt(x, 16));
  const bytes = [b[0] ^ 0x02, b[1], b[2], 0xff, 0xfe, b[3], b[4], b[5]];
  return bytes.reduce((acc, x) => (acc << 8n) | BigInt(x), 0n);
}

export function linkLocalFromMac(mac: string): string {
  return formatIPv6((0xfe80n << 112n) | eui64(mac));
}

export function slaacAddress(prefix: string, mac: string): string {
  return formatIPv6(networkOfV6(prefix, 64) | eui64(mac));
}

export function isLinkLocal(s: string): boolean {
  const n = parseIPv6(s);
  return n !== null && n >> 118n === 0xfe80n >> 6n;
}

export function isMulticastV6(s: string): boolean {
  const n = parseIPv6(s);
  return n !== null && n >> 120n === 0xffn;
}

/** NDP asks on ff02::1:ffXX:XXXX (last 24 bits of the target), not on a broadcast. */
export function solicitedNode(address: string): string {
  const n = parseIPv6(address) ?? 0n;
  return formatIPv6((0xff02n << 112n) | (1n << 32n) | (0xffn << 24n) | (n & 0xffffffn));
}

/** IPv6 multicast MAC: 33:33 + the last 32 bits of the group address. */
export function multicastMacV6(group: string): string {
  const n = parseIPv6(group) ?? 0n;
  const bytes = [0x33, 0x33, ...[24n, 16n, 8n, 0n].map((s) => Number((n >> s) & 0xffn))];
  return bytes.map((x) => x.toString(16).padStart(2, '0')).join(':');
}

export function parseCidr6(s: string): { address: string; prefixLength: number } | null {
  const m = s.trim().match(/^([0-9a-fA-F:]+)\s*\/\s*(\d{1,3})$/);
  if (!m) return null;
  const address = normalizeIPv6(m[1]);
  const prefixLength = Number(m[2]);
  if (!address || prefixLength > 128) return null;
  return { address, prefixLength };
}
