// The Config tab: everything about a device that you can set with forms.
// Each control calls one model op (see model/ops.ts), the same ops the CLI
// uses, so the forms and the CLI can never disagree.

import { useState } from 'react';
import { parseVlanList } from '../../cli/parse';
import { formatRule, parseRule } from '../../model/acl';
import { CATALOG, isHostKind } from '../../model/catalog';
import { isValidIPv4, parseCidr, prefixToMask } from '../../model/ip';
import { parseCidr6 } from '../../model/ip6';
import * as ops from '../../model/ops';
import type { Acl, Device, DhcpPool, Interface, Topology } from '../../model/types';
import { useSimStore } from '../../store/simStore';
import { CommitField } from '../CommitField';
import { Icon } from '../icons';
import { editTopology as edit } from './edit';

const SPEED: Record<Interface['portType'], string> = { fastethernet: '100 Mbps', gigabitethernet: '1 Gbps', fiber: '1 Gbps', serial: '1.544 Mbps' };
const ifsOf = (t: Topology, d: Device) => d.interfaceIds.map((id) => t.interfaces[id]);

function Section({ title, hint, children, open = true }: { title: string; hint?: string; children: React.ReactNode; open?: boolean }) {
  return (
    <details className="cfg-section" open={open}>
      <summary>
        <Icon.ChevronRight size={16} className="chev" />
        <span>{title}</span>
        {hint && <small>{hint}</small>}
      </summary>
      <div className="cfg-body">{children}</div>
    </details>
  );
}

function Row({ label, children, help }: { label: string; children: React.ReactNode; help?: string }) {
  return (
    <div className="cfg-row">
      <span className="cfg-label" title={help}>
        {label}
      </span>
      {children}
    </div>
  );
}

const ErrorText = ({ text }: { text: string | null }) => (text ? <p className="field-error">{text}</p> : null);

export function ConfigTab({ device, topology }: { device: Device; topology: Topology }) {
  const template = CATALOG[device.kind];
  const host = isHostKind(device.kind);
  return (
    <div className="cfg">
      <Section title="General">
        <Row label="Hostname">
          <CommitField value={device.hostname} onCommit={(v) => edit((t) => ops.setHostname(t, device.id, v))} ariaLabel="Hostname" />
        </Row>
        {host && <HostAddressing device={device} topology={topology} />}
        {device.kind === 'switch' && (
          <Row label="STP priority" help="Lowest priority (then lowest MAC) becomes the root bridge">
            <select value={device.stpPriority ?? 32768} onChange={(e) => edit((t) => ops.setStpPriority(t, device.id, Number(e.target.value)))} aria-label="STP bridge priority">
              {Array.from({ length: 16 }, (_, k) => k * 4096).map((p) => (
                <option key={p} value={p}>
                  {p}
                  {p === 32768 ? ' (default)' : p === 0 ? ' (always root)' : ''}
                </option>
              ))}
            </select>
          </Row>
        )}
        {!template.l3 && (
          <p className="muted small">
            A {template.label.toLowerCase()} works at layer {template.layer}, so its ports have no IP address. It {device.kind === 'hub' ? 'repeats every bit out of every other port.' : 'forwards frames by MAC address, within a VLAN.'}
          </p>
        )}
      </Section>

      <Section title="Interfaces" hint={`${device.interfaceIds.length}`}>
        <InterfaceTable device={device} topology={topology} />
        {device.kind === 'router' && <AddSubinterface device={device} topology={topology} />}
      </Section>

      {device.kind === 'router' && (
        <>
          <Section title="Interface services" hint="ACL, NAT, DHCP relay, OSPF cost" open={false}>
            <InterfaceServices device={device} topology={topology} />
          </Section>
          <Section title="Static routes" hint={`${(device.staticRoutes ?? []).length + (device.ipv6StaticRoutes ?? []).length}`} open={!!device.staticRoutes?.length}>
            <StaticRoutes device={device} />
          </Section>
          <Section title="RIP" hint={device.rip ? 'on' : 'off'} open={!!device.rip}>
            <Rip device={device} />
          </Section>
          <Section title="OSPF" hint={device.ospf ? 'on' : 'off'} open={!!device.ospf}>
            <Ospf device={device} />
          </Section>
          <Section title="Access lists" hint={`${Object.keys(device.acls ?? {}).length}`} open={!!Object.keys(device.acls ?? {}).length}>
            <Acls device={device} />
          </Section>
          <Section title="NAT" hint={device.nat ? 'on' : 'off'} open={!!device.nat}>
            <Nat device={device} topology={topology} />
          </Section>
        </>
      )}
      {(device.kind === 'router' || device.kind === 'server') && (
        <Section title="DHCP server" hint={`${(device.dhcpPools ?? []).length} pools`} open={!!device.dhcpPools?.length}>
          <DhcpPools device={device} />
        </Section>
      )}
    </div>
  );
}

