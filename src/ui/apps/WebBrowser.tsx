// The Web Browser app: type an address, the PC asks DNS, opens a TCP
// connection to port 80, sends GET and draws what comes back.
// Pages are drawn from the sanitised tree in apps/html.ts, never as raw HTML.

import { createElement, useState, type FormEvent, type ReactNode } from 'react';
import { browse, type Outcome, type Page } from '../../apps/client';
import { parseHtml, type HtmlNode } from '../../apps/html';
import { runApp } from '../../apps/diskStore';
import type { CliEnv } from '../../cli/ios';
import { AppIcon, Steps } from './common';

export function WebBrowser({ deviceId, env }: { deviceId: string; env: CliEnv }) {
  const [address, setAddress] = useState('http://');
  const [history, setHistory] = useState<string[]>([]);
  const [index, setIndex] = useState(-1);
  const [outcome, setOutcome] = useState<Outcome<Page> | null>(null);

  const load = (url: string, push = true) => {
    const r = runApp(env, (sim, disk) => browse(sim, disk, deviceId, url));
    setOutcome(r);
    if (r.ok) setAddress(r.value.url);
    if (push && r.ok) {
      const next = [...history.slice(0, index + 1), r.value.url].slice(-50);
      setHistory(next);
      setIndex(next.length - 1);
    }
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    load(address);
  };

  const go = (i: number) => {
    setIndex(i);
    load(history[i], false);
  };

  /** A link inside the page: relative paths stay on the same server. */
  const follow = (href: string) => {
    if (href.startsWith('http://')) return load(href);
    const base = outcome?.ok ? new URL(outcome.value.url) : null;
    if (base) load(`http://${base.host}${href}`);
  };

  const page = outcome?.ok ? outcome.value : null;

  return (
    <div className="browser">
      <form className="browser-bar" onSubmit={submit}>
        <button type="button" className="icon-btn" aria-label="Back" disabled={index <= 0} onClick={() => go(index - 1)}>
          <AppIcon.Back size={16} />
        </button>
        <button type="button" className="icon-btn" aria-label="Forward" disabled={index >= history.length - 1} onClick={() => go(index + 1)}>
          <AppIcon.Forward size={16} />
        </button>
        <button type="button" className="icon-btn" aria-label="Reload" disabled={!page} onClick={() => page && load(page.url, false)}>
          <AppIcon.Reload size={16} />
        </button>
        <input
          id={`browser-url-${deviceId}`}
          className="browser-url"
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          maxLength={300}
          spellCheck={false}
          aria-label="Address"
          placeholder="http://www.networky.lab"
        />
        <button className="btn btn-primary sm" type="submit">
          Go
        </button>
      </form>

      <Steps outcome={outcome} />

      <article className="browser-page">
        {page ? (
          <>
            <p className="browser-status small muted">
              HTTP {page.status} · {page.title}
            </p>
            <div className="browser-doc">{render(parseHtml(page.body), follow)}</div>
          </>
        ) : (
          <div className="browser-empty muted">
            <AppIcon.Globe size={40} />
            <p>Enter a server's IP address or a name your DNS server knows, then press Go.</p>
            <p className="small">Every server runs a web server with a welcome page until you turn it off in its Services tab.</p>
          </div>
        )}
      </article>
    </div>
  );
}

function render(nodes: HtmlNode[], follow: (href: string) => void): ReactNode[] {
  return nodes.map((n, i) => {
    if (n.type === 'text') return n.text;
    if (n.tag === 'a') {
      return n.href ? (
        <a
          key={i}
          href="#"
          title={n.href}
          onClick={(e) => {
            e.preventDefault();
            follow(n.href!);
          }}
        >
          {render(n.children, follow)}
        </a>
      ) : (
        <span key={i} className="browser-deadlink" title="This link points somewhere the simulated browser cannot go">
          {render(n.children, follow)}
        </span>
      );
    }
    // Only tags from the allow-list reach here, and no attributes at all.
    return createElement(n.tag, { key: i }, ...(n.children.length ? render(n.children, follow) : []));
  });
}
