// Access control lists on router interfaces.
//
// 'ip access-group 101 in' filters packets as they ENTER an interface,
// before routing. 'out' filters them as they LEAVE, after routing (and after
// NAT). Rules are checked top to bottom, first match wins, and an invisible
// "deny any" ends every list.
//
// Like IOS: an ACL that is applied but not defined permits everything, and
// packets the router itself originates are not filtered outbound.
// A denied packet is answered with ICMP "administratively prohibited"
// (that's the U.U.U. you see in a Cisco ping).

import { evaluateAcl, formatRule, type AclPacket } from '../../model/acl';
import type { Device, Interface } from '../../model/types';
import { flowPorts, type Ipv4Packet } from '../packets';
import type { EnginePlugin, SimApi, Verdict } from '../plugin';

/** device -> acl name -> hits per rule (last slot = implicit deny) */
type Hits = Record<string, Record<string, number[]>>;

const hitsState = (sim: SimApi) => sim.state<Hits>('acl', () => ({}));

export function aclHits(sim: SimApi, deviceId: string, name: string): number[] {
  return hitsState(sim)[deviceId]?.[name] ?? [];
}

function toAclPacket(p: Ipv4Packet): AclPacket {
  return { protocol: p.l4.proto, src: p.src, dst: p.dst, dstPort: p.l4.proto === 'icmp' ? undefined : flowPorts(p.l4).dst };
}

function check(sim: SimApi, router: Device, iface: Interface, name: string | undefined, dir: 'in' | 'out', packet: Ipv4Packet): Verdict {
  if (!name) return { action: 'pass', packet };
  const acl = router.acls?.[name];
  if (!acl) return { action: 'pass', packet }; // IOS: an undefined ACL permits everything
  const result = evaluateAcl(acl, toAclPacket(packet));
  const hits = ((hitsState(sim)[router.id] ??= {})[name] ??= Array(acl.rules.length + 1).fill(0));
  hits[result.index < 0 ? acl.rules.length : result.index]++;
  const which = result.index < 0 ? 'the implicit deny at the end' : `rule ${result.index + 1} '${formatRule(acl.rules[result.index], acl.type)}'`;
  if (result.permit) {
    sim.logEvent({ deviceId: router.id, kind: 'info', text: `${router.hostname} ACL ${name} ${dir} on ${iface.name}: permitted by ${which}` });
    return { action: 'pass', packet };
  }
  return { action: 'drop', reason: `denied by ACL ${name} (${which})`, icmp: 'admin' };
}

export const aclPlugin: EnginePlugin = {
  name: 'acl',
  description: 'Access lists: standard and extended, applied in or out on router interfaces',
  // Inbound ACL runs before NAT translates the destination.
  ingressPriority: 10,
  ipv4Ingress(sim, router, iface, packet) {
    return check(sim, router, iface, iface.aclIn, 'in', packet);
  },
  // Outbound ACL runs after NAT (it sees the translated, global source).
  egressPriority: 20,
  ipv4Egress(sim, router, ctx, packet) {
    if (!ctx.ingress) return { action: 'pass', packet }; // router-originated: not filtered
    return check(sim, router, ctx.egress, ctx.egress.aclOut, 'out', packet);
  },
};
