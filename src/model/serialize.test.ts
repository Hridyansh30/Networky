import { describe, expect, it } from 'vitest';
import { addDevice, connect, createTopology, setInterfaceIp } from './ops';
import { deserialize, serialize } from './serialize';
import { smallLan } from './testing';
import type { Layout, Topology } from './types';

function tenDeviceNetwork(): { topology: Topology; layout: Layout } {
  let t = createTopology();
  const layout: Layout = {};
  const sw = addDevice(t, 'switch');
  t = sw.topology;
  layout[sw.deviceId] = { x: 0, y: 0 };
  for (let i = 0; i < 9; i++) {
    const r = addDevice(t, i === 8 ? 'router' : 'pc');
    t = r.topology;
    layout[r.deviceId] = { x: i * 100, y: 200 };
    const port = t.devices[r.deviceId].interfaceIds[0];
    t = connect(t, port, t.devices[sw.deviceId].interfaceIds[i], 'copper-straight').topology;
    t = setInterfaceIp(t, port, { address: `10.0.0.${i + 2}`, prefixLength: 24 });
  }
  return { topology: t, layout };
}

describe('serialize', () => {
  it('round-trips a 10-device network exactly', () => {
    const file = tenDeviceNetwork();
    expect(Object.keys(file.topology.devices)).toHaveLength(10);
    const back = deserialize(serialize(file));
    expect(back).toEqual(file);
  });

  it('rejects non-JSON and wrong shapes', () => {
    expect(() => deserialize('nope')).toThrow(/JSON/);
    expect(() => deserialize('{"format":"other"}')).toThrow(/Not a Networky file/);
    const bad = JSON.parse(serialize({ topology: smallLan().t, layout: {} }));
    bad.topology.links = { x: { id: 'x', a: 'missing', b: 'missing2', cable: 'copper-straight' } };
    expect(() => deserialize(JSON.stringify(bad))).toThrow(/inconsistent/);
  });
});
