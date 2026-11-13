// Every icon in the app: inline SVG, no icon font, no network request.
// Device icons use theme tokens (--dev-*) so they follow light and dark mode.

import type { SVGProps } from 'react';
import type { CableType, DeviceKind } from '../model/types';

type P = SVGProps<SVGSVGElement> & { size?: number };

function Stroke({ size = 18, children, ...rest }: P & { children: React.ReactNode }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...rest}>
      {children}
    </svg>
  );
}

export const Icon = {
  Plus: (p: P) => <Stroke {...p}><path d="M12 5v14M5 12h14" /></Stroke>,
  Folder: (p: P) => <Stroke {...p}><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /></Stroke>,
  Save: (p: P) => <Stroke {...p}><path d="M5 3h11l3 3v13a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z" /><path d="M7 3v5h8V3M7 21v-7h10v7" /></Stroke>,
  Download: (p: P) => <Stroke {...p}><path d="M12 4v11M7 10l5 5 5-5M5 20h14" /></Stroke>,
  Undo: (p: P) => <Stroke {...p}><path d="M9 14 4 9l5-5" /><path d="M4 9h10a6 6 0 0 1 0 12h-3" /></Stroke>,
  Redo: (p: P) => <Stroke {...p}><path d="m15 14 5-5-5-5" /><path d="M20 9H10a6 6 0 0 0 0 12h3" /></Stroke>,
  Play: (p: P) => <Stroke {...p}><path d="M7 4.5v15l12-7.5z" fill="currentColor" /></Stroke>,
  Pause: (p: P) => <Stroke {...p}><path d="M8 5v14M16 5v14" strokeWidth={3} /></Stroke>,
  Step: (p: P) => <Stroke {...p}><path d="M5 5v14l10-7z" fill="currentColor" /><path d="M19 5v14" strokeWidth={2.4} /></Stroke>,
  Reset: (p: P) => <Stroke {...p}><path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 3v5h5" /></Stroke>,
  Sun: (p: P) => <Stroke {...p}><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></Stroke>,
  Moon: (p: P) => <Stroke {...p}><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" /></Stroke>,
  Search: (p: P) => <Stroke {...p}><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></Stroke>,
  Cursor: (p: P) => <Stroke {...p}><path d="m5 3 14 7-6 2-2 6z" /></Stroke>,
  Hand: (p: P) => <Stroke {...p}><path d="M18 11V6a2 2 0 0 0-4 0v5M14 10V4a2 2 0 0 0-4 0v6M10 10.5V6a2 2 0 0 0-4 0v8" /><path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.9-6-2.4l-3.6-3.6a2 2 0 0 1 2.8-2.8L7 15" /></Stroke>,
  BoxSelect: (p: P) => <Stroke {...p}><path d="M5 3H3v2M9 3h2M15 3h2M21 5V3h-2M3 9v2M3 15v2M3 19v2h2M21 9v2M21 15v2M21 19v2h-2M9 21h2M15 21h2" /></Stroke>,
  ZoomIn: (p: P) => <Stroke {...p}><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5M11 8v6M8 11h6" /></Stroke>,
  ZoomOut: (p: P) => <Stroke {...p}><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5M8 11h6" /></Stroke>,
  Fit: (p: P) => <Stroke {...p}><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" /></Stroke>,
  Terminal: (p: P) => <Stroke {...p}><path d="m5 8 4 4-4 4M12 17h7" /><rect x="2" y="3" width="20" height="18" rx="3" /></Stroke>,
  Close: (p: P) => <Stroke {...p}><path d="M6 6l12 12M18 6 6 18" /></Stroke>,
  ChevronDown: (p: P) => <Stroke {...p}><path d="m6 9 6 6 6-6" /></Stroke>,
  ChevronRight: (p: P) => <Stroke {...p}><path d="m9 6 6 6-6 6" /></Stroke>,
  ArrowRight: (p: P) => <Stroke {...p}><path d="M5 12h14M13 6l6 6-6 6" /></Stroke>,
  Star: ({ filled, ...p }: P & { filled?: boolean }) => <Stroke {...p}><path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1 6.2L12 17.3 6.5 20.2l1-6.2L3 9.6l6.2-.9z" fill={filled ? 'currentColor' : 'none'} /></Stroke>,
  Trash: (p: P) => <Stroke {...p}><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" /></Stroke>,
  Book: (p: P) => <Stroke {...p}><path d="M2 5h6a4 4 0 0 1 4 4v11a3 3 0 0 0-3-3H2zM22 5h-6a4 4 0 0 0-4 4v11a3 3 0 0 1 3-3h7z" /></Stroke>,
  Zap: (p: P) => <Stroke {...p}><path d="M13 2 4 14h7l-1 8 9-12h-7z" /></Stroke>,
  Flask: (p: P) => <Stroke {...p}><path d="M9 3h6M10 3v6L4.5 19a1.5 1.5 0 0 0 1.3 2h12.4a1.5 1.5 0 0 0 1.3-2L14 9V3M7 15h10" /></Stroke>,
  Clock: (p: P) => <Stroke {...p}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></Stroke>,
  Bars: (p: P) => <Stroke {...p}><path d="M5 20v-6M12 20V9M19 20V4" strokeWidth={2.4} /></Stroke>,
  Home: (p: P) => <Stroke {...p}><path d="m3 11 9-8 9 8M5 9.5V21h14V9.5" /></Stroke>,
  Gear: (p: P) => <Stroke {...p}><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" /></Stroke>,
  Link: (p: P) => <Stroke {...p}><path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7" /><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7" /></Stroke>,
  Grab: (p: P) => <Stroke {...p}><path d="M8 13V5.5a1.5 1.5 0 0 1 3 0V12M11 11.5v-2a1.5 1.5 0 0 1 3 0V12M14 10.5a1.5 1.5 0 0 1 3 0V12M17 11.5a1.5 1.5 0 0 1 3 0V16a6 6 0 0 1-6 6h-2a6 6 0 0 1-5-2.7L4.3 15a1.5 1.5 0 0 1 2.4-1.8L8 15" /></Stroke>,
  Check: (p: P) => <Stroke {...p}><path d="m5 12 5 5 9-10" /></Stroke>,
  Alert: (p: P) => <Stroke {...p}><path d="M12 3 2 20h20zM12 10v4M12 17.5v.5" /></Stroke>,
  Info: (p: P) => <Stroke {...p}><circle cx="12" cy="12" r="9" /><path d="M12 11v6M12 7.5v.5" /></Stroke>,
  Envelope: (p: P) => <Stroke {...p}><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m3 7 9 6 9-6" /></Stroke>,
  Layers: (p: P) => <Stroke {...p}><path d="m12 3 9 5-9 5-9-5zM3 13l9 5 9-5" /></Stroke>,
  Table: (p: P) => <Stroke {...p}><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 10h18M9 10v10" /></Stroke>,
  Sliders: (p: P) => <Stroke {...p}><path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0" /><circle cx="16" cy="6" r="2" /><circle cx="10" cy="12" r="2" /><circle cx="18" cy="18" r="2" /></Stroke>,
  Monitor: (p: P) => <Stroke {...p}><rect x="3" y="4" width="18" height="12" rx="2" /><path d="M8 20h8M12 16v4" /></Stroke>,
  Copy: (p: P) => <Stroke {...p}><rect x="8" y="8" width="13" height="13" rx="2" /><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3" /></Stroke>,
  Edit: (p: P) => <Stroke {...p}><path d="M4 20h4L19 9l-4-4L4 16z" /></Stroke>,
  Code: (p: P) => <Stroke {...p}><path d="m8 7-5 5 5 5M16 7l5 5-5 5M14 4l-4 16" /></Stroke>,
  Shuffle: (p: P) => <Stroke {...p}><path d="M3 7h3.5a5 5 0 0 1 4 2l3 5a5 5 0 0 0 4 2H21M3 17h3.5a5 5 0 0 0 4-2M14 9a5 5 0 0 1 3.5-2H21M18 4l3 3-3 3M18 14l3 3-3 3" /></Stroke>,
  Calendar: (p: P) => <Stroke {...p}><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18M8 3v4M16 3v4" /></Stroke>,
  Lock: (p: P) => <Stroke {...p}><rect x="4" y="11" width="16" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></Stroke>,
  Bulb: (p: P) => <Stroke {...p}><path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2V16h5v-.1c0-.8.4-1.5 1-2A6 6 0 0 0 12 3z" /></Stroke>,
  Eye: (p: P) => <Stroke {...p}><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></Stroke>,
  Path: (p: P) => <Stroke {...p}><circle cx="6" cy="19" r="2.5" /><circle cx="18" cy="5" r="2.5" /><path d="M8.5 19H16a3.5 3.5 0 0 0 0-7H8a3.5 3.5 0 0 1 0-7h7.5" /></Stroke>,
  Spark: (p: P) => <Stroke {...p}><path d="M12 3c.5 4 2.5 6.5 6 7.5-3.5 1-5.5 3.5-6 7.5-.5-4-2.5-6.5-6-7.5 3.5-1 5.5-3.5 6-7.5z" /></Stroke>,
  Network: (p: P) => <Stroke {...p}><path d="M12 3 4 19h16z" /><circle cx="12" cy="3.5" r="2" fill="currentColor" /><circle cx="4" cy="19" r="2" fill="currentColor" /><circle cx="20" cy="19" r="2" fill="currentColor" /></Stroke>,
};

