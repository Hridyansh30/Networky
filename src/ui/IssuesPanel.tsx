import { useMemo } from 'react';
import { validate } from '../model/validate';
import { useTopologyStore } from '../store/topologyStore';

export function IssuesPanel() {
  const topology = useTopologyStore((s) => s.topology);
  const select = useTopologyStore((s) => s.select);
  const issues = useMemo(() => validate(topology), [topology]);
  const errors = issues.filter((i) => i.severity === 'error').length;

  return (
    <section className="issues" aria-label="Issues">
      <header>
        Issues: {errors} error{errors === 1 ? '' : 's'}, {issues.length - errors} warning{issues.length - errors === 1 ? '' : 's'}
      </header>
      <ul>
        {issues.length === 0 && <li className="muted">No issues found.</li>}
        {issues.map((issue, idx) => (
          <li key={idx} className={`issue ${issue.severity}`}>
            <button className="link" onClick={() => issue.deviceIds[0] && select({ type: 'device', id: issue.deviceIds[0] })}>
              <span className="sev">{issue.severity === 'error' ? 'Error' : 'Warning'}</span> {issue.message}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
