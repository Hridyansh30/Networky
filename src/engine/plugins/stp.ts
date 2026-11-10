// Spanning Tree Protocol (IEEE 802.1D), one instance for all VLANs.
//
// Redundant links between switches create loops, and Ethernet frames have no
// TTL, so a single broadcast would circulate forever. STP turns the physical
// mesh into a loop-free TREE by blocking just enough ports:
//
//   1. Elect a ROOT bridge: the lowest bridge ID (priority, then MAC).
//   2. Every other switch picks its ROOT PORT: the port with the cheapest
//      path to the root.
//   3. On every link, the switch closer to the root (lowest cost, then lowest
//      bridge ID) owns the DESIGNATED port.
//   4. Every port that is neither root nor designated BLOCKS data.
//
// Switches learn all this by exchanging BPDUs. Here a BPDU is only sent when
// a switch's view changes (no 2-second hello timer), which converges to the
// same tree and keeps the log readable.
//
// Simplifications: no port priorities, no timers or listening/learning
// states (ports go straight to forwarding or blocking), and one tree shared
// by all VLANs (Cisco's PVST+ builds one per VLAN).

import type { Device, Interface } from '../../model/types';
import type { Frame, Payload } from '../packets';
import type { EnginePlugin, SimApi } from '../plugin';

export const STP_MAC = '01:80:c2:00:00:00';
export const DEFAULT_PRIORITY = 32768;

export interface BridgeId {
  priority: number;
  mac: string;
}

export interface Bpdu extends Payload {
  kind: 'bpdu';
  root: BridgeId;
  rootCost: number;
  bridge: BridgeId;
  portId: number;
}

export const isBpdu = (p: Payload): p is Bpdu => p.kind === 'bpdu';

export type PortRole = 'root' | 'designated' | 'alternate' | 'disabled';

export interface SwitchStp {
  bridge: BridgeId;
  root: BridgeId;
  rootCost: number;
  rootPortId?: string;
  /** Best BPDU heard on each port. */
  heard: Record<string, Bpdu>;
  roles: Record<string, PortRole>;
}

type StpState = Record<string, SwitchStp>;

/** 802.1D-1998 short path costs. */
export function portCost(iface: Interface): number {
  return iface.portType === 'fastethernet' ? 19 : 4;
}

/** Negative if a is better (lower) than b. */
export function compareBridge(a: BridgeId, b: BridgeId): number {
  return a.priority - b.priority || a.mac.localeCompare(b.mac);
}

/** Compare priority vectors: root, cost, sender bridge, sender port. */
function compareVector(a: [BridgeId, number, BridgeId, number], b: [BridgeId, number, BridgeId, number]): number {
  return compareBridge(a[0], b[0]) || a[1] - b[1] || compareBridge(a[2], b[2]) || a[3] - b[3];
}

export function formatBridge(b: BridgeId): string {
  return `${b.priority}/${b.mac}`;
}

const switches = (sim: SimApi) => Object.values(sim.topology.devices).filter((d) => d.kind === 'switch');
const state = (sim: SimApi) => sim.state<StpState>('stp', () => ({}));

/** The STP view of one switch (created lazily with "I am the root"). */
export function stpOf(sim: SimApi, sw: Device): SwitchStp {
  const all = state(sim);
  if (!all[sw.id]) {
    const ports = sim.interfacesOf(sw);
    // The bridge MAC: the lowest port MAC stands in for the switch's base MAC.
    const mac = ports.map((p) => p.mac).sort()[0];
    const bridge = { priority: sw.stpPriority ?? DEFAULT_PRIORITY, mac };
    all[sw.id] = { bridge, root: bridge, rootCost: 0, heard: {}, roles: {} };
    for (const p of ports) all[sw.id].roles[p.id] = p.linkId ? 'designated' : 'disabled';
  }
  return all[sw.id];
}

function portIndex(sw: Device, port: Interface): number {
  return sw.interfaceIds.indexOf(port.id) + 1;
}

function sendBpdus(sim: SimApi, sw: Device, why: string) {
  const s = stpOf(sim, sw);
  const designated = sim.interfacesOf(sw).filter((p) => p.linkId && s.roles[p.id] === 'designated');
  if (designated.length) {
    sim.logEvent({ deviceId: sw.id, kind: 'info', control: true, text: `${sw.hostname} STP: ${why}; sends BPDUs (root ${formatBridge(s.root)}, cost ${s.rootCost})` });
  }
  for (const port of designated) {
    const bpdu: Bpdu = { kind: 'bpdu', root: s.root, rootCost: s.rootCost, bridge: s.bridge, portId: portIndex(sw, port) };
    sim.transmit(port, sim.makeFrame(port.mac, STP_MAC, bpdu, { control: true }));
  }
}

