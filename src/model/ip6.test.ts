import { describe, expect, it } from 'vitest';
import { eui64, formatIPv6, inSubnetV6, isLinkLocal, isMulticastV6, isValidIPv6, linkLocalFromMac, multicastMacV6, normalizeIPv6, parseCidr6, parseIPv6, slaacAddress, solicitedNode } from './ip6';

describe('IPv6 text forms (RFC 4291 / RFC 5952)', () => {
  it.each([
    ['2001:0db8:0000:0000:0000:0000:0000:0001', '2001:db8::1'],
    ['2001:DB8::1', '2001:db8::1'], // lower case
    ['2001:db8:0:0:1:0:0:1', '2001:db8::1:0:0:1'], // first longest run wins
    ['2001:db8:0:1:1:1:1:1', '2001:db8:0:1:1:1:1:1'], // a single 0 group is not compressed
    ['::', '::'],
    ['::1', '::1'],
    ['fe80::', 'fe80::'],
  ])('%s -> %s', (input, out) => expect(normalizeIPv6(input)).toBe(out));

  it.each(['', ':::', '2001:db8::1::2', '1:2:3:4:5:6:7:8:9', 'g::1', '12345::', '1:2:3:4:5:6:7'])('rejects %s', (s) => expect(isValidIPv6(s)).toBe(false));

  it('round-trips through a bigint', () => {
    expect(formatIPv6(parseIPv6('2001:db8:85a3::8a2e:370:7334')!)).toBe('2001:db8:85a3::8a2e:370:7334');
  });
});

describe('EUI-64, link-local and SLAAC', () => {
  // RFC 4291 appendix A: insert ff:fe in the middle and flip the U/L bit
  it('builds the interface id from a MAC', () => {
    expect(eui64('00:1a:2b:3c:4d:5e').toString(16)).toBe('21a2bfffe3c4d5e');
    expect(linkLocalFromMac('00:1a:2b:3c:4d:5e')).toBe('fe80::21a:2bff:fe3c:4d5e');
    expect(slaacAddress('2001:db8:1::', '00:1a:2b:3c:4d:5e')).toBe('2001:db8:1:0:21a:2bff:fe3c:4d5e');
  });

  it('classifies addresses', () => {
    expect(isLinkLocal('fe80::1')).toBe(true);
    expect(isLinkLocal('2001:db8::1')).toBe(false);
    expect(isMulticastV6('ff02::1')).toBe(true);
    expect(isMulticastV6('fe80::1')).toBe(false);
  });

  it('solicited-node group and its MAC (RFC 4291 2.7.1, RFC 2464 7)', () => {
    expect(solicitedNode('2001:db8::1:2345:6789')).toBe('ff02::1:ff45:6789');
    expect(multicastMacV6('ff02::1:ff45:6789')).toBe('33:33:ff:45:67:89');
    expect(multicastMacV6('ff02::1')).toBe('33:33:00:00:00:01');
  });

  it('subnets and CIDR', () => {
    expect(inSubnetV6('2001:db8:1::99', '2001:db8:1::', 64)).toBe(true);
    expect(inSubnetV6('2001:db8:2::99', '2001:db8:1::', 64)).toBe(false);
    expect(parseCidr6('2001:DB8::1/64')).toEqual({ address: '2001:db8::1', prefixLength: 64 });
    expect(parseCidr6('2001:db8::1/129')).toBeNull();
  });
});
