// Reading what a learner typed. Strict on purpose: a drill that accepts a
// sloppy answer teaches a habit that breaks on a real device.
//
//  - Leading zeros in an IPv4 octet are refused. `inet_aton` and many `ping`
//    builds read 010 as octal (8), so "10.010.0.1" is not the address it
//    looks like.
//  - Spaces around an answer are ignored; spaces inside are not.
//  - A prefix may be typed as "/21" or "21".

import { formatIPv4, maskToPrefix } from '../model/ip';
import { formatIPv6, parseIPv6 } from '../model/ip6';
import type { FieldFormat } from './types';

export type Parsed = { ok: true; value: string } | { ok: false; problem: string };

const ok = (value: string): Parsed => ({ ok: true, value });
const bad = (problem: string): Parsed => ({ ok: false, problem });

export function parseIPv4Strict(text: string): Parsed {
  const t = text.trim();
  if (!t) return bad('Empty.');
  const parts = t.split('.');
  if (parts.length !== 4) return bad('An IPv4 address has four numbers separated by dots.');
  let n = 0;
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) return bad('Each part is a number from 0 to 255.');
    if (p.length > 1 && p.startsWith('0')) return bad('No leading zeros: many tools read 010 as octal 8.');
    const v = Number(p);
    if (v > 255) return bad('Each part is a number from 0 to 255.');
    n = n * 256 + v;
  }
  return ok(formatIPv4(n));
}

export function parsePrefix(text: string): Parsed {
  const t = text.trim().replace(/^\//, '');
  if (!/^(0|[1-9]\d?)$/.test(t) || Number(t) > 32) return bad('A prefix length is a whole number from 0 to 32, like /24.');
  return ok(`/${Number(t)}`);
}

export function parseMask(text: string): Parsed {
  const a = parseIPv4Strict(text);
  if (!a.ok) return a;
  if (maskToPrefix(a.value) === null) return bad('Not a subnet mask: the 1 bits must all come first.');
  return a;
}

export function parseInteger(text: string): Parsed {
  const t = text.trim().replace(/,/g, '');
  if (!/^(0|[1-9]\d{0,9})$/.test(t)) return bad('A whole number, like 62.');
  return ok(String(Number(t)));
}

/** Any valid IPv6 text, returned in RFC 5952 form (lowercase, longest zero run as ::). */
export function parseIPv6Any(text: string): Parsed {
  const n = parseIPv6(text.trim());
  return n === null ? bad('Not a valid IPv6 address.') : ok(formatIPv6(n));
}

/** All eight groups written out with four hex digits each. */
export function parseIPv6Full(text: string): Parsed {
  const t = text.trim().toLowerCase();
  if (!/^[0-9a-f]{4}(:[0-9a-f]{4}){7}$/.test(t)) return bad('Write all 8 groups with 4 hex digits each, no ::.');
  return ok(t);
}

export function parseField(format: FieldFormat, text: string): Parsed {
  switch (format) {
    case 'ipv4':
      return parseIPv4Strict(text);
    case 'prefix':
      return parsePrefix(text);
    case 'mask':
      return parseMask(text);
    case 'integer':
      return parseInteger(text);
    case 'ipv6':
      return { ok: true, value: text.trim().toLowerCase() };
    case 'ipv6-full':
      return parseIPv6Full(text);
  }
}
