// The architecture promise: every protocol is a plugin you can remove
// without breaking the others or the core.
import { describe, expect, it } from 'vitest';
import { setDefaultGateway } from '../../../model/ops';
import { Builder } from '../../../model/testing';
import { pingAndRun } from '../../testing';
import { Simulation } from '../../simulation';
import { DEFAULT_PLUGINS } from '..';

function routedLan() {
  const b = new Builder();
  for (const [k, n] of [['pc', 'PC0'], ['switch', 'S0'], ['router', 'R0'], ['switch', 'S1'], ['pc', 'PC1']] as const) b.add(k, n);
  b.link(['PC0', 'FastEthernet0'], ['S0', 'FastEthernet0/1']);
  b.link(['S0', 'GigabitEthernet0/1'], ['R0', 'GigabitEthernet0/0']);
  b.link(['R0', 'GigabitEthernet0/1'], ['S1', 'GigabitEthernet0/1']);
  b.link(['S1', 'FastEthernet0/1'], ['PC1', 'FastEthernet0']);
  b.ip('PC0', 'FastEthernet0', '10.1.0.10/24');
  b.ip('R0', 'GigabitEthernet0/0', '10.1.0.1/24');
  b.ip('R0', 'GigabitEthernet0/1', '10.2.0.1/24');
  b.ip('PC1', 'FastEthernet0', '10.2.0.10/24');
  b.t = setDefaultGateway(b.t, 'PC0', '10.1.0.1');
  b.t = setDefaultGateway(b.t, 'PC1', '10.2.0.1');
  return b;
}

describe('plugin architecture', () => {
  it('plugin names are unique', () => {
    const names = DEFAULT_PLUGINS.map((p) => p.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it.each(DEFAULT_PLUGINS.map((p) => [p.name]))('core IPv4 still works with %s removed', (name) => {
    const plugins = DEFAULT_PLUGINS.filter((p) => p.name !== name);
    const sim = new Simulation(routedLan().t, plugins).boot().run();
    expect(pingAndRun(sim, 'PC0', '10.2.0.10').status).toBe('success');
  });

  it('core IPv4 works with no plugins at all', () => {
    const sim = new Simulation(routedLan().t, []).boot().run();
    expect(pingAndRun(sim, 'PC0', '10.2.0.10').status).toBe('success');
  });

  it('removing a protocol removes only that protocol', () => {
    const sim = new Simulation(routedLan().t, DEFAULT_PLUGINS.filter((p) => p.name !== 'tcp')).boot().run();
    const p = sim.probe({ kind: 'tcp', sourceDeviceId: 'PC0', destination: '10.2.0.10', port: 80 });
    expect(p.status).toBe('unreachable');
    expect(p.detail).toMatch(/no plugin handles 'tcp'/);
  });
});
