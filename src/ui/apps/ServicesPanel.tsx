// A server's Services tab: turn services on and off and configure them.
// Edits are a draft until Save, so typing a page doesn't restart the network
// on every key press (any topology change power-cycles the simulation).

import { useEffect, useState } from 'react';
import { useDiskStore, useDiskVersion } from '../../apps/diskStore';
import { diskOf } from '../../engine/plugins/apps/disk';
import type { CliEnv } from '../../cli/ios';
import { PORTS, servicesOf, setServices, type Account, type ServicesConfig } from '../../model/services';
import { useTopologyStore } from '../../store/topologyStore';

type Section = 'http' | 'dns' | 'mail' | 'ftp';

export function ServicesPanel({ deviceId, env }: { deviceId: string; env: CliEnv }) {
  const device = useTopologyStore((s) => s.topology.devices[deviceId]);
  const saved = device ? servicesOf(device) : {};
  const [draft, setDraft] = useState<ServicesConfig>(saved);
  const [section, setSection] = useState<Section>('http');
  const [error, setError] = useState<string | null>(null);
  const [savedNote, setSavedNote] = useState(false);
  useDiskVersion();

  // Undo/redo or another window changed the config: start from it again.
  useEffect(() => setDraft(saved), [device?.services]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!device) return null;
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);
  const disk = diskOf(useDiskStore.getState().disk, deviceId);

  const save = () => {
    try {
      env.apply((t) => setServices(t, deviceId, draft));
      setError(null);
      setSavedNote(true);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const patch = (p: Partial<ServicesConfig>) => {
    setDraft({ ...draft, ...p });
    setSavedNote(false);
  };

  const http = draft.http ?? { enabled: false, pages: [] };
  const dns = draft.dns ?? { enabled: false, records: [] };
  const mail = draft.mail ?? { enabled: false, domain: 'networky.lab', accounts: [] };
  const ftp = draft.ftp ?? { enabled: false, accounts: [], files: [] };

  const tabs: [Section, string, boolean, number][] = [
    ['http', 'Web (HTTP)', http.enabled, PORTS.http],
    ['dns', 'DNS', dns.enabled, PORTS.dns],
    ['mail', 'Email', mail.enabled, PORTS.smtp],
    ['ftp', 'FTP', ftp.enabled, PORTS.ftp],
  ];

  return (
    <div className="services">
      <nav className="services-nav" aria-label="Services">
        {tabs.map(([key, label, on, port]) => (
          <button key={key} type="button" className={section === key ? 'active' : ''} aria-pressed={section === key} onClick={() => setSection(key)}>
            <span className={`dot ${on ? 'up' : ''}`} aria-hidden="true" />
            {label}
            <span className="small muted">{key === 'mail' ? '25, 110' : port}</span>
          </button>
        ))}
      </nav>

      <div className="services-body">
        {section === 'http' && (
          <>
            <Toggle label="Web server (HTTP, TCP 80)" on={http.enabled} set={(enabled) => patch({ http: { ...http, enabled } })} />
            <p className="small muted">Allowed markup: h1–h3, p, b, i, u, ul, ol, li, a href, code, pre, blockquote, br, hr. Scripts and styles are removed when the page is shown.</p>
            {http.pages.map((p, i) => (
              <fieldset key={i} className="services-card">
                <div className="services-grid">
                  <input aria-label="Path" value={p.path} maxLength={65} onChange={(e) => patch({ http: { ...http, pages: http.pages.map((x, j) => (j === i ? { ...x, path: e.target.value } : x)) } })} />
                  <input aria-label="Title" value={p.title} maxLength={80} onChange={(e) => patch({ http: { ...http, pages: http.pages.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)) } })} />
                  <button type="button" className="btn sm danger-outline" onClick={() => patch({ http: { ...http, pages: http.pages.filter((_, j) => j !== i) } })}>
                    Remove
                  </button>
                </div>
                <textarea className="app-textarea mono" rows={5} aria-label={`Body of ${p.path}`} value={p.body} maxLength={8000} onChange={(e) => patch({ http: { ...http, pages: http.pages.map((x, j) => (j === i ? { ...x, body: e.target.value } : x)) } })} />
              </fieldset>
            ))}
            <button type="button" className="btn sm" onClick={() => patch({ http: { ...http, pages: [...http.pages, { path: `/page${http.pages.length + 1}.html`, title: 'New page', body: '<h1>New page</h1>' }] } })}>
              Add page
            </button>
          </>
        )}

        {section === 'dns' && (
          <>
            <Toggle label="DNS server (UDP 53)" on={dns.enabled} set={(enabled) => patch({ dns: { ...dns, enabled } })} />
            <p className="small muted">A records: a name and the IPv4 address it stands for. Clients use this server when it is set as their DNS server (Config, or a DHCP pool).</p>
            <table className="app-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Address</th>
                  <th aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {dns.records.map((r, i) => (
                  <tr key={i}>
                    <td>
                      <input aria-label="Name" value={r.name} maxLength={253} onChange={(e) => patch({ dns: { ...dns, records: dns.records.map((x, j) => (j === i ? { ...x, name: e.target.value.toLowerCase() } : x)) } })} />
                    </td>
                    <td>
                      <input aria-label="Address" value={r.address} maxLength={15} onChange={(e) => patch({ dns: { ...dns, records: dns.records.map((x, j) => (j === i ? { ...x, address: e.target.value.trim() } : x)) } })} />
                    </td>
                    <td className="actions">
                      <button type="button" className="btn sm danger-outline" onClick={() => patch({ dns: { ...dns, records: dns.records.filter((_, j) => j !== i) } })}>
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <button type="button" className="btn sm" onClick={() => patch({ dns: { ...dns, records: [...dns.records, { name: 'www.networky.lab', type: 'A', address: '' }] } })}>
              Add record
            </button>
          </>
        )}

        {section === 'mail' && (
          <>
            <Toggle label="Mail server (SMTP 25, POP3 110)" on={mail.enabled} set={(enabled) => patch({ mail: { ...mail, enabled } })} />
            <label className="app-row">
              <span>Domain</span>
              <input value={mail.domain} maxLength={253} onChange={(e) => patch({ mail: { ...mail, domain: e.target.value.toLowerCase().trim() } })} />
            </label>
            <Accounts accounts={mail.accounts} set={(accounts) => patch({ mail: { ...mail, accounts } })} extra={(a) => `${(disk.mailboxes[a.user] ?? []).length} waiting`} />
          </>
        )}

        {section === 'ftp' && (
          <>
            <Toggle label="FTP server (TCP 21)" on={ftp.enabled} set={(enabled) => patch({ ftp: { ...ftp, enabled } })} />
            <Accounts accounts={ftp.accounts} set={(accounts) => patch({ ftp: { ...ftp, accounts } })} />
            <h4>Starting files</h4>
            {ftp.files.map((f, i) => (
              <fieldset key={i} className="services-card">
                <div className="services-grid two">
                  <input aria-label="File name" value={f.name} maxLength={64} onChange={(e) => patch({ ftp: { ...ftp, files: ftp.files.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) } })} />
                  <button type="button" className="btn sm danger-outline" onClick={() => patch({ ftp: { ...ftp, files: ftp.files.filter((_, j) => j !== i) } })}>
                    Remove
                  </button>
                </div>
                <textarea className="app-textarea mono" rows={3} aria-label={`Contents of ${f.name}`} value={f.content} maxLength={20000} onChange={(e) => patch({ ftp: { ...ftp, files: ftp.files.map((x, j) => (j === i ? { ...x, content: e.target.value } : x)) } })} />
              </fieldset>
            ))}
            <button type="button" className="btn sm" onClick={() => patch({ ftp: { ...ftp, files: [...ftp.files, { name: `file${ftp.files.length + 1}.txt`, content: '' }] } })}>
              Add file
            </button>
            {disk.ftpFiles && <p className="small muted">On disk now (after uploads and deletes): {disk.ftpFiles.map((f) => f.name).join(', ') || 'no files'}.</p>}
          </>
        )}
      </div>

      <footer className="services-foot">
        {error && <p className="app-error">{error}</p>}
        {savedNote && !dirty && <span className="app-ok small">Saved. The network restarted with the new settings.</span>}
        <span className="spacer" />
        <button type="button" className="btn sm ghost" disabled={!dirty} onClick={() => { setDraft(saved); setError(null); }}>
          Discard
        </button>
        <button type="button" className="btn btn-primary sm" disabled={!dirty} onClick={save}>
          Save
        </button>
      </footer>
    </div>
  );
}

function Toggle({ label, on, set }: { label: string; on: boolean; set: (on: boolean) => void }) {
  return (
    <label className="services-toggle">
      <input type="checkbox" checked={on} onChange={(e) => set(e.target.checked)} />
      <b>{label}</b>
      <span className={`small ${on ? 'app-ok' : 'muted'}`}>{on ? 'On' : 'Off'}</span>
    </label>
  );
}

function Accounts({ accounts, set, extra }: { accounts: Account[]; set: (a: Account[]) => void; extra?: (a: Account) => string }) {
  return (
    <>
      <h4>Accounts</h4>
      <table className="app-table">
        <thead>
          <tr>
            <th>User</th>
            <th>Password</th>
            {extra && <th>Mailbox</th>}
            <th aria-label="Actions" />
          </tr>
        </thead>
        <tbody>
          {accounts.map((a, i) => (
            <tr key={i}>
              <td>
                <input aria-label="User" value={a.user} maxLength={32} onChange={(e) => set(accounts.map((x, j) => (j === i ? { ...x, user: e.target.value.toLowerCase().trim() } : x)))} />
              </td>
              <td>
                <input aria-label="Password" value={a.password} maxLength={64} onChange={(e) => set(accounts.map((x, j) => (j === i ? { ...x, password: e.target.value } : x)))} />
              </td>
              {extra && <td className="small muted">{extra(a)}</td>}
              <td className="actions">
                <button type="button" className="btn sm danger-outline" onClick={() => set(accounts.filter((_, j) => j !== i))}>
                  Remove
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <button type="button" className="btn sm" onClick={() => set([...accounts, { user: `user${accounts.length + 1}`, password: 'cisco' }])}>
        Add account
      </button>
    </>
  );
}