/** Recompute root, root port and every port role from what this switch has heard. */
function recompute(sim: SimApi, sw: Device): boolean {
  const s = stpOf(sim, sw);
  const before = JSON.stringify([s.root, s.rootCost, s.rootPortId, s.roles]);
  const ports = sim.interfacesOf(sw).filter((p) => p.linkId);

  // Root port: the best path to a root better than ourselves.
  let best: { port: Interface; vector: [BridgeId, number, BridgeId, number] } | undefined;
  for (const port of ports) {
    const b = s.heard[port.id];
    if (!b) continue;
    const vector: [BridgeId, number, BridgeId, number] = [b.root, b.rootCost + portCost(port), b.bridge, b.portId];
    if (!best || compareVector(vector, best.vector) < 0) best = { port, vector };
  }
  if (best && compareBridge(best.vector[0], s.bridge) < 0) {
    s.root = best.vector[0];
    s.rootCost = best.vector[1];
    s.rootPortId = best.port.id;
  } else {
    s.root = s.bridge;
    s.rootCost = 0;
    s.rootPortId = undefined;
  }

  // Every other port: designated if what we'd send beats what we hear, else blocked.
  for (const port of sim.interfacesOf(sw)) {
    if (!port.linkId) {
      s.roles[port.id] = 'disabled';
      continue;
    }
    if (port.id === s.rootPortId) {
      s.roles[port.id] = 'root';
      continue;
    }
    const heard = s.heard[port.id];
    const mine: [BridgeId, number, BridgeId, number] = [s.root, s.rootCost, s.bridge, portIndex(sw, port)];
    s.roles[port.id] = !heard || compareVector(mine, [heard.root, heard.rootCost, heard.bridge, heard.portId]) < 0 ? 'designated' : 'alternate';
  }
  return JSON.stringify([s.root, s.rootCost, s.rootPortId, s.roles]) !== before;
}

function receiveBpdu(sim: SimApi, sw: Device, port: Interface, frame: Frame, bpdu: Bpdu) {
  const s = stpOf(sim, sw);
  sim.logEvent({
    deviceId: sw.id,
    kind: 'receive',
    frameId: frame.id,
    control: true,
    text: `${sw.hostname} ${port.name} hears a BPDU: root ${formatBridge(bpdu.root)}, cost ${bpdu.rootCost}, from ${formatBridge(bpdu.bridge)}`,
  });
  s.heard[port.id] = bpdu;
  const oldRoot = s.root;
  if (recompute(sim, sw)) {
    const why = compareBridge(oldRoot, s.root) !== 0 ? `${formatBridge(s.root)} is a better root` : 'port roles changed';
    for (const p of sim.interfacesOf(sw)) {
      if (s.roles[p.id] === 'alternate') sim.logEvent({ deviceId: sw.id, kind: 'learn', control: true, text: `${sw.hostname} ${p.name} → BLOCKING (alternate port; it would close a loop)` });
    }
    sendBpdus(sim, sw, why);
  }
}

export const stpPlugin: EnginePlugin = {
  name: 'stp',
  description: 'Spanning Tree: elects a root switch and blocks redundant ports so loops cannot form',
  bootOrder: 1,

  boot(sim) {
    for (const sw of switches(sim)) {
      const s = stpOf(sim, sw);
      recompute(sim, sw);
      sendBpdus(sim, sw, `starts up believing it is the root (bridge ID ${formatBridge(s.bridge)})`);
    }
  },

  handleSwitchFrame(sim, sw, ingress, frame) {
    if (frame.dstMac !== STP_MAC || !isBpdu(frame.payload)) return false;
    receiveBpdu(sim, sw, ingress, frame, frame.payload);
    return true;
  },

  portForwards(sim, sw, port) {
    const s = state(sim)[sw.id];
    return !s || s.roles[port.id] !== 'alternate';
  },

  portStatus(sim, iface) {
    const s = state(sim)[iface.deviceId];
    return s?.roles[iface.id] === 'alternate' ? 'blocking' : undefined;
  },

  describe(p) {
    return isBpdu(p) ? `STP BPDU (root ${formatBridge(p.root)}, cost ${p.rootCost})` : undefined;
  },

  tag(p) {
    return isBpdu(p) ? 'stp' : undefined;
  },
};
