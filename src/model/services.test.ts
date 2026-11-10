import { describe, expect, it } from 'vitest';
import { addDevice, createTopology } from './ops';
import { deserialize, serialize } from './serialize';
import { defaultServerServices, servicesOf, setDnsServer, setServices } from './services';

function withServer() {
  const r = addDevice(createTopology(), 'server', { id: 'SRV', hostname: 'SRV' });
  const pc = addDevice(r.topology, 'pc', { id: 'PC0', hostname: 'PC0' });
  return pc.topology;
}

describe('services model', () => {
  it('a new server runs a web server with a welcome page; a PC runs nothing', () => {
    const t = withServer();
    expect(servicesOf(t.devices.SRV).http?.enabled).toBe(true);
    expect(servicesOf(t.devices.SRV).http?.pages[0].path).toBe('/index.html');
    expect(servicesOf(t.devices.PC0)).toEqual({});
  });

  it('round-trips through a saved file', () => {
    let t = withServer();
    t = setServices(t, 'SRV', { ...defaultServerServices(t.devices.SRV), dns: { enabled: true, records: [{ name: 'www.lab', type: 'A', address: '10.0.0.5' }] } });
    t = setDnsServer(t, 'PC0', '10.0.0.5');
    const back = deserialize(serialize({ topology: t, layout: {} }));
    expect(back.topology.devices.SRV.services).toEqual(t.devices.SRV.services);
    expect(back.topology.devices.PC0.dnsServer).toBe('10.0.0.5');
  });

  it('refuses bad values in the editor and in a loaded file', () => {
    const t = withServer();
    const bad = (s: object) => () => setServices(t, 'SRV', s as never);
    expect(bad({ http: { enabled: true, pages: [{ path: 'no-slash', title: '', body: '' }] } })).toThrow(/page path/);
    expect(bad({ dns: { enabled: true, records: [{ name: 'Bad Name', type: 'A', address: '10.0.0.1' }] } })).toThrow(/host name/);
    expect(bad({ mail: { enabled: true, domain: 'lab', accounts: [{ user: '__proto__', password: 'x' }] } })).toThrow(/user name/);
    expect(bad({ ftp: { enabled: true, accounts: [], files: [{ name: '../etc', content: '' }] } })).toThrow(/file name/);
    expect(() => setDnsServer(t, 'PC0', 'dns.lab')).toThrow(/IPv4/);

    const file = JSON.parse(serialize({ topology: t, layout: {} }));
    file.topology.devices.SRV.services = { http: { enabled: true, pages: [], script: 'alert(1)' } };
    expect(() => deserialize(JSON.stringify(file))).toThrow();
    file.topology.devices.SRV.services = { mail: { enabled: true, domain: 'lab', accounts: [{ user: 'a', password: 'x' }, { user: 'a', password: 'y' }] } };
    expect(() => deserialize(JSON.stringify(file))).toThrow();
  });
});
