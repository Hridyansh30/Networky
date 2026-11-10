// The "See it working" videos.
//
// The HTML alone is a normal <video> with controls and a poster, so the page
// works without JavaScript. This script upgrades it:
//   - plays muted while it is on screen and pauses when it scrolls away
//     (no bandwidth or CPU spent on a video nobody is looking at)
//   - swaps between the three clips from the tabs
//   - shows the light or dark recording to match the page theme
//   - with reduced motion on, never autoplays: the visitor presses play.
//   - always keeps the native controls, so it can be paused.
// preload="none" means nothing downloads until the video is needed.

import { currentTheme } from './theme';

const CLIPS = {
  simulate: 'A ping from PC0 to PC1 in Simulation mode: ARP finds each next hop, then the ICMP echo crosses the router one cable at a time while the event list records every frame.',
  cli: 'Configuring router R1 from its IOS-style CLI: show ip interface brief, show ip route, then a ping across the serial link to the other LAN.',
  apps: "PC1's Desktop: the web browser loads a page through NAT, then the FTP client is refused because ACL 110 only lets web traffic out. The app says why.",
} as const;
type Clip = keyof typeof CLIPS;

export function initDemo(): void {
  const video = document.getElementById('demo-video') as HTMLVideoElement | null;
  const caption = document.getElementById('demo-caption');
  const tabs = Array.from(document.querySelectorAll<HTMLButtonElement>('.demo-tabs [data-clip]'));
  if (!video || !caption) return;

  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  let clip: Clip = 'simulate';
  let visible = false;

  const load = () => {
    const base = `./videos/${clip}-${currentTheme()}`;
    const wasPlaying = !video.paused;
    video.poster = `${base}.jpg`;
    video.replaceChildren(
      Object.assign(document.createElement('source'), { src: `${base}.webm`, type: 'video/webm' }),
      Object.assign(document.createElement('source'), { src: `${base}.mp4`, type: 'video/mp4' }),
    );
    video.load();
    caption.textContent = CLIPS[clip];
    if (wasPlaying || (visible && !reduced.matches)) void video.play().catch(() => undefined);
  };

  // Autoplay only when allowed. The native controls stay on either way:
  // anything that moves for more than 5 seconds needs a pause button
  // (WCAG 2.2.2), and muted autoplay is not an excuse to drop it.
  const sync = () => {
    if (visible && !reduced.matches) void video.play().catch(() => undefined);
    else if (!visible) video.pause();
  };

  new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting;
    sync();
  }, { threshold: 0.35 }).observe(video);
  reduced.addEventListener('change', sync);

  tabs.forEach((tab) =>
    tab.addEventListener('click', () => {
      clip = tab.dataset.clip as Clip;
      tabs.forEach((t) => t.setAttribute('aria-selected', String(t === tab)));
      load();
    }),
  );
  // Arrow keys move between tabs, as a tablist should.
  tabs.forEach((tab, i) =>
    tab.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
      const next = tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
      next.focus();
      next.click();
    }),
  );

  // Follow the theme: the toggle sets data-theme, the system can change too.
  new MutationObserver(load).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', load);
  if (currentTheme() !== 'dark') load(); // the HTML defaults to the dark clip
  sync();
}
