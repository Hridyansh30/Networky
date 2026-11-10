import { describe, expect, it } from 'vitest';
import { formatIPv4, inSubnet, isUsableHost, maskToPrefix, parseCidr, parseIPv4, prefixToMask, subnetsOverlap } from './ip';

describe('ip', () => {
  it('parses and formats dotted quads', () => {
    expect(parseIPv4('192.168.1.10')).toBe(0xc0a8010a);
    expect(formatIPv4(0xc0a8010a)).toBe('192.168.1.10');
    expect(parseIPv4('255.255.255.255')).toBe(0xffffffff);
  });

  it.each(['300.1.1.1', '1.2.3', '1.2.3.4.5', 'a.b.c.d', '1.2.3.-4', '', '01.2.3.4444'])('rejects %s', (s) => {
    expect(parseIPv4(s)).toBeNull();
  });

  it('converts masks and prefixes', () => {
    expect(prefixToMask(24)).toBe('255.255.255.0');
    expect(prefixToMask(0)).toBe('0.0.0.0');
    expect(prefixToMask(32)).toBe('255.255.255.255');
    expect(maskToPrefix('255.255.255.192')).toBe(26);
    expect(maskToPrefix('255.0.255.0')).toBeNull();
  });

  it('checks subnet membership and overlap', () => {
    expect(inSubnet('192.168.1.200', '192.168.1.0', 24)).toBe(true);
    expect(inSubnet('192.168.2.1', '192.168.1.0', 24)).toBe(false);
    expect(subnetsOverlap('10.0.0.0', 8, '10.5.0.0', 16)).toBe(true);
    expect(subnetsOverlap('10.0.0.0', 24, '10.0.1.0', 24)).toBe(false);
  });

  it('knows network and broadcast addresses are not hosts', () => {
    expect(isUsableHost('192.168.1.0', 24)).toBe(false);
    expect(isUsableHost('192.168.1.255', 24)).toBe(false);
    expect(isUsableHost('192.168.1.1', 24)).toBe(true);
    expect(isUsableHost('10.0.0.0', 31)).toBe(true);
  });

  it('parses CIDR and mask notation', () => {
    expect(parseCidr('10.0.0.1/8')).toEqual({ address: '10.0.0.1', prefixLength: 8 });
    expect(parseCidr('10.0.0.1 255.255.0.0')).toEqual({ address: '10.0.0.1', prefixLength: 16 });
    expect(parseCidr('10.0.0.1/33')).toBeNull();
    expect(parseCidr('10.0.0.1')).toBeNull();
  });
});
