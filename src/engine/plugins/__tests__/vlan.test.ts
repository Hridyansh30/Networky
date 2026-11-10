import { describe, expect, it } from 'vitest';
import { addSubinterface, setDefaultGateway, setInterfaceIp, setSwitchport } from '../../../model/ops';
import { Builder } from '../../../model/testing';
import { boot, pingAndRun } from '../../testing';
import { isIpv4 } from '../../packets';

/** One switch, PC0 + PC2 in VLAN 10, PC1 in VLAN 20, all in one IP subnet on purpose. */
function vlanLan() {
  const b = new Builder();
  b.add('switch', 'S0');
  for (const [pc, port, ip] of [['PC0', 'FastEthernet0/1', '.10'], ['PC1', 'FastEthernet0/2', '.11'], ['PC2', 'FastEthernet0/3', '.12']] as const) {
    b.add('pc', pc);
    b.link([pc, 'FastEthernet0'], ['S0', port]);
    b.ip(pc, 'FastEthernet0', `192.168.1${ip}/24`);
  }
  b.t = setSwitchport(b.t, b.port('S0', 'FastEthernet0/1'), { mode: 'access', accessVlan: 10, nativeVlan: 1 });
  b.t = setSwitchport(b.t, b.port('S0', 'FastEthernet0/2'), { mode: 'access', accessVlan: 20, nativeVlan: 1 });
  b.t = setSwitchport(b.t, b.port('S0', 'FastEthernet0/3'), { mode: 'access', accessVlan: 10, nativeVlan: 1 });
  return b;
}

describe('VLANs', () => {
  it('hosts in the same VLAN talk', () => {
    const b = vlanLan();
    expect(pingAndRun(boot(b.t), 'PC0', '192.168.1.12').status).toBe('success');
  });

  it('a VLAN is a separate broadcast domain even with matching IPs', () => {
    const b = vlanLan();
    const sim = boot(b.t);
    const p = pingAndRun(sim, 'PC0', '192.168.1.11');
    expect(p.status).toBe('unreachable');
    // PC1 never even saw the ARP broadcast
    const pc1Port = b.port('PC1', 'FastEthernet0');
    expect(sim.log.some((e) => e.deviceId === 'PC1' && e.kind === 'receive')).toBe(false);
    expect(pc1Port).toBeTruthy();
  });

  it('MAC table entries are learned per VLAN', () => {
    const b = vlanLan();
    const sim = boot(b.t);
    pingAndRun(sim, 'PC0', '192.168.1.12');
    const vlans = new Set(Object.values(sim.mac['S0'] ?? {}).map((e) => e.vlan));
    expect(vlans).toEqual(new Set([10]));
  });
});

/**
 * Router-on-a-stick:
 *   PC10 (VLAN 10) -- S0 Fa0/1      S0 Gi0/1 (trunk) -- R0 Gi0/0 (.10 and .20 subinterfaces)
 *   PC20 (VLAN 20) -- S0 Fa0/2
 */
function onAStick() {
  const b = new Builder();
  b.add('switch', 'S0');
  b.add('router', 'R0');
  b.add('pc', 'PC10');
  b.add('pc', 'PC20');
  b.link(['PC10', 'FastEthernet0'], ['S0', 'FastEthernet0/1']);
  b.link(['PC20', 'FastEthernet0'], ['S0', 'FastEthernet0/2']);
  b.link(['S0', 'GigabitEthernet0/1'], ['R0', 'GigabitEthernet0/0']);
  b.t = setSwitchport(b.t, b.port('S0', 'FastEthernet0/1'), { mode: 'access', accessVlan: 10, nativeVlan: 1 });
  b.t = setSwitchport(b.t, b.port('S0', 'FastEthernet0/2'), { mode: 'access', accessVlan: 20, nativeVlan: 1 });
  b.t = setSwitchport(b.t, b.port('S0', 'GigabitEthernet0/1'), { mode: 'trunk', accessVlan: 1, nativeVlan: 1 });
  const parent = b.port('R0', 'GigabitEthernet0/0');
  for (const v of [10, 20]) {
    const r = addSubinterface(b.t, parent, v);
    b.t = setInterfaceIp(r.topology, r.interfaceId, { address: `10.0.${v}.1`, prefixLength: 24 });
  }
  b.ip('PC10', 'FastEthernet0', '10.0.10.5/24');
  b.ip('PC20', 'FastEthernet0', '10.0.20.5/24');
  b.t = setDefaultGateway(b.t, 'PC10', '10.0.10.1');
  b.t = setDefaultGateway(b.t, 'PC20', '10.0.20.1');
  return b;
}

describe('trunks and router-on-a-stick', () => {
  it('routes between VLANs through 802.1Q subinterfaces', () => {
    const sim = boot(onAStick().t);
    expect(pingAndRun(sim, 'PC10', '10.0.20.5').status).toBe('success');
  });

  it('tags frames on the trunk and only there', () => {
    const b = onAStick();
    const sim = boot(b.t);
    const trunkSide = b.port('S0', 'GigabitEthernet0/1');
    const accessSide = b.port('S0', 'FastEthernet0/1');
    const seen: { from: string; vlan?: number }[] = [];
    sim.ping('PC10', '10.0.20.5');
    while (!sim.isIdle()) for (const tx of sim.step()) if (isIpv4(tx.frame.payload)) seen.push({ from: tx.fromIf, vlan: tx.frame.vlan });
    const onTrunk = seen.filter((s) => s.from === trunkSide || s.from === b.port('R0', 'GigabitEthernet0/0'));
    expect(onTrunk.length).toBeGreaterThan(0);
    expect(onTrunk.every((s) => s.vlan === 10 || s.vlan === 20)).toBe(true);
    expect(seen.filter((s) => s.from === accessSide).every((s) => s.vlan === undefined)).toBe(true);
  });

  it('a trunk that does not allow a VLAN cuts it off', () => {
    const b = onAStick();
    b.t = setSwitchport(b.t, b.port('S0', 'GigabitEthernet0/1'), { mode: 'trunk', accessVlan: 1, nativeVlan: 1, allowedVlans: [10] });
    const sim = boot(b.t);
    expect(pingAndRun(sim, 'PC10', '10.0.10.1').status).toBe('success');
    expect(pingAndRun(sim, 'PC20', '10.0.20.1').status).toBe('unreachable');
  });
});
