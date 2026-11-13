// The Messaging app: one TCP connection to port 5222 per message.
// Every PC, laptop and server runs it, so any two computers that can reach
// each other can chat (unless an ACL or NAT gets in the way, which is the lesson).

import { useState, type FormEvent } from 'react';
import { sendChat, type Outcome } from '../../apps/client';
import { runApp, useDiskStore, useDiskVersion } from '../../apps/diskStore';
import { diskOf } from '../../engine/plugins/apps/disk';
import type { CliEnv } from '../../cli/ios';
import { Row, Steps } from './common';

export function Messaging({ deviceId }: { deviceId: string; env: CliEnv }) {
  useDiskVersion();
  const chats = diskOf(useDiskStore.getState().disk, deviceId).chats;
  const peers = Object.keys(chats);
  const [peer, setPeer] = useState(peers[0] ?? '');
  const [text, setText] = useState('');
  const [outcome, setOutcome] = useState<Outcome<string> | null>(null);
  const lines = chats[peer.trim()] ?? [];

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const r = runApp((sim, disk) => sendChat(sim, disk, deviceId, peer, text));
    setOutcome(r.ok ? null : r);
    if (r.ok) {
      setText('');
      setPeer(r.value); // a name becomes the IP the conversation is filed under
    }
  };

  return (
    <div className="chat">
      {peers.length > 0 && (
        <div className="chat-peers" role="tablist" aria-label="Conversations">
          {peers.map((p) => (
            <button key={p} type="button" role="tab" aria-selected={p === peer} className={p === peer ? 'active' : ''} onClick={() => setPeer(p)}>
              {p}
            </button>
          ))}
        </div>
      )}
      <form className="app-form" onSubmit={submit}>
        <Row label="To">
          <input id={`chat-peer-${deviceId}`} value={peer} onChange={(e) => setPeer(e.target.value)} placeholder="192.168.1.11 or pc1.networky.lab" maxLength={253} required />
        </Row>
        <div className="chat-log" aria-live="polite">
          {lines.length ? (
            lines.map((l, i) => (
              <div key={i} className={`chat-line ${l.from}`}>
                <span className="chat-name small">{l.from === 'me' ? 'You' : l.name}</span>
                <span className="chat-bubble">{l.text}</span>
              </div>
            ))
          ) : (
            <p className="muted small">No messages with {peer || 'anyone'} yet. Messages travel over TCP port 5222.</p>
          )}
        </div>
        <div className="chat-compose">
          <input id={`chat-text-${deviceId}`} value={text} onChange={(e) => setText(e.target.value)} placeholder="Type a message" maxLength={1000} aria-label="Message" />
          <button className="btn btn-primary sm" type="submit" disabled={!text.trim() || !peer.trim()}>
            Send
          </button>
        </div>
        <Steps outcome={outcome} />
      </form>
    </div>
  );
}
