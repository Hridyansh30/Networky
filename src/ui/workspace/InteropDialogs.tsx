// Phase 4 dialogs: Export (pick a format, preview, notes, download) and
// Import (paste or choose a Cisco config, see what will happen, apply).
//
// Both are thin views over src/interop, which holds all the logic and the
// tests. The import is a DRY RUN on every change: the report shows exactly
// what Apply will do, and Apply commits that same result as one undo step.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { EXPORTERS, fileStem, IMPORT_LIMITS, importCiscoConfig, type ImportNote } from '../../interop';
import { useProjectStore } from '../../store/projectStore';
import { useTopologyStore } from '../../store/topologyStore';
import { useUiStore } from '../../store/uiStore';
import { Icon } from '../icons';
import { downloadText } from '../openFile';

/** A stable close function: a new one each render would re-run useDialog's effect and steal focus. */
function useClose() {
  const setInterop = useUiStore((s) => s.setInterop);
  return useCallback(() => setInterop(null), [setInterop]);
}

/** Escape closes, and focus moves into the dialog when it opens. */
function useDialog(onClose: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return ref;
}

async function copy(text: string, notify: (t: string, k?: 'error' | 'info') => void) {
  try {
    await navigator.clipboard.writeText(text);
    notify('Copied to the clipboard', 'info');
  } catch {
    notify('The browser did not allow copying. Select the text and copy it instead.');
  }
}

const PREVIEW_LIMIT = 200_000;

export function InteropDialogs() {
  const dialog = useUiStore((s) => s.interop);
  if (dialog === 'export') return <ExportDialog />;
  if (dialog === 'import') return <ImportDialog />;
  return null;
}

function ExportDialog() {
  const close = useClose();
  const ref = useDialog(close);
  const topology = useTopologyStore((s) => s.topology);
  const layout = useTopologyStore((s) => s.layout);
  const notify = useTopologyStore((s) => s.notify);
  const name = useProjectStore((s) => s.name);
  const [id, setId] = useState(EXPORTERS[0].id);
  const exporter = EXPORTERS.find((e) => e.id === id)!;
  const result = useMemo(() => exporter.export({ topology, layout, name: fileStem(name) }), [exporter, topology, layout, name]);
  const lines = result.text.split('\n').length;

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="modal interop" role="dialog" aria-modal="true" aria-labelledby="export-title" tabIndex={-1} ref={ref}>
        <header className="modal-head">
          <Icon.Download size={20} />
          <h2 id="export-title">Export</h2>
          <span className="spacer" />
          <button className="icon-btn" onClick={close} aria-label="Close" title="Close (Esc)">
            <Icon.Close size={18} />
          </button>
        </header>
        <div className="interop-body">
          <div className="format-list" role="radiogroup" aria-label="Format">
            {EXPORTERS.map((e) => (
              <button key={e.id} role="radio" aria-checked={e.id === id} className={`format ${e.id === id ? 'on' : ''}`} onClick={() => setId(e.id)}>
                <strong>{e.title}</strong>
                <span className="muted small">{e.description}</span>
              </button>
            ))}
          </div>
          <div className="interop-preview">
            <div className="preview-bar">
              <span className="mono small">{result.fileName}</span>
              <span className="muted small">
                {exporter.language} · {lines} lines
              </span>
            </div>
            {result.notes.length > 0 && (
              <details className="interop-notes" open={result.notes.length <= 4}>
                <summary>
                  <Icon.Info size={14} /> {result.notes.length} thing{result.notes.length === 1 ? '' : 's'} did not translate
                </summary>
                <ul>
                  {result.notes.map((n) => (
                    <li key={n}>{n}</li>
                  ))}
                </ul>
              </details>
            )}
            <pre className="code-preview" tabIndex={0} aria-label={`${exporter.title} preview`}>
              {result.text.length > PREVIEW_LIMIT ? result.text.slice(0, PREVIEW_LIMIT) + '\n… (the download has the rest)' : result.text}
            </pre>
          </div>
        </div>
        <footer className="modal-foot">
          {id === 'terraform-aws' && <span className="muted small">Networky never contacts AWS. You review the file and run terraform yourself.</span>}
          <span className="spacer" />
          <button className="btn sm" onClick={() => copy(result.text, notify)}>
            <Icon.Copy size={15} /> Copy
          </button>
          <button
            className="btn sm btn-primary"
            onClick={() => {
              downloadText(result.text, result.fileName, result.mime);
              close();
            }}
          >
            <Icon.Download size={15} /> Download
          </button>
        </footer>
      </div>
    </div>
  );
}

const LEVEL_LABEL: Record<ImportNote['level'], string> = { error: 'Error', skipped: 'Skipped', info: 'Note' };