/** The Networky mark: three nodes joined in a triangle. */
export function Logo({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <path d="M16 6 6.5 24h19z" fill="none" stroke="var(--accent)" strokeWidth="2.6" strokeLinejoin="round" />
      <circle cx="16" cy="6" r="4" fill="var(--accent)" />
      <circle cx="6.5" cy="24" r="4" fill="var(--accent)" />
      <circle cx="25.5" cy="24" r="4" fill="var(--accent)" />
    </svg>
  );
}

// ---------------------------------------------------------------- devices

function PcIcon() {
  return (
    <>
      <rect x="6" y="7" width="36" height="25" rx="3" fill="var(--dev-body)" stroke="var(--dev-edge)" strokeWidth="1.5" />
      <rect x="9.5" y="10.5" width="29" height="18" rx="1.5" fill="url(#dev-screen)" />
      <path d="M20 32h8l1.5 6h-11z" fill="var(--dev-body)" stroke="var(--dev-edge)" strokeWidth="1.5" strokeLinejoin="round" />
      <rect x="14" y="38" width="20" height="3" rx="1.5" fill="var(--dev-edge)" />
    </>
  );
}

function LaptopIcon() {
  return (
    <>
      <rect x="9" y="9" width="30" height="21" rx="2.5" fill="var(--dev-body)" stroke="var(--dev-edge)" strokeWidth="1.5" />
      <rect x="12" y="12" width="24" height="15" rx="1" fill="url(#dev-screen)" />
      <path d="M5 33h38l-3.5 5h-31z" fill="var(--dev-body)" stroke="var(--dev-edge)" strokeWidth="1.5" strokeLinejoin="round" />
      <rect x="20" y="34" width="8" height="1.6" rx=".8" fill="var(--dev-edge)" />
    </>
  );
}