// ------------------------------------------------------------- hosts

function HostAddressing({ device, topology }: { device: Device; topology: Topology }) {
  const nic = ifsOf(topology, device)[0];
  const sim = useSimStore((s) => s.realtimeSim());
  const lease = nic && nic.dhcp ? sim.ipv4Of(sim.topology.interfaces[nic.id] ?? nic) : undefined;
  if (!nic) return null;
  return (
    <>
      <Row label="IPv4">
        <div className="seg" role="radiogroup" aria-label="IPv4 configuration">
          <button role="radio" aria-checked={!nic.dhcp} className={!nic.dhcp ? 'on' : ''} onClick={() => edit((t) => ops.setInterfaceOptions(t, nic.id, { dhcp: false }))}>
            Static
          </button>
          <button role="radio" aria-checked={!!nic.dhcp} className={nic.dhcp ? 'on' : ''} onClick={() => edit((t) => ops.setInterfaceOptions(t, nic.id, { dhcp: true }))}>
            DHCP
          </button>
        </div>
      </Row>
      {nic.dhcp ? (
        <p className="muted small">{lease ? `Leased ${lease.address}/${lease.prefixLength} from the DHCP server.` : 'No lease: no DHCP server answered on this network.'}</p>
      ) : (
        <Row label="Default gateway" help="Where this host sends traffic for other subnets: its router's address on this LAN">
          <CommitField value={device.defaultGateway ?? ''} placeholder="e.g. 192.168.1.1" ariaLabel="Default gateway" onCommit={(v) => edit((t) => ops.setDefaultGateway(t, device.id, v.trim() || undefined))} />
        </Row>
      )}
      <Row label="IPv6">
        <div className="seg" role="radiogroup" aria-label="IPv6 configuration">
          <button role="radio" aria-checked={!nic.ipv6Auto} className={!nic.ipv6Auto ? 'on' : ''} onClick={() => edit((t) => ops.setInterfaceOptions(t, nic.id, { ipv6Auto: false }))}>
            Static
          </button>
          <button role="radio" aria-checked={!!nic.ipv6Auto} className={nic.ipv6Auto ? 'on' : ''} onClick={() => edit((t) => ops.setInterfaceOptions(t, nic.id, { ipv6Auto: true }))}>
            SLAAC
          </button>
        </div>
      </Row>
      {!nic.ipv6Auto && (
        <Row label="IPv6 gateway">
          <CommitField value={device.defaultGatewayV6 ?? ''} placeholder="e.g. 2001:db8:1::1" ariaLabel="IPv6 default gateway" onCommit={(v) => edit((t) => ops.setDefaultGatewayV6(t, device.id, v.trim() || undefined))} />
        </Row>
      )}
    </>
  );
}

// ------------------------------------------------------------- interfaces