function ImportDialog() {
  const close = useClose();
  const ref = useDialog(close);
  const topology = useTopologyStore((s) => s.topology);
  const layout = useTopologyStore((s) => s.layout);
  const notify = useTopologyStore((s) => s.notify);
  const [text, setText] = useState('');
  const [mode, setMode] = useState<'merge' | 'replace'>('merge');
  const file = useRef<HTMLInputElement>(null);

  // Dry run on every change: what you see is exactly what Apply does.
  const result = useMemo(() => (text.trim() ? importCiscoConfig(topology, layout, text, { mode }) : null), [text, mode, topology, layout]);
  const errors = result?.notes.filter((n) => n.level === 'error').length ?? 0;

  const apply = () => {
    if (!result || !result.devices.length) return;
    useTopologyStore.getState().apply(() => ({ topology: result.topology, layout: result.layout }));
    notify(`Imported configuration for ${result.devices.join(', ')}${errors ? ` (${errors} line${errors === 1 ? '' : 's'} failed)` : ''}`, 'info');
    close();
  };

  const onFile = async (f: File | undefined) => {
    if (!f) return;
    if (f.size > IMPORT_LIMITS.bytes) return notify(`That file is larger than ${IMPORT_LIMITS.bytes / 1000} KB, which is too big for a configuration`);
    setText(await f.text());
  };

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="modal interop" role="dialog" aria-modal="true" aria-labelledby="import-title" tabIndex={-1} ref={ref}>
        <header className="modal-head">
          <Icon.Terminal size={20} />
          <div>
            <h2 id="import-title">Import Cisco configuration</h2>
            <p className="muted small">Paste "show running-config" from one or more routers or switches. Each "hostname" starts a device.</p>
          </div>
          <span className="spacer" />
          <button className="icon-btn" onClick={close} aria-label="Close" title="Close (Esc)">
            <Icon.Close size={18} />
          </button>
        </header>
        <div className="interop-body import">
          <div className="import-input">
            <textarea
              className="code-input"
              value={text}
              onChange={(e) => setText(e.target.value)}
              spellCheck={false}
              aria-label="Configuration text"
              placeholder={'hostname R1\n!\ninterface GigabitEthernet0/0\n ip address 192.168.1.1 255.255.255.0\n no shutdown\n!\nrouter ospf 1\n network 192.168.1.0 0.0.0.255 area 0\nend'}
            />
            <div className="import-controls">
              <input ref={file} type="file" accept=".txt,.cfg,.conf,.ios,text/plain" hidden onChange={(e) => onFile(e.target.files?.[0])} />
              <button className="btn sm" onClick={() => file.current?.click()}>
                <Icon.Folder size={15} /> Choose file
              </button>
              <span className="spacer" />
              <div className="seg" role="radiogroup" aria-label="Import mode">
                <button role="radio" aria-checked={mode === 'merge'} className={mode === 'merge' ? 'on' : ''} onClick={() => setMode('merge')} title="Add to the existing configuration, like copy tftp running-config">
                  Merge
                </button>
                <button role="radio" aria-checked={mode === 'replace'} className={mode === 'replace' ? 'on' : ''} onClick={() => setMode('replace')} title="Reset each device to factory settings first; cables stay">
                  Replace
                </button>
              </div>
            </div>
          </div>
          <div className="import-report" aria-live="polite">
            {!result ? (
              <p className="muted small">
                What will happen appears here as you paste. Passwords and secrets are never imported, and commands such as ping or copy are never run.
              </p>
            ) : (
              <>
                <p className="small">
                  {result.devices.length ? (
                    <>
                      Configures <strong>{result.devices.join(', ')}</strong>
                      {errors ? ` · ${errors} error${errors === 1 ? '' : 's'}` : ' · no errors'}
                    </>
                  ) : (
                    'Nothing to import yet.'
                  )}
                </p>
                <ul className="import-notes">
                  {result.notes.map((n, k) => (
                    <li key={k} className={`note-${n.level}`}>
                      <span className="note-level">{LEVEL_LABEL[n.level]}</span>
                      {n.line !== undefined && <span className="mono muted">line {n.line}</span>}
                      <span>{n.text}</span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        </div>
        <footer className="modal-foot">
          <span className="muted small">{mode === 'replace' ? 'Replace resets each listed device first. Cables stay.' : 'Merge adds to what each device already has.'} You can undo it.</span>
          <span className="spacer" />
          <button className="btn sm" onClick={close}>
            Cancel
          </button>
          <button className="btn sm btn-primary" onClick={apply} disabled={!result?.devices.length}>
            Apply
          </button>
        </footer>
      </div>
    </div>
  );
}