function ServerIcon() {
  return (
    <>
      <path d="M14 6h16l5 4v32H19l-5-4z" fill="var(--dev-side)" stroke="var(--dev-edge)" strokeWidth="1.5" strokeLinejoin="round" />
      <rect x="14" y="6" width="16" height="32" rx="1.5" fill="var(--dev-body)" stroke="var(--dev-edge)" strokeWidth="1.5" />
      {[11, 17, 23].map((y) => (
        <g key={y}>
          <rect x="17" y={y} width="10" height="3.5" rx="1" fill="var(--dev-slot)" />
          <circle cx="25.5" cy={y + 1.75} r="0.9" fill="var(--up)" />
        </g>
      ))}
      <circle cx="22" cy="32.5" r="1.6" fill="var(--dev-slot)" />
    </>
  );
}

function SwitchIcon() {
  return (
    <>
      <path d="M4 22 12 15h32l-8 7z" fill="var(--dev-top)" stroke="var(--dev-edge)" strokeWidth="1.4" strokeLinejoin="round" />
      <path d="M4 22h32v9H4z" fill="var(--dev-body)" stroke="var(--dev-edge)" strokeWidth="1.4" strokeLinejoin="round" />
      <path d="M36 22l8-7v9l-8 7z" fill="var(--dev-side)" stroke="var(--dev-edge)" strokeWidth="1.4" strokeLinejoin="round" />
      <path d="M16 17.2h10l-1.6-1.2M28 19.8H18l1.6 1.2" stroke="var(--dev-glyph)" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      {[7, 11, 15, 19, 23, 27].map((x) => (
        <rect key={x} x={x} y="25" width="2.6" height="2.4" rx=".5" fill="var(--dev-slot)" />
      ))}
      <circle cx="32" cy="26.2" r="1" fill="var(--up)" />
    </>
  );
}