function InterfaceTable({ device, topology }: { device: Device; topology: Topology }) {
  const l3 = CATALOG[device.kind].l3;
  const isSwitch = device.kind === 'switch';
  return (
    <div className="table-wrap">
      <table className="data cfg-ifaces">
        <thead>
          <tr>
            <th>Interface</th>
            {l3 && <th>IPv4 / prefix</th>}
            {l3 && <th>IPv6 / prefix</th>}
            {isSwitch && <th>Mode</th>}
            {(isSwitch || device.kind === 'router') && <th>VLAN</th>}
            <th>Speed</th>
            <th title="Administrative state (shutdown / no shutdown)">On</th>
          </tr>
        </thead>
        <tbody>
          {ifsOf(topology, device).map((i) => (
            <InterfaceRow key={i.id} i={i} topology={topology} l3={l3} isSwitch={isSwitch} isRouter={device.kind === 'router'} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function InterfaceRow({ i, topology, l3, isSwitch, isRouter }: { i: Interface; topology: Topology; l3: boolean; isSwitch: boolean; isRouter: boolean }) {
  const peerId = ops.peerInterfaceId(topology, i.id);
  const peer = peerId ? topology.interfaces[peerId] : undefined;
  const sp = ops.switchportOf(i);
  return (
    <tr>
      <td>
        <div className="mono">{i.name}</div>
        <div className="muted small">{peer ? `→ ${topology.devices[peer.deviceId].hostname} ${peer.name}` : i.parentId ? 'subinterface' : 'not connected'}</div>
      </td>
      {l3 && (
        <td>
          {i.dhcp ? (
            <span className="muted small">from DHCP</span>
          ) : (
            <>
              <CommitField
                value={i.ipv4 ? `${i.ipv4.address}/${i.ipv4.prefixLength}` : ''}
                placeholder="10.0.0.1/24"
                ariaLabel={`${i.name} IPv4 address`}
                onCommit={(v) => {
                  if (!v.trim()) return edit((t) => ops.setInterfaceIp(t, i.id, undefined));
                  const parsed = parseCidr(v);
                  if (!parsed) return 'Use address/prefix, like 10.0.0.1/24';
                  return edit((t) => ops.setInterfaceIp(t, i.id, parsed));
                }}
              />
              {i.ipv4 && <div className="muted small">mask {prefixToMask(i.ipv4.prefixLength)}</div>}
            </>
          )}
        </td>
      )}
      {l3 && (
        <td>
          {i.ipv6Auto ? (
            <span className="muted small">SLAAC</span>
          ) : (
            <CommitField
              value={i.ipv6 ? `${i.ipv6.address}/${i.ipv6.prefixLength}` : ''}
              placeholder="2001:db8::1/64"
              ariaLabel={`${i.name} IPv6 address`}
              onCommit={(v) => {
                if (!v.trim()) return edit((t) => ops.setInterfaceOptions(t, i.id, { ipv6: null }));
                const parsed = parseCidr6(v);
                if (!parsed) return 'Use address/prefix, like 2001:db8:1::1/64';
                return edit((t) => ops.setInterfaceOptions(t, i.id, { ipv6: parsed }));
              }}
            />
          )}
        </td>
      )}
      {isSwitch && (
        <td>
          <select value={sp.mode} aria-label={`${i.name} switchport mode`} onChange={(e) => edit((t) => ops.setSwitchport(t, i.id, { ...sp, mode: e.target.value as 'access' | 'trunk' }))}>
            <option value="access">access</option>
            <option value="trunk">trunk</option>
          </select>
        </td>
      )}
      {isSwitch && (
        <td>
          {sp.mode === 'access' ? (
            <CommitField className="narrow" value={String(sp.accessVlan)} ariaLabel={`${i.name} access VLAN`} onCommit={(v) => edit((t) => ops.setSwitchport(t, i.id, { ...sp, accessVlan: Number(v) }))} />
          ) : (
            <TrunkVlans i={i} />
          )}
        </td>
      )}
      {isRouter && <td>{i.vlanTag ? <span className="pill">dot1Q {i.vlanTag}</span> : <span className="muted">—</span>}</td>}
      <td className="muted small nowrap">{SPEED[i.portType]}</td>
      <td>
        <span className="cfg-on">
          <input type="checkbox" checked={i.adminUp} aria-label={`${i.name} enabled`} onChange={(e) => edit((t) => ops.setInterfaceAdmin(t, i.id, e.target.checked))} />
          {i.parentId && (
            <button className="icon-btn sm" title="Remove subinterface" aria-label={`Remove ${i.name}`} onClick={() => edit((t) => ops.removeSubinterface(t, i.id))}>
              <Icon.Trash size={14} />
            </button>
          )}
        </span>
      </td>
    </tr>
  );
}

function TrunkVlans({ i }: { i: Interface }) {
  const sp = ops.switchportOf(i);
  return (
    <div className="stack-sm">
      <CommitField
        className="narrow"
        value={String(sp.nativeVlan)}
        ariaLabel={`${i.name} native VLAN`}
        onCommit={(v) => edit((t) => ops.setSwitchport(t, i.id, { ...sp, nativeVlan: Number(v) }))}
      />
      <CommitField
        value={sp.allowedVlans?.join(',') ?? ''}
        placeholder="allowed: all"
        ariaLabel={`${i.name} allowed VLANs`}
        onCommit={(v) => {
          if (!v.trim() || v.trim() === 'all') return edit((t) => ops.setSwitchport(t, i.id, { ...sp, allowedVlans: undefined }));
          const list = parseVlanList(v.replace(/\s+/g, ''));
          if (!list) return 'Use a list like 10,20,30-40';
          return edit((t) => ops.setSwitchport(t, i.id, { ...sp, allowedVlans: list }));
        }}
      />
      <span className="muted small">native · allowed</span>
    </div>
  );
}

function AddSubinterface({ device, topology }: { device: Device; topology: Topology }) {
  const parents = ifsOf(topology, device).filter((i) => !i.parentId && i.portType !== 'serial');
  const [parent, setParent] = useState(parents[0]?.id ?? '');
  const [vlan, setVlan] = useState('');
  const [error, setError] = useState<string | null>(null);
  if (!parents.length) return null;
  return (
    <form
      className="inline-form"
      onSubmit={(e) => {
        e.preventDefault();
        const err = edit((t) => ops.addSubinterface(t, parent || parents[0].id, Number(vlan)).topology);
        setError(err);
        if (!err) setVlan('');
      }}
    >
      <span className="muted small">Router-on-a-stick:</span>
      <select value={parent} onChange={(e) => setParent(e.target.value)} aria-label="Parent interface">
        {parents.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
      <input value={vlan} onChange={(e) => setVlan(e.target.value)} placeholder="VLAN" inputMode="numeric" className="narrow" aria-label="VLAN for the new subinterface" />
      <button className="btn sm" type="submit" disabled={!vlan.trim()}>
        <Icon.Plus size={15} /> Subinterface
      </button>
      <ErrorText text={error} />
    </form>
  );
}

function InterfaceServices({ device, topology }: { device: Device; topology: Topology }) {
  const acls = Object.keys(device.acls ?? {});
  const AclPick = ({ i, dir }: { i: Interface; dir: 'aclIn' | 'aclOut' }) => (
    <select value={i[dir] ?? ''} aria-label={`${i.name} ACL ${dir === 'aclIn' ? 'in' : 'out'}`} onChange={(e) => edit((t) => ops.setInterfaceOptions(t, i.id, { [dir]: e.target.value || null }))}>
      <option value="">none</option>
      {[...new Set([...acls, ...(i[dir] ? [i[dir]!] : [])])].map((a) => (
        <option key={a} value={a}>
          {a}
          {!acls.includes(a) ? ' (undefined)' : ''}
        </option>
      ))}
    </select>
  );
  return (
    <div className="table-wrap">
      <table className="data">
        <thead>
          <tr>
            <th>Interface</th>
            <th title="ip access-group … in">ACL in</th>
            <th title="ip access-group … out">ACL out</th>
            <th title="ip nat inside / outside">NAT</th>
            <th title="ip helper-address: forward DHCP broadcasts to this server">DHCP relay</th>
            <th title="ip ospf cost">OSPF cost</th>
          </tr>
        </thead>
        <tbody>
          {ifsOf(topology, device).map((i) => (
            <tr key={i.id}>
              <td className="mono">{i.name}</td>
              <td>
                <AclPick i={i} dir="aclIn" />
              </td>
              <td>
                <AclPick i={i} dir="aclOut" />
              </td>
              <td>
                <select value={i.nat ?? ''} aria-label={`${i.name} NAT role`} onChange={(e) => edit((t) => ops.setInterfaceOptions(t, i.id, { nat: (e.target.value || null) as 'inside' | 'outside' | null }))}>
                  <option value="">none</option>
                  <option value="inside">inside</option>
                  <option value="outside">outside</option>
                </select>
              </td>
              <td>
                <CommitField value={i.helperAddress ?? ''} placeholder="server IP" ariaLabel={`${i.name} helper address`} onCommit={(v) => edit((t) => ops.setInterfaceOptions(t, i.id, { helperAddress: v.trim() || null }))} />
              </td>
              <td>
                <CommitField
                  className="narrow"
                  value={i.ospfCost ? String(i.ospfCost) : ''}
                  placeholder="auto"
                  ariaLabel={`${i.name} OSPF cost`}
                  onCommit={(v) => edit((t) => ops.setInterfaceOptions(t, i.id, { ospfCost: v.trim() ? Number(v) : null }))}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ------------------------------------------------------------- routing

function RemoveButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button className="icon-btn sm" onClick={onClick} aria-label={label} title={label}>
      <Icon.Close size={14} />
    </button>
  );
}

function StaticRoutes({ device }: { device: Device }) {
  const [dest, setDest] = useState('');
  const [hop, setHop] = useState('');
  const [error, setError] = useState<string | null>(null);

  const add = () => {
    const v6 = dest.includes(':');
    const parsed = v6 ? parseCidr6(dest) : parseCidr(dest);
    if (!parsed) return setError(v6 ? 'Destination must look like 2001:db8:2::/64' : 'Destination must look like 10.0.2.0/24');
    if (!v6 && !isValidIPv4(hop.trim())) return setError('Next hop must be an IPv4 address');
    const route = { prefix: parsed.address, prefixLength: parsed.prefixLength, nextHop: hop.trim() };
    const err = edit((t) => (v6 ? ops.addIpv6StaticRoute(t, device.id, route) : ops.addStaticRoute(t, device.id, route)));
    setError(err);
    if (!err) {
      setDest('');
      setHop('');
    }
  };

  const routes = [...(device.staticRoutes ?? []).map((r, k) => ({ r, k, v6: false })), ...(device.ipv6StaticRoutes ?? []).map((r, k) => ({ r, k, v6: true }))];
  return (
    <>
      {routes.length === 0 && <p className="muted small">No static routes. Directly connected subnets need none.</p>}
      <ul className="item-list">
        {routes.map(({ r, k, v6 }) => (
          <li key={`${v6}-${r.prefix}/${r.prefixLength}`}>
            <code>
              {v6 ? 'ipv6 route' : 'ip route'} {v6 ? `${r.prefix}/${r.prefixLength}` : `${r.prefix} ${prefixToMask(r.prefixLength)}`} {r.nextHop}
            </code>
            <RemoveButton label="Remove route" onClick={() => edit((t) => (v6 ? ops.removeIpv6StaticRoute(t, device.id, k) : ops.removeStaticRoute(t, device.id, k)))} />
          </li>
        ))}
      </ul>
      <form
        className="inline-form"
        onSubmit={(e) => {
          e.preventDefault();
          add();
        }}
      >
        <input value={dest} onChange={(e) => setDest(e.target.value)} placeholder="10.0.2.0/24 or 2001:db8:2::/64" aria-label="Destination network" />
        <input value={hop} onChange={(e) => setHop(e.target.value)} placeholder="next hop" aria-label="Next hop" />
        <button className="btn sm" type="submit">
          <Icon.Plus size={15} /> Add
        </button>
      </form>
      <ErrorText text={error} />
    </>
  );
}

function NetworkList({ items, onRemove, render }: { items: { prefix: string; prefixLength: number; area?: number }[]; onRemove: (k: number) => void; render: (n: { prefix: string; prefixLength: number; area?: number }) => string }) {
  return (
    <ul className="item-list">
      {items.map((n, k) => (
        <li key={`${n.prefix}/${n.prefixLength}/${n.area ?? ''}`}>
          <code>{render(n)}</code>
          <RemoveButton label="Remove network" onClick={() => onRemove(k)} />
        </li>
      ))}
    </ul>
  );
}

const wildcardOf = (len: number) => prefixToMask(len).split('.').map((o) => 255 - Number(o)).join('.');

function Rip({ device }: { device: Device }) {
  const [net, setNet] = useState('');
  const [error, setError] = useState<string | null>(null);
  const networks = device.rip?.networks ?? [];
  if (!device.rip)
    return (
      <>
        <p className="muted small">RIP version 2 shares routes with neighbouring routers every update. Hop count is its metric (16 = unreachable).</p>
        <button className="btn sm" onClick={() => edit((t) => ops.setRip(t, device.id, []))}>
          Enable RIP
        </button>
      </>
    );
  return (
    <>
      <NetworkList items={networks} render={(n) => `network ${n.prefix}`} onRemove={(k) => edit((t) => ops.setRip(t, device.id, networks.filter((_, j) => j !== k)))} />
      <form
        className="inline-form"
        onSubmit={(e) => {
          e.preventDefault();
          const p = parseCidr(net.includes('/') ? net : `${net}/${classful(net)}`);
          if (!p) return setError('Use a network like 10.0.0.0 or 10.0.0.0/8');
          const err = edit((t) => ops.setRip(t, device.id, [...networks, { prefix: p.address, prefixLength: p.prefixLength }]));
          setError(err);
          if (!err) setNet('');
        }}
      >
        <input value={net} onChange={(e) => setNet(e.target.value)} placeholder="network, e.g. 10.0.0.0" aria-label="RIP network" />
        <button className="btn sm" type="submit">
          <Icon.Plus size={15} /> Network
        </button>
        <button type="button" className="btn sm ghost danger-text" onClick={() => edit((t) => ops.setRip(t, device.id, null))}>
          Disable RIP
        </button>
      </form>
      <ErrorText text={error} />
    </>
  );
}

/** IOS 'network' under RIP takes a classful network: A=/8, B=/16, C=/24. */
function classful(ip: string): number {
  const first = Number(ip.split('.')[0]);
  return first < 128 ? 8 : first < 192 ? 16 : 24;
}

function Ospf({ device }: { device: Device }) {
  const [net, setNet] = useState('');
  const [area, setArea] = useState('0');
  const [error, setError] = useState<string | null>(null);
  const ospf = device.ospf;
  if (!ospf)
    return (
      <>
        <p className="muted small">OSPF floods link states so every router computes the cheapest path (cost = 100 Mbps ÷ bandwidth). Networky runs a single area.</p>
        <button className="btn sm" onClick={() => edit((t) => ops.setOspf(t, device.id, { networks: [] }))}>
          Enable OSPF
        </button>
      </>
    );
  return (
    <>
      <Row label="Router ID" help="Defaults to the highest interface IPv4 address">
        <CommitField value={ospf.routerId ?? ''} placeholder="automatic" ariaLabel="OSPF router ID" onCommit={(v) => edit((t) => ops.setOspf(t, device.id, { ...ospf, routerId: v.trim() || undefined }))} />
      </Row>
      <NetworkList
        items={ospf.networks}
        render={(n) => `network ${n.prefix} ${wildcardOf(n.prefixLength)} area ${n.area}`}
        onRemove={(k) => edit((t) => ops.setOspf(t, device.id, { ...ospf, networks: ospf.networks.filter((_, j) => j !== k) }))}
      />
      <form
        className="inline-form"
        onSubmit={(e) => {
          e.preventDefault();
          const p = parseCidr(net);
          if (!p) return setError('Use a network like 10.0.12.0/30');
          const err = edit((t) => ops.setOspf(t, device.id, { ...ospf, networks: [...ospf.networks, { prefix: p.address, prefixLength: p.prefixLength, area: Number(area) }] }));
          setError(err);
          if (!err) setNet('');
        }}
      >
        <input value={net} onChange={(e) => setNet(e.target.value)} placeholder="10.0.12.0/30" aria-label="OSPF network" />
        <input value={area} onChange={(e) => setArea(e.target.value)} className="narrow" aria-label="Area" title="Area" />
        <button className="btn sm" type="submit">
          <Icon.Plus size={15} /> Network
        </button>
        <button type="button" className="btn sm ghost danger-text" onClick={() => edit((t) => ops.setOspf(t, device.id, null))}>
          Disable OSPF
        </button>
      </form>
      <ErrorText text={error} />
    </>
  );
}

// ------------------------------------------------------------- ACL / NAT / DHCP

function Acls({ device }: { device: Device }) {
  const acls = device.acls ?? {};
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      <p className="muted small">Rules are checked top to bottom; the first match wins. Every list ends with an invisible “deny any”. Numbers 1–99 are standard (source only), 100–199 extended.</p>
      {Object.entries(acls).map(([n, acl]) => (
        <AclEditor key={n} device={device} name={n} acl={acl} />
      ))}
      <form
        className="inline-form"
        onSubmit={(e) => {
          e.preventDefault();
          const n = name.trim();
          const num = /^\d+$/.test(n) ? Number(n) : NaN;
          const type: Acl['type'] = num >= 1 && num <= 99 ? 'standard' : 'extended';
          if (acls[n]) return setError(`ACL ${n} already exists`);
          const err = edit((t) => ops.setAcl(t, device.id, n, { type, rules: [] }));
          setError(err);
          if (!err) setName('');
        }}
      >
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="10, 101 or a name" aria-label="New ACL name" />
        <button className="btn sm" type="submit" disabled={!name.trim()}>
          <Icon.Plus size={15} /> Access list
        </button>
      </form>
      <ErrorText text={error} />
    </>
  );
}

function AclEditor({ device, name, acl }: { device: Device; name: string; acl: Acl }) {
  const text = acl.rules.map((r) => formatRule(r, acl.type)).join('\n');
  const [draft, setDraft] = useState(text);
  const [error, setError] = useState<string | null>(null);
  const [last, setLast] = useState(text);
  if (text !== last) {
    setLast(text);
    setDraft(text);
  }
  const save = () => {
    try {
      const rules = draft
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean)
        .map((l, k) => {
          try {
            return parseRule(l, acl.type);
          } catch (e) {
            throw new Error(`Line ${k + 1}: ${e instanceof Error ? e.message : e}`);
          }
        });
      setError(edit((t) => ops.setAcl(t, device.id, name, { ...acl, rules })));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  return (
    <div className="acl">
      <div className="acl-head">
        <b className="mono">{name}</b>
        <span className="pill">{acl.type}</span>
        <span className="spacer" />
        <button className="btn sm" onClick={save} disabled={draft === text}>
          Apply
        </button>
        <RemoveButton label={`Delete ACL ${name}`} onClick={() => edit((t) => ops.setAcl(t, device.id, name, null))} />
      </div>
      <textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        rows={Math.max(2, acl.rules.length + 1)}
        spellCheck={false}
        aria-label={`Rules of ACL ${name}, one per line`}
        placeholder={acl.type === 'standard' ? 'permit 192.168.1.0 0.0.0.255' : 'deny tcp any host 10.0.0.5 eq 80\npermit ip any any'}
      />
      <ErrorText text={error} />
    </div>
  );
}

function Nat({ device, topology }: { device: Device; topology: Topology }) {
  const nat = device.nat ?? { statics: [] };
  const [local, setLocal] = useState('');
  const [global, setGlobal] = useState('');
  const [error, setError] = useState<string | null>(null);
  const ifs = ifsOf(topology, device);
  const setNat = (next: typeof nat | null) => setError(edit((t) => ops.setNat(t, device.id, next && (next.statics.length || next.overload) ? next : null)));
  return (
    <>
      <p className="muted small">Mark the LAN side “inside” and the internet side “outside” under Interface services, then add a static mapping or PAT (overload).</p>
      <h5>Static NAT</h5>
      <ul className="item-list">
        {nat.statics.map((s, k) => (
          <li key={`${s.local}-${s.global}`}>
            <code>
              ip nat inside source static {s.local} {s.global}
            </code>
            <RemoveButton label="Remove mapping" onClick={() => setNat({ ...nat, statics: nat.statics.filter((_, j) => j !== k) })} />
          </li>
        ))}
      </ul>
      <form
        className="inline-form"
        onSubmit={(e) => {
          e.preventDefault();
          setNat({ ...nat, statics: [...nat.statics, { local: local.trim(), global: global.trim() }] });
          setLocal('');
          setGlobal('');
        }}
      >
        <input value={local} onChange={(e) => setLocal(e.target.value)} placeholder="inside local" aria-label="Inside local address" />
        <input value={global} onChange={(e) => setGlobal(e.target.value)} placeholder="inside global" aria-label="Inside global address" />
        <button className="btn sm" type="submit" disabled={!local.trim() || !global.trim()}>
          <Icon.Plus size={15} /> Mapping
        </button>
      </form>
      <h5>PAT (overload)</h5>
      <div className="inline-form">
        <span className="muted small">source list</span>
        <select
          value={nat.overload?.acl ?? ''}
          aria-label="PAT access list"
          onChange={(e) => {
            const acl = e.target.value;
            setNat({ ...nat, overload: acl ? { acl, outsideInterfaceId: nat.overload?.outsideInterfaceId ?? ifs.find((i) => i.nat === 'outside')?.id ?? ifs[0].id } : undefined });
          }}
        >
          <option value="">off</option>
          {Object.keys(device.acls ?? {}).map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </select>
        {nat.overload && (
          <>
            <span className="muted small">interface</span>
            <select value={nat.overload.outsideInterfaceId} aria-label="PAT outside interface" onChange={(e) => setNat({ ...nat, overload: { ...nat.overload!, outsideInterfaceId: e.target.value } })}>
              {ifs.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.name}
                </option>
              ))}
            </select>
            <span className="muted small">overload</span>
          </>
        )}
      </div>
      <ErrorText text={error} />
    </>
  );
}

export function DhcpPools({ device }: { device: Device }) {
  const pools = device.dhcpPools ?? [];
  const [form, setForm] = useState({ name: '', network: '', router: '', dns: '', excluded: '' });
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.target.value });
  return (
    <>
      <ul className="item-list">
        {pools.map((p, k) => (
          <li key={p.name}>
            <code>
              {p.name}: {p.network}/{p.prefixLength}
              {p.defaultRouter ? ` · gw ${p.defaultRouter}` : ''}
              {p.dnsServer ? ` · dns ${p.dnsServer}` : ''}
              {p.excluded?.length ? ` · excluded ${p.excluded.join(', ')}` : ''}
            </code>
            <RemoveButton label={`Remove pool ${p.name}`} onClick={() => setError(edit((t) => ops.setDhcpPools(t, device.id, pools.filter((_, j) => j !== k))))} />
          </li>
        ))}
      </ul>
      <form
        className="pool-form"
        onSubmit={(e) => {
          e.preventDefault();
          const net = parseCidr(form.network);
          if (!net) return setError('Network must look like 192.168.10.0/24');
          const pool: DhcpPool = { name: form.name.trim(), network: net.address, prefixLength: net.prefixLength };
          if (form.router.trim()) pool.defaultRouter = form.router.trim();
          if (form.dns.trim()) pool.dnsServer = form.dns.trim();
          const ex = form.excluded.split(/[\s,]+/).filter(Boolean);
          if (ex.length) pool.excluded = ex;
          const err = edit((t) => ops.setDhcpPools(t, device.id, [...pools, pool]));
          setError(err);
          if (!err) setForm({ name: '', network: '', router: '', dns: '', excluded: '' });
        }}
      >
        <input value={form.name} onChange={set('name')} placeholder="pool name" aria-label="Pool name" />
        <input value={form.network} onChange={set('network')} placeholder="192.168.10.0/24" aria-label="Pool network" />
        <input value={form.router} onChange={set('router')} placeholder="default router" aria-label="Default router" />
        <input value={form.dns} onChange={set('dns')} placeholder="DNS server (optional)" aria-label="DNS server" />
        <input value={form.excluded} onChange={set('excluded')} placeholder="excluded addresses (optional)" aria-label="Excluded addresses" />
        <button className="btn sm" type="submit" disabled={!form.name.trim() || !form.network.trim()}>
          <Icon.Plus size={15} /> Pool
        </button>
      </form>
      <ErrorText text={error} />
    </>
  );
}
