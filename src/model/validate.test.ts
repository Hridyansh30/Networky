import { describe, expect, it } from 'vitest';
import { addStaticRoute, addSubinterface, setDefaultGateway, setInterfaceOptions, setNat, setOspf, setSwitchport } from './ops';
import type { Topology } from './types';
import { Builder, smallLan } from './testing';
import {
  cableMismatch,
  duplicateIp,
  gatewayOutsideSubnet,
  hostWithoutIp,
  isolatedDevice,
  routerOverlappingSubnets,
  unusableHostAddress,
  validate,
} from './validate';

// Each rule gets one network that triggers it and one that does not.

describe('validation rules', () => {
  it('a correct small LAN has no errors', () => {
    const issues = validate(smallLan().t);
    expect(issues.filter((i) => i.severity === 'error')).toEqual([]);
  });

  it('duplicate-ip', () => {
    const b = smallLan();
    expect(duplicateIp(b.t)).toEqual([]);
    b.add('pc', 'PC1');
    b.ip('PC1', 'FastEthernet0', '192.168.1.10/24');
    const issues = duplicateIp(b.t);
    expect(issues).toHaveLength(1);
    expect(issues[0].deviceIds.sort()).toEqual(['PC0', 'PC1']);
  });

  it('unusable-address', () => {
    const b = smallLan();
    expect(unusableHostAddress(b.t)).toEqual([]);
    b.ip('PC0', 'FastEthernet0', '192.168.1.255/24');
    expect(unusableHostAddress(b.t)).toHaveLength(1);
  });

  it('gateway-outside-subnet and gateway-is-self', () => {
    const b = smallLan();
    expect(gatewayOutsideSubnet(b.t)).toEqual([]);
    b.t = setDefaultGateway(b.t, 'PC0', '10.0.0.1');
    expect(gatewayOutsideSubnet(b.t)[0].rule).toBe('gateway-outside-subnet');
    b.t = setDefaultGateway(b.t, 'PC0', '192.168.1.10');
    expect(gatewayOutsideSubnet(b.t)[0].rule).toBe('gateway-is-self');
  });

  it('router-overlapping-subnets', () => {
    const b = smallLan();
    b.ip('Router0', 'GigabitEthernet0/1', '192.168.2.1/24');
    expect(routerOverlappingSubnets(b.t)).toEqual([]);
    b.ip('Router0', 'GigabitEthernet0/1', '192.168.1.129/25');
    expect(routerOverlappingSubnets(b.t)).toHaveLength(1);
  });

  it('host-without-ip', () => {
    const b = smallLan();
    expect(hostWithoutIp(b.t)).toEqual([]);
    b.add('pc', 'PC1');
    expect(hostWithoutIp(b.t)).toEqual([]); // not cabled yet: nothing to say
    b.link(['PC1', 'FastEthernet0'], ['Switch0', 'FastEthernet0/2']);
    expect(hostWithoutIp(b.t)).toHaveLength(1);
  });

  it('cable-mismatch is a warning', () => {
    const b = smallLan();
    expect(cableMismatch(b.t)).toEqual([]);
    b.add('switch', 'Switch1');
    b.link(['Switch0', 'FastEthernet0/3'], ['Switch1', 'FastEthernet0/1'], 'copper-straight');
    const issues = cableMismatch(b.t);
    expect(issues).toHaveLength(1);
    expect(issues[0].severity).toBe('warning');
  });

  it('isolated-device', () => {
    const b = smallLan();
    expect(isolatedDevice(b.t)).toEqual([]);
    b.add('server', 'Srv0');
    expect(isolatedDevice(b.t).map((i) => i.deviceIds[0])).toEqual(['Srv0']);
  });

  it('sorts errors before warnings', () => {
    const b = new Builder();
    b.add('pc', 'A');
    b.add('pc', 'B');
    b.ip('A', 'FastEthernet0', '10.0.0.1/24');
    b.ip('B', 'FastEthernet0', '10.0.0.1/24');
    const issues = validate(b.t);
    expect(issues[0].severity).toBe('error');
    expect(issues.at(-1)!.severity).toBe('warning');
  });

  it('static routes do not affect validation yet', () => {
    const b = smallLan();
    b.t = addStaticRoute(b.t, 'Router0', { prefix: '10.0.0.0', prefixLength: 8, nextHop: '192.168.1.2' });
    expect(validate(b.t).filter((i) => i.severity === 'error')).toEqual([]);
  });
});

