// All GSAP animation lives here.
//
// Rule 1: the page is complete without this file. Every element is visible in
// the HTML and CSS; animations only start from a hidden state that GSAP itself
// sets. So search engines, no-JS visitors and a failed script all get the full
// page, never a blank one.
//
// Rule 2: visitors who ask for reduced motion get none. gsap.matchMedia()
// runs the setup only under (prefers-reduced-motion: no-preference) and undoes
// everything automatically if the setting changes while the page is open.
//
// Rule 3: the packet loop pauses when the hero scrolls out of view, so the
// page costs nothing while someone reads the labs section.

import { gsap } from 'gsap';
import { MotionPathPlugin } from 'gsap/MotionPathPlugin';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

gsap.registerPlugin(MotionPathPlugin, ScrollTrigger);

/** One hop of a packet: a cable, and which way it is travelled. */
interface Hop {
  link: string;
  /** Cables are drawn top-down (router → switch → host); upward hops run them backwards. */
  up?: boolean;
  /** Halo to light up when the packet arrives. */
  arrive: string;
}

const HOP_SECONDS = 0.7;

/** Builds a timeline that carries one packet along a list of hops. */
function journey(packet: string, hops: Hop[]): gsap.core.Timeline {
  const tl = gsap.timeline();
  tl.set(packet, { opacity: 1 });
  hops.forEach((hop, i) => {
    // Each hop starts together with the glow of the previous arrival ('<' is
    // "start of the last tween added"), so the packet never waits for it.
    tl.to(packet, {
      duration: HOP_SECONDS,
      ease: 'power1.inOut',
      motionPath: {
        path: `#${hop.link}`,
        align: `#${hop.link}`,
        alignOrigin: [0.5, 0.5],
        start: hop.up ? 1 : 0,
        end: hop.up ? 0 : 1,
      },
    }, i === 0 ? '>' : '<');
    // The node glows as the packet reaches it.
    tl.to(`#${hop.arrive}`, { opacity: 0.95, scale: 1.12, svgOrigin: originOf(hop.arrive), duration: 0.22, yoyo: true, repeat: 1, ease: 'sine.out' }, '>');
  });
  tl.to(packet, { opacity: 0, duration: 0.15 }, '<0.1');
  return tl;
}

function originOf(id: string): string {
  const el = document.getElementById(id);
  return el ? `${el.getAttribute('cx')} ${el.getAttribute('cy')}` : '0 0';
}

/** Reverses a path through the topology for the reply. */
function back(hops: Hop[], start: string): Hop[] {
  const out: Hop[] = [];
  for (let i = hops.length - 1; i >= 0; i--) {
    out.push({ link: hops[i].link, up: !hops[i].up, arrive: i === 0 ? start : hops[i - 1].arrive });
  }
  return out;
}

// PC1 pings the server: up through switch 1, across the router, down to the server.
const PING: Hop[] = [
  { link: 'l-s1-pc1', up: true, arrive: 'h-s1' },
  { link: 'l-r-s1', up: true, arrive: 'h-r' },
  { link: 'l-r-s2', arrive: 'h-s2' },
  { link: 'l-s2-srv', arrive: 'h-srv' },
];
// Before talking off-subnet, hosts ARP for their gateway (the router).
const ARP_PC2: Hop[] = [
  { link: 'l-s2-pc2', up: true, arrive: 'h-s2' },
  { link: 'l-r-s2', up: true, arrive: 'h-r' },
];
const ARP_LAPTOP: Hop[] = [
  { link: 'l-s1-lap', up: true, arrive: 'h-s1' },
  { link: 'l-r-s1', up: true, arrive: 'h-r' },
];

function heroEntrance(): void {
  const tl = gsap.timeline({ defaults: { ease: 'power3.out' } });
  // The background blob stays put: it is the stage, not an actor.
  tl.from('[data-hero]', { y: 28, opacity: 0, duration: 0.8, stagger: 0.09 });

  // Cables draw themselves in, using the classic stroke-dash trick.
  document.querySelectorAll<SVGPathElement>('.links path').forEach((path) => {
    const length = path.getTotalLength();
    gsap.set(path, { strokeDasharray: length, strokeDashoffset: length });
  });
  tl.to('.links path', { strokeDashoffset: 0, duration: 0.9, stagger: 0.08, ease: 'power2.inOut' }, 0.35)
    .from('.nodes .node', { opacity: 0, y: 14, duration: 0.6, stagger: 0.07 }, 0.4)
    .from('.link-dots circle', { opacity: 0, duration: 0.4, stagger: 0.02 }, 1.0)
    .from('.art-legend', { opacity: 0, duration: 0.5 }, 1.2)
    // Clear the dash so the cables stay crisp at any zoom.
    .set('.links path', { clearProps: 'strokeDasharray,strokeDashoffset' });
}

function packetLoop(): void {
  const loop = gsap.timeline({ repeat: -1, repeatDelay: 0.6, delay: 1.6 });
  loop
    .add(journey('#p-arp', ARP_PC2))
    .add(journey('#p-arp', back(ARP_PC2, 'h-pc2')))
    .add(journey('#p-icmp', PING), '-=0.2')
    .add(journey('#p-icmp', back(PING, 'h-pc1')))
    .add(journey('#p-arp', ARP_LAPTOP), '+=0.3')
    .add(journey('#p-arp', back(ARP_LAPTOP, 'h-lap')));

  // Idle glow on the cable joints, so the picture breathes between packets.
  const breathe = gsap.to('.link-dots circle', {
    opacity: 0.35, duration: 1.4, ease: 'sine.inOut', yoyo: true, repeat: -1,
    stagger: { each: 0.12, from: 'random' }, delay: 1.6,
  });

  ScrollTrigger.create({
    trigger: '.hero',
    start: 'top bottom',
    end: 'bottom top',
    onToggle: (self) => [loop, breathe].forEach((t) => (self.isActive ? t.play() : t.pause())),
  });
}

function scrollReveals(): void {
  gsap.set('[data-reveal]', { opacity: 0, y: 32 });
  ScrollTrigger.batch('[data-reveal]', {
    start: 'top 88%',
    once: true,
    onEnter: (batch) => gsap.to(batch, { opacity: 1, y: 0, duration: 0.7, stagger: 0.1, ease: 'power3.out', overwrite: true }),
  });
}

export function initMotion(): void {
  const mm = gsap.matchMedia();
  mm.add('(prefers-reduced-motion: no-preference)', () => {
    heroEntrance();
    packetLoop();
    scrollReveals();
  });
}
