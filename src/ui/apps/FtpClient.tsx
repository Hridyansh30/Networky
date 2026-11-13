// The FTP Client app: log in to a server on port 21, list, download, upload
// and delete files. Each button is one TCP connection carrying USER, PASS and
// one command (see the simplifications in engine/plugins/apps/messages.ts).

import { useState, type FormEvent } from 'react';
import { ftp, type FtpCommand, type Outcome } from '../../apps/client';
import { runApp } from '../../apps/diskStore';
import type { FileEntry } from '../../engine/plugins/apps/messages';
import type { CliEnv } from '../../cli/ios';
import { Row, Steps } from './common';

export function FtpClient({ deviceId }: { deviceId: string; env: CliEnv }) {
  const [server, setServer] = useState('');
  const [user, setUser] = useState('');
  const [password, setPassword] = useState('');
  const [files, setFiles] = useState<FileEntry[] | null>(null);
  const [viewing, setViewing] = useState<{ name: string; content: string } | null>(null);
  const [upload, setUpload] = useState({ name: '', content: '' });
  const [outcome, setOutcome] = useState<Outcome<unknown> | null>(null);

  const run = (command: FtpCommand) => runApp((sim, disk) => ftp(sim, disk, deviceId, server, user, password, command));

  const list = () => {
    const r = run({ cmd: 'list' });
    setOutcome(r);
    setFiles(r.ok ? (r.value.files ?? []) : null);
  };

  const connect = (e: FormEvent) => {
    e.preventDefault();
    setViewing(null);
    list();
  };

  const act = (command: FtpCommand) => {
    const r = run(command);
    setOutcome(r);
    if (r.ok && command.cmd === 'get') setViewing({ name: command.name, content: r.value.content ?? '' });
    if (r.ok && command.cmd !== 'get') {
      const again = run({ cmd: 'list' });
      if (again.ok) setFiles(again.value.files ?? []);
    }
  };

  const send = (e: FormEvent) => {
    e.preventDefault();
    act({ cmd: 'put', name: upload.name.trim(), content: upload.content });
    setUpload({ name: '', content: '' });
  };

  return (
    <div className="ftp">
      <form className="app-form" onSubmit={connect}>
        <Row label="Server">
          <input id={`ftp-server-${deviceId}`} value={server} onChange={(e) => setServer(e.target.value)} placeholder="10.0.0.5 or ftp.networky.lab" maxLength={253} required />
        </Row>
        <Row label="User name">
          <input id={`ftp-user-${deviceId}`} value={user} onChange={(e) => setUser(e.target.value)} maxLength={32} autoComplete="off" required />
        </Row>
        <Row label="Password">
          <input id={`ftp-pass-${deviceId}`} type="password" value={password} onChange={(e) => setPassword(e.target.value)} maxLength={64} autoComplete="off" required />
        </Row>
        <div className="app-actions">
          <button className="btn btn-primary sm" type="submit">
            Connect
          </button>
          <span className="small muted">FTP sends the password unencrypted. Watch it in the event list.</span>
        </div>
      </form>

      <Steps outcome={outcome} />

      {files && (
        <section className="ftp-files">
          <h4>
            Files on {server} ({files.length})
          </h4>
          {files.length ? (
            <table className="app-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Size</th>
                  <th aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {files.map((f) => (
                  <tr key={f.name}>
                    <td>{f.name}</td>
                    <td className="num">{f.size} B</td>
                    <td className="actions">
                      <button type="button" className="btn sm" onClick={() => act({ cmd: 'get', name: f.name })}>
                        Download
                      </button>
                      <button type="button" className="btn sm danger-outline" onClick={() => act({ cmd: 'delete', name: f.name })}>
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="muted small">The server has no files.</p>
          )}

          {viewing && (
            <div className="ftp-view">
              <b>{viewing.name}</b>
              <pre>{viewing.content || '(empty file)'}</pre>
            </div>
          )}

          <form className="app-form" onSubmit={send}>
            <h4>Upload a file</h4>
            <Row label="File name">
              <input id={`ftp-upname-${deviceId}`} value={upload.name} onChange={(e) => setUpload({ ...upload, name: e.target.value })} placeholder="notes.txt" maxLength={64} required />
            </Row>
            <textarea id={`ftp-upbody-${deviceId}`} className="app-textarea" rows={4} value={upload.content} onChange={(e) => setUpload({ ...upload, content: e.target.value })} maxLength={20000} aria-label="File contents" />
            <div className="app-actions">
              <button className="btn sm" type="submit">
                Upload (STOR)
              </button>
            </div>
          </form>
        </section>
      )}
    </div>
  );
}