function RouterIcon() {
  return (
    <>
      <path d="M6 18v9c0 4 8 7 18 7s18-3 18-7v-9" fill="var(--dev-body)" stroke="var(--dev-edge)" strokeWidth="1.5" />
      <ellipse cx="24" cy="18" rx="18" ry="7" fill="var(--dev-top)" stroke="var(--dev-edge)" strokeWidth="1.5" />
      <g stroke="var(--dev-glyph)" strokeWidth="1.7" strokeLinecap="round" fill="none">
        <path d="M14 15.5l4.5 2M14 15.5l1.6 2.2M34 20.5l-4.5-2M34 20.5l-1.6-2.2" />
        <path d="M27.5 14.5l4-1.5M27.5 14.5l1.3-1.9M20.5 21.5l-4 1.5M20.5 21.5l-1.3 1.9" />
      </g>
    </>
  );
}

function HubIcon() {
  return (
    <>
      <path d="M6 22 12 17h30l-6 5z" fill="var(--dev-top)" stroke="var(--dev-edge)" strokeWidth="1.4" strokeLinejoin="round" />
      <path d="M6 22h30v8H6z" fill="var(--dev-muted)" stroke="var(--dev-edge)" strokeWidth="1.4" />
      <path d="M36 22l6-5v8l-6 5z" fill="var(--dev-side)" stroke="var(--dev-edge)" strokeWidth="1.4" strokeLinejoin="round" />
      {[9, 13, 17, 21, 25, 29].map((x) => (
        <rect key={x} x={x} y="24.6" width="2.6" height="2.4" rx=".5" fill="var(--dev-slot)" />
      ))}
    </>
  );
}

const DEVICE_ART: Record<DeviceKind, () => React.ReactElement> = {
  pc: PcIcon,
  laptop: LaptopIcon,
  server: ServerIcon,
  switch: SwitchIcon,
  router: RouterIcon,
  hub: HubIcon,
};

/** Gradients the device icons share. Rendered once at the app root. */
export function IconDefs() {
  return (
    <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden="true">
      <defs>
        <linearGradient id="dev-screen" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="var(--dev-screen-a)" />
          <stop offset="1" stopColor="var(--dev-screen-b)" />
        </linearGradient>
      </defs>
    </svg>
  );
}

export function DeviceIcon({ kind, size = 48 }: { kind: DeviceKind; size?: number }) {
  const Art = DEVICE_ART[kind];
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden="true" className={`device-icon device-icon-${kind}`}>
      <Art />
    </svg>
  );
}

export function CableIcon({ cable, size = 22 }: { cable: CableType; size?: number }) {
  const style: Record<CableType, { stroke: string; dash?: string; zig?: boolean }> = {
    'copper-straight': { stroke: 'var(--cable-copper)' },
    'copper-cross': { stroke: 'var(--cable-copper)', dash: '4 3' },
    fiber: { stroke: 'var(--cable-fiber)' },
    serial: { stroke: 'var(--cable-serial)', zig: true },
  };
  const s = style[cable];
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <path d={s.zig ? 'M3 18 9 9l6 6 6-9' : 'M3 18C9 18 15 6 21 6'} fill="none" stroke={s.stroke} strokeWidth="2.4" strokeDasharray={s.dash} strokeLinecap="round" />
      <circle cx="3" cy="18" r="2" fill={s.stroke} />
      <circle cx="21" cy="6" r="2" fill={s.stroke} />
    </svg>
  );
}
