// Helpers for tests: build small networks in a few lines.
import { addDevice, connect, createTopology, setDefaultGateway, setInterfaceIp } from './ops';
import type { CableType, DeviceKind, Topology } from './types';

export class Builder {
  t: Topology = createTopology();

  add(kind: DeviceKind, hostname: string): string {
    const r = addDevice(this.t, kind, { id: hostname, hostname });
    this.t = r.topology;
    return r.deviceId;
  }

  port(deviceId: string, name: string): string {
    const id = this.t.devices[deviceId].interfaceIds.find((i) => this.t.interfaces[i].name === name);
    if (!id) throw new Error(`${deviceId} has no port ${name}`);
    return id;
  }

  link(a: [string, string], b: [string, string], cable: CableType = 'copper-straight'): string {
    const r = connect(this.t, this.port(...a), this.port(...b), cable);
    this.t = r.topology;
    return r.linkId;
  }

  ip(deviceId: string, port: string, cidr: string) {
    const [address, len] = cidr.split('/');
    this.t = setInterfaceIp(this.t, this.port(deviceId, port), { address, prefixLength: Number(len) });
  }
}

/** PC0 -- Switch0 -- Router0, all addressed in 192.168.1.0/24. */
export function smallLan(): Builder {
  const b = new Builder();
  b.add('pc', 'PC0');
  b.add('switch', 'Switch0');
  b.add('router', 'Router0');
  b.link(['PC0', 'FastEthernet0'], ['Switch0', 'FastEthernet0/1']);
  b.link(['Switch0', 'GigabitEthernet0/1'], ['Router0', 'GigabitEthernet0/0']);
  b.ip('PC0', 'FastEthernet0', '192.168.1.10/24');
  b.ip('Router0', 'GigabitEthernet0/0', '192.168.1.1/24');
  b.t = setDefaultGateway(b.t, 'PC0', '192.168.1.1');
  return b;
}

