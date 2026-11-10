import { navigate } from '../app/router';
import { useProjectStore } from '../store/projectStore';
import { DeviceIcon, Icon } from '../ui/icons';
import { openFileDialog } from '../ui/openFile';
import { TopNav } from '../ui/TopNav';

const FEATURES = [
  { icon: Icon.Zap, title: 'Design', text: 'Drag devices onto a canvas and cable them together.' },
  { icon: Icon.Play, title: 'Simulate', text: 'Watch every frame hop from port to port, one step at a time.' },
  { icon: Icon.Terminal, title: 'Configure', text: 'Use a Cisco-style CLI or the forms. Both change the same device.' },
  { icon: Icon.Book, title: 'Learn', text: 'Hands-on labs for VLANs, STP, DHCP, NAT, ACLs, RIP, OSPF and IPv6.' },
];

/** The picture on the landing page: a router, two switches and four hosts. */
function HeroArt() {
  const nodes = [
    { kind: 'router' as const, x: 250, y: 40 },
    { kind: 'switch' as const, x: 110, y: 170 },
    { kind: 'switch' as const, x: 390, y: 170 },
    { kind: 'pc' as const, x: 30, y: 310 },
    { kind: 'laptop' as const, x: 190, y: 310 },
    { kind: 'server' as const, x: 310, y: 310 },
    { kind: 'pc' as const, x: 470, y: 310 },
  ];
  const links = [[0, 1], [0, 2], [1, 3], [1, 4], [2, 5], [2, 6]];
  const c = (i: number) => ({ x: nodes[i].x + 40, y: nodes[i].y + 40 });
  return (
    <svg className="hero-art" viewBox="0 0 560 420" role="img" aria-label="A small network: a router connected to two switches, each with two computers">
      <defs>
        <radialGradient id="hero-glow" cx="50%" cy="50%" r="50%">
          <stop offset="0" stopColor="var(--accent)" stopOpacity="0.28" />
          <stop offset="1" stopColor="var(--accent)" stopOpacity="0" />
        </radialGradient>
      </defs>
      <ellipse cx="280" cy="220" rx="290" ry="210" fill="url(#hero-glow)" />
      {links.map(([a, b], k) => (
        <g key={k}>
          <line x1={c(a).x} y1={c(a).y} x2={c(b).x} y2={c(b).y} className="hero-link" />
          <circle r="5" className="hero-packet" style={{ animationDelay: `${k * 0.45}s` }}>
            <animateMotion dur="2.7s" repeatCount="indefinite" begin={`${k * 0.45}s`} path={`M${c(a).x},${c(a).y} L${c(b).x},${c(b).y}`} />
          </circle>
        </g>
      ))}
      {nodes.map((n, k) => (
        <g key={k} transform={`translate(${n.x} ${n.y})`}>
          <DeviceIcon kind={n.kind} size={80} />
        </g>
      ))}
    </svg>
  );
}

export function HomePage() {
  const start = () => {
    useProjectStore.getState().newProject();
    navigate({ page: 'workspace' });
  };
  const open = async () => {
    if (await openFileDialog()) navigate({ page: 'workspace' });
  };

  return (
    <div className="page">
      <TopNav />
      <main className="home">
        <section className="hero">
          <div className="hero-text">
            <span className="chip">
              <Icon.Terminal size={16} /> Network simulator
            </span>
            <h1>
              Networky
              <span>
                Build, simulate, <em>learn</em>
              </span>
            </h1>
            <p className="lead">Design a network in your browser, configure it like real Cisco gear, and watch every packet find its way, from a first ping to OSPF and NAT.</p>
            <div className="hero-actions">
              <button className="btn btn-primary btn-lg" onClick={start}>
                <Icon.Plus /> Start new
              </button>
              <button className="btn btn-lg" onClick={open}>
                <Icon.Folder /> Open file
              </button>
              <a className="btn btn-ghost btn-lg" href="#/learn">
                <Icon.Book /> Try a lab
              </a>
            </div>
          </div>
          <HeroArt />
        </section>
        <section className="features" aria-label="What you can do">
          {FEATURES.map((f) => (
            <div key={f.title} className="feature">
              <span className="feature-icon">
                <f.icon size={22} />
              </span>
              <div>
                <h3>{f.title}</h3>
                <p>{f.text}</p>
              </div>
            </div>
          ))}
        </section>
      </main>
    </div>
  );
}
