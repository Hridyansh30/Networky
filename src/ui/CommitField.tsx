import { useEffect, useState } from 'react';

/**
 * A text input that commits on blur or Enter (one undo step per edit, not per
 * keystroke). onCommit returns an error message to keep the field open, or null.
 */
export function CommitField({
  value,
  onCommit,
  placeholder,
  className,
  ariaLabel,
}: {
  value: string;
  onCommit: (next: string) => string | null;
  placeholder?: string;
  className?: string;
  ariaLabel?: string;
}) {
  const [draft, setDraft] = useState(value);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setDraft(value);
    setError(null);
  }, [value]);

  const commit = () => {
    if (draft === value) return setError(null);
    setError(onCommit(draft));
  };

  return (
    <span className={`field ${className ?? ''}`}>
      <input
        value={draft}
        placeholder={placeholder}
        aria-label={ariaLabel}
        aria-invalid={!!error}
        className={error ? 'invalid' : ''}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          if (e.key === 'Escape') {
            setDraft(value);
            setError(null);
          }
        }}
      />
      {error && <span className="field-error">{error}</span>}
    </span>
  );
}