describe('phase 3 rules', () => {
  const twoSwitches = () => {
    const b = new Builder();
    b.add('switch', 'S1');
    b.add('switch', 'S2');
    b.link(['S1', 'GigabitEthernet0/1'], ['S2', 'GigabitEthernet0/1'], 'copper-cross');
    return b;
  };
  const rules = (t: Topology) => validate(t).map((i) => i.rule);

  it('trunk on one side only', () => {
    const b = twoSwitches();
    b.t = setSwitchport(b.t, b.port('S1', 'GigabitEthernet0/1'), { mode: 'trunk', accessVlan: 1, nativeVlan: 1 });
    expect(rules(b.t)).toContain('trunk-mode-mismatch');
  });

  it('native VLAN mismatch', () => {
    const b = twoSwitches();
    b.t = setSwitchport(b.t, b.port('S1', 'GigabitEthernet0/1'), { mode: 'trunk', accessVlan: 1, nativeVlan: 1 });
    b.t = setSwitchport(b.t, b.port('S2', 'GigabitEthernet0/1'), { mode: 'trunk', accessVlan: 1, nativeVlan: 99 });
    expect(rules(b.t)).toContain('native-vlan-mismatch');
  });

  it('access ports in different VLANs between switches', () => {
    const b = twoSwitches();
    b.t = setSwitchport(b.t, b.port('S1', 'GigabitEthernet0/1'), { mode: 'access', accessVlan: 10, nativeVlan: 1 });
    expect(rules(b.t)).toContain('access-vlan-mismatch');
  });

  it('subinterfaces facing an access port', () => {
    const b = new Builder();
    b.add('switch', 'S1');
    b.add('router', 'R1');
    b.link(['S1', 'GigabitEthernet0/1'], ['R1', 'GigabitEthernet0/0']);
    b.t = addSubinterface(b.t, b.port('R1', 'GigabitEthernet0/0'), 10).topology;
    expect(rules(b.t)).toContain('subinterface-needs-trunk');
    b.t = setSwitchport(b.t, b.port('S1', 'GigabitEthernet0/1'), { mode: 'trunk', accessVlan: 1, nativeVlan: 1 });
    expect(rules(b.t)).not.toContain('subinterface-needs-trunk');
  });

  it('ACL applied but not defined; NAT without interfaces', () => {
    const b = smallLan();
    b.t = setInterfaceOptions(b.t, b.port('Router0', 'GigabitEthernet0/0'), { aclIn: '10' });
    b.t = setNat(b.t, 'Router0', { statics: [{ local: '192.168.1.10', global: '1.1.1.1' }] });
    expect(rules(b.t)).toEqual(expect.arrayContaining(['undefined-acl', 'nat-incomplete']));
  });

  it('a DHCP or SLAAC host is not "without an IP"', () => {
    const b = smallLan();
    b.t = setInterfaceOptions(b.t, b.port('PC0', 'FastEthernet0'), { dhcp: true });
    expect(rules(b.t)).not.toContain('host-without-ip');
  });

  it('duplicate IPv6 and multi-area OSPF', () => {
    const b = smallLan();
    const v6 = { ipv6: { address: '2001:db8::5', prefixLength: 64 } };
    b.t = setInterfaceOptions(b.t, b.port('PC0', 'FastEthernet0'), v6);
    b.t = setInterfaceOptions(b.t, b.port('Router0', 'GigabitEthernet0/0'), v6);
    b.t = setOspf(b.t, 'Router0', { networks: [{ prefix: '10.0.0.0', prefixLength: 8, area: 0 }, { prefix: '192.168.0.0', prefixLength: 16, area: 1 }] });
    expect(rules(b.t)).toEqual(expect.arrayContaining(['duplicate-ipv6', 'ospf-multi-area']));
  });
});
