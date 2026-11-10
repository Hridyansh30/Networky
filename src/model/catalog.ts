import type { CableType, DeviceKind, PortType } from './types';

export interface PortTemplate {
  name: string;
  portType: PortType;
}

export interface DeviceTemplate {
  kind: DeviceKind;
  label: string;
  hostnamePrefix: string;
  /** OSI layer the device mainly works at. Hosts run the full stack. */
  layer: 1 | 2 | 3 | 7;
  /** Can its interfaces hold an IP address? */
  l3: boolean;
  ports: PortTemplate[];
}

const range = (n: number, f: (i: number) => PortTemplate) => Array.from({ length: n }, (_, i) => f(i));

export const CATALOG: Record<DeviceKind, DeviceTemplate> = {
  pc: {
    kind: 'pc',
    label: 'PC',
    hostnamePrefix: 'PC',
    layer: 7,
    l3: true,
    ports: [{ name: 'FastEthernet0', portType: 'fastethernet' }],
  },
  laptop: {
    kind: 'laptop',
    label: 'Laptop',
    hostnamePrefix: 'Laptop',
    layer: 7,
    l3: true,
    ports: [{ name: 'FastEthernet0', portType: 'fastethernet' }],
  },
  server: {
    kind: 'server',
    label: 'Server',
    hostnamePrefix: 'Server',
    layer: 7,
    l3: true,
    ports: [{ name: 'GigabitEthernet0', portType: 'gigabitethernet' }],
  },
  hub: {
    kind: 'hub',
    label: 'Hub',
    hostnamePrefix: 'Hub',
    layer: 1,
    l3: false,
    ports: range(6, (i) => ({ name: `Port${i}`, portType: 'fastethernet' })),
  },
  switch: {
    kind: 'switch',
    label: 'Switch',
    hostnamePrefix: 'Switch',
    layer: 2,
    l3: false,
    ports: [
      ...range(8, (i) => ({ name: `FastEthernet0/${i + 1}`, portType: 'fastethernet' as const })),
      { name: 'GigabitEthernet0/1', portType: 'gigabitethernet' },
      { name: 'GigabitEthernet0/2', portType: 'fiber' },
    ],
  },
  router: {
    kind: 'router',
    label: 'Router',
    hostnamePrefix: 'Router',
    layer: 3,
    l3: true,
    ports: [
      { name: 'GigabitEthernet0/0', portType: 'gigabitethernet' },
      { name: 'GigabitEthernet0/1', portType: 'gigabitethernet' },
      { name: 'GigabitEthernet0/2', portType: 'fiber' },
      { name: 'Serial0/0/0', portType: 'serial' },
      { name: 'Serial0/0/1', portType: 'serial' },
    ],
  },
};

export const DEVICE_KINDS: DeviceKind[] = ['pc', 'laptop', 'server', 'hub', 'switch', 'router'];

/** End devices: they run applications and get a default gateway, DHCP and SLAAC. */
export const isHostKind = (k: DeviceKind): boolean => k === 'pc' || k === 'laptop' || k === 'server';

export const CABLES: Record<CableType, { label: string; fits: PortType[] }> = {
  'copper-straight': { label: 'Copper straight-through', fits: ['fastethernet', 'gigabitethernet'] },
  'copper-cross': { label: 'Copper crossover', fits: ['fastethernet', 'gigabitethernet'] },
  fiber: { label: 'Fiber', fits: ['fiber'] },
  serial: { label: 'Serial', fits: ['serial'] },
};

export const CABLE_TYPES = Object.keys(CABLES) as CableType[];

export function cableFits(cable: CableType, port: PortType): boolean {
  return CABLES[cable].fits.includes(port);
}

/**
 * Classic Ethernet wiring rule (before Auto-MDIX):
 * PCs, servers and routers transmit on the same pins (MDI); hubs and switches
 * swap them (MDI-X). Unlike ends need a straight cable, like ends need a crossover.
 */
export function expectedCopperCable(a: DeviceKind, b: DeviceKind): 'copper-straight' | 'copper-cross' {
  const mdix = (k: DeviceKind) => k === 'hub' || k === 'switch';
  return mdix(a) === mdix(b) ? 'copper-cross' : 'copper-straight';
}

/** 'GigabitEthernet0/1' -> 'Gi0/1', like Cisco's short names. */
export function shortPortName(name: string): string {
  return name
    .replace(/^GigabitEthernet/, 'Gi')
    .replace(/^FastEthernet/, 'Fa')
    .replace(/^Serial/, 'Se')
    .replace(/^Port/, 'P');
}
