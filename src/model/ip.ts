// IPv4 helpers. Addresses are handled as unsigned 32-bit numbers,
// which turns subnet math into bit masks.

export function parseIPv4(s: string): number | null {
  const parts = s.trim().split('.');
  if (parts.length !== 4) return null;
  let n = 0;
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) return null;
    const v = Number(p);
    if (v > 255) return null;
    n = n * 256 + v; // not << : JS bit ops are signed 32-bit
  }
  return n;
}

export function formatIPv4(n: number): string {
  return [24, 16, 8, 0].map((s) => (n >>> s) & 255).join('.');
}

export function isValidIPv4(s: string): boolean {
  return parseIPv4(s) !== null;
}

export function isValidPrefix(p: number): boolean {
  return Number.isInteger(p) && p >= 0 && p <= 32;
}

export function prefixToMaskNum(prefix: number): number {
  return prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
}

export function prefixToMask(prefix: number): string {
  return formatIPv4(prefixToMaskNum(prefix));
}

/** '255.255.255.0' -> 24. Returns null for non-contiguous masks like 255.0.255.0. */
export function maskToPrefix(mask: string): number | null {
  const n = parseIPv4(mask);
  if (n === null) return null;
  const inverted = ~n >>> 0;
  // A valid mask's inverse is 0b000..0111..1, so inverse+1 is a power of two.
  if ((inverted & (inverted + 1)) !== 0) return null;
  return 32 - Math.log2(inverted + 1);
}

export function networkOf(address: string, prefix: number): number {
  return ((parseIPv4(address) ?? 0) & prefixToMaskNum(prefix)) >>> 0;
}

export function inSubnet(address: string, network: string, prefix: number): boolean {
  return networkOf(address, prefix) === networkOf(network, prefix);
}

/** Do two subnets overlap? They do if they match on the shorter prefix. */
export function subnetsOverlap(a: string, aLen: number, b: string, bLen: number): boolean {
  const len = Math.min(aLen, bLen);
  return networkOf(a, len) === networkOf(b, len);
}

/** For /0-/30, the all-zeros and all-ones host parts are reserved. /31 and /32 are special cases. */
export function isUsableHost(address: string, prefix: number): boolean {
  const n = parseIPv4(address);
  if (n === null) return false;
  if (prefix >= 31) return true;
  const mask = prefixToMaskNum(prefix);
  const host = (n & ~mask) >>> 0;
  return host !== 0 && host !== (~mask >>> 0);
}

/** Parses '192.168.1.10/24' or '192.168.1.10 255.255.255.0'. */
export function parseCidr(s: string): { address: string; prefixLength: number } | null {
  const t = s.trim();
  const m = t.match(/^(\S+)\s*\/\s*(\d{1,2})$/) ?? t.match(/^(\S+)\s+(\S+)$/);
  if (!m) return null;
  const [, addr, rest] = m;
  if (!isValidIPv4(addr)) return null;
  const prefix = /^\d{1,2}$/.test(rest) ? Number(rest) : maskToPrefix(rest);
  if (prefix === null || !isValidPrefix(prefix)) return null;
  return { address: formatIPv4(parseIPv4(addr)!), prefixLength: prefix };
}
