// The Email app: SMTP (port 25) to send, POP3 (port 110) to fetch.
// The account settings are part of the PC's configuration (saved with the
// project); the mail itself lives on the session disk.

import { useState, type FormEvent } from 'react';
import { fetchMail, sendMail, type MailAccount, type Outcome } from '../../apps/client';
import { runApp, useDiskStore, useDiskVersion } from '../../apps/diskStore';
import { diskOf } from '../../engine/plugins/apps/disk';
import type { Mail } from '../../engine/plugins/apps/messages';
import type { CliEnv } from '../../cli/ios';
import { servicesOf, setServices, type MailClientConfig } from '../../model/services';
import { Row, Steps } from './common';

type View = 'inbox' | 'compose' | 'sent' | 'settings';

const EMPTY: MailClientConfig = { name: '', address: '', smtpServer: '', pop3Server: '', user: '', password: '' };

export function Email({ deviceId, env }: { deviceId: string; env: CliEnv }) {
  useDiskVersion();
  const device = env.topology().devices[deviceId];
  const account = device ? servicesOf(device).mailClient : undefined;
  const [view, setView] = useState<View>(account ? 'inbox' : 'settings');
  const [outcome, setOutcome] = useState<Outcome<unknown> | null>(null);
  const [open, setOpen] = useState<Mail | null>(null);
  if (!device) return null;
  const disk = diskOf(useDiskStore.getState().disk, deviceId);

  const receive = () => {
    if (!account) return;
    setOutcome(runApp((sim, d) => fetchMail(sim, d, deviceId, account)));
  };

  return (
    <div className="mail">
      <nav className="seg mail-tabs" aria-label="Mail">
        {(['inbox', 'compose', 'sent', 'settings'] as View[]).map((v) => (
          <button key={v} type="button" className={view === v ? 'active' : ''} aria-pressed={view === v} disabled={!account && v !== 'settings'} onClick={() => { setView(v); setOutcome(null); setOpen(null); }}>
            {{ inbox: `Inbox (${disk.inbox.length})`, compose: 'Compose', sent: 'Sent', settings: 'Account' }[v]}
          </button>
        ))}
      </nav>

      {view === 'inbox' && account && (
        <>
          <div className="app-actions">
            <button className="btn btn-primary sm" type="button" onClick={receive}>
              Receive
            </button>
            <span className="small muted">
              Fetches new mail for {account.user} from {account.pop3Server} with POP3. The server deletes what it hands over.
            </span>
          </div>
          <Steps outcome={outcome} />
          <MailList mails={[...disk.inbox].reverse()} empty="No mail yet. Press Receive to check the server." onOpen={setOpen} open={open} who="from" />
        </>
      )}

      {view === 'sent' && <MailList mails={[...disk.sent].reverse()} empty="Nothing sent yet." onOpen={setOpen} open={open} who="to" />}

      {view === 'compose' && account && <Compose deviceId={deviceId} account={account} onDone={setOutcome} outcome={outcome} />}

      {view === 'settings' && (
        <AccountForm
          initial={account ?? { ...EMPTY, name: device.hostname }}
          onSave={(c) => {
            env.apply((t) => setServices(t, deviceId, { ...servicesOf(t.devices[deviceId]), mailClient: c }));
            setView('inbox');
          }}
        />
      )}
    </div>
  );
}

function MailList({ mails, empty, open, onOpen, who }: { mails: Mail[]; empty: string; open: Mail | null; onOpen: (m: Mail | null) => void; who: 'from' | 'to' }) {
  if (open)
    return (
      <div className="mail-read">
        <button type="button" className="text-btn small" onClick={() => onOpen(null)}>
          ← Back to the list
        </button>
        <h4>{open.subject || '(no subject)'}</h4>
        <p className="small muted">
          From {open.from} to {open.to}
        </p>
        <pre className="mail-body">{open.body}</pre>
      </div>
    );
  if (!mails.length) return <p className="muted small">{empty}</p>;
  return (
    <ul className="mail-list">
      {mails.map((m, i) => (
        <li key={i}>
          <button type="button" onClick={() => onOpen(m)}>
            <b>{m[who]}</b>
            <span>{m.subject || '(no subject)'}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

function Compose({ deviceId, account, outcome, onDone }: { deviceId: string; account: MailAccount; outcome: Outcome<unknown> | null; onDone: (o: Outcome<unknown>) => void }) {
  const [to, setTo] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const r = runApp((sim, d) => sendMail(sim, d, deviceId, account, to, subject, body));
    onDone(r);
    if (r.ok) {
      setTo('');
      setSubject('');
      setBody('');
    }
  };
  return (
    <form className="app-form" onSubmit={submit}>
      <Row label="To">
        <input id={`mail-to-${deviceId}`} value={to} onChange={(e) => setTo(e.target.value)} placeholder="bob@networky.lab" maxLength={290} required />
      </Row>
      <Row label="Subject">
        <input id={`mail-subject-${deviceId}`} value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={200} />
      </Row>
      <textarea id={`mail-body-${deviceId}`} className="app-textarea" value={body} onChange={(e) => setBody(e.target.value)} rows={8} maxLength={8000} aria-label="Message" />
      <div className="app-actions">
        <button className="btn btn-primary sm" type="submit">
          Send
        </button>
        <span className="small muted">Sent with SMTP to {account.smtpServer}.</span>
      </div>
      {outcome?.ok && <p className="app-ok small">Sent. The server answered: {String(outcome.value)}</p>}
      <Steps outcome={outcome} />
    </form>
  );
}

function AccountForm({ initial, onSave }: { initial: MailClientConfig; onSave: (c: MailClientConfig) => void }) {
  const [c, setC] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const field = (key: keyof MailClientConfig, label: string, placeholder: string, type = 'text') => (
    <Row label={label}>
      <input id={`mail-${key}`} type={type} value={c[key]} placeholder={placeholder} maxLength={key === 'address' ? 290 : 64} onChange={(e) => setC({ ...c, [key]: e.target.value.trim() === '' ? '' : e.target.value })} />
    </Row>
  );
  const submit = (e: FormEvent) => {
    e.preventDefault();
    try {
      onSave({ ...c, address: c.address.trim().toLowerCase(), user: c.user.trim().toLowerCase(), smtpServer: c.smtpServer.trim().toLowerCase(), pop3Server: c.pop3Server.trim().toLowerCase() });
    } catch (err) {
      setError((err as Error).message);
    }
  };
  return (
    <form className="app-form" onSubmit={submit}>
      <p className="small muted">The account lives on a mail server: turn on Email in the server's Services tab and add this user there.</p>
      {field('name', 'Your name', 'Alice')}
      {field('address', 'Email address', 'alice@networky.lab')}
      {field('smtpServer', 'Outgoing server (SMTP)', 'mail.networky.lab or 10.0.0.5')}
      {field('pop3Server', 'Incoming server (POP3)', 'mail.networky.lab or 10.0.0.5')}
      {field('user', 'User name', 'alice')}
      {field('password', 'Password', '', 'password')}
      {error && <p className="app-error">{error}</p>}
      <div className="app-actions">
        <button className="btn btn-primary sm" type="submit">
          Save account
        </button>
      </div>
    </form>
  );
}
