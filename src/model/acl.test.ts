import { describe, expect, it } from 'vitest';
import { ANY_WILDCARD, evaluateAcl, formatRule, parseRule, wildcardMatch } from './acl';
import type { Acl } from './types';

describe('wildcard masks', () => {
  it.each([
    ['10.1.2.3', '10.1.2.0', '0.0.0.255', true],
    ['10.1.3.3', '10.1.2.0', '0.0.0.255', false],
    ['10.1.3.3', '10.1.2.0', '0.0.1.255', true], // /23
    ['8.8.8.8', '0.0.0.0', ANY_WILDCARD, true],
    ['10.0.0.5', '10.0.0.5', '0.0.0.0', true],
    ['10.0.0.6', '10.0.0.5', '0.0.0.0', false],
  ])('%s vs %s %s -> %s', (ip, addr, w, expected) => expect(wildcardMatch(ip, addr, w)).toBe(expected));
});

describe('parseRule / formatRule (IOS syntax round trip)', () => {
  it.each([
    ['permit any', 'standard'],
    ['deny host 10.0.0.5', 'standard'],
    ['permit 192.168.1.0 0.0.0.255', 'standard'],
    ['deny tcp 10.0.0.0 0.0.0.255 host 10.1.0.5 eq 80', 'extended'],
    ['permit udp any any eq 53', 'extended'],
    ['permit icmp any any', 'extended'],
    ['permit ip 10.0.0.0 0.255.255.255 any', 'extended'],
  ] as const)('%s', (text, type) => expect(formatRule(parseRule(text, type), type)).toBe(text));

  it('accepts named ports and a bare standard address as host', () => {
    expect(parseRule('permit tcp any any eq www', 'extended').dstPort).toBe(80);
    expect(parseRule('permit tcp any any eq ssh', 'extended').dstPort).toBe(22);
    expect(parseRule('deny 10.0.0.5', 'standard')).toMatchObject({ src: '10.0.0.5', srcWildcard: '0.0.0.0' });
  });

  it.each([
    ['allow any', 'standard', /permit' or 'deny/],
    ['permit gre any any', 'extended', /Unknown protocol/],
    ['permit 10.0.0.0 255.255.255.0', 'standard', /not a wildcard mask/], // a subnet mask by mistake
    ['permit ip 10.0.0.0 any', 'extended', /needs a wildcard/],
    ['permit icmp any any eq 80', 'extended', /tcp and udp/],
    ['permit tcp any any eq 70000', 'extended', /not a port/],
    ['permit any extra', 'standard', /Unexpected/],
    ['permit', 'standard', /Expected/],
  ] as const)('rejects %s', (text, type, err) => expect(() => parseRule(text, type)).toThrow(err));
});

describe('evaluateAcl', () => {
  const acl: Acl = { type: 'extended', rules: [parseRule('deny tcp any host 10.0.0.80 eq 22', 'extended'), parseRule('permit ip any any', 'extended')] };
  it('first match wins', () => {
    expect(evaluateAcl(acl, { protocol: 'tcp', src: '1.1.1.1', dst: '10.0.0.80', dstPort: 22 })).toEqual({ permit: false, index: 0 });
    expect(evaluateAcl(acl, { protocol: 'tcp', src: '1.1.1.1', dst: '10.0.0.80', dstPort: 80 })).toEqual({ permit: true, index: 1 });
  });
  it('the implicit deny is index -1', () => {
    expect(evaluateAcl({ type: 'standard', rules: [] }, { protocol: 'icmp', src: '1.1.1.1', dst: '2.2.2.2' })).toEqual({ permit: false, index: -1 });
  });
});
