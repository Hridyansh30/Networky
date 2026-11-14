import { useState } from 'react';
import { href } from '../app/router';
import { useAccountStore } from '../store/accountStore';
import { Icon } from './icons';

/**
 * Sign in / the signed-in learner, at the end of the top nav. Shows nothing
 * when this copy of Networky has no server, so a static preview never offers
 * a button that cannot work.
 */
export function AccountMenu() {
  const status = useAccountStore((s) => s.status);
  const me = useAccountStore((s) => s.me);
  const meta = useAccountStore((s) => s.meta);

  if (status === 'loading' || status === 'unavailable') return null;

  if (status === 'guest') {
    if (meta?.signIn.github) {
      return (
        <button className="btn sm btn-primary account-signin" onClick={() => useAccountStore.getState().signIn()} title="Save progress to an account, on any device, and appear on the leaderboard">
          Sign in with GitHub
        </button>
      );
    }
    return meta?.signIn.dev ? <DevSignIn /> : null;
  }

  const user = me!.user!;
  return (
    <details className="account" onToggle={(e) => e.currentTarget.open && void useAccountStore.getState().refresh().catch(() => {})}>
      <summary aria-label={`Account: ${user.handle}`} title={user.handle}>
        {user.avatarUrl ? <img src={user.avatarUrl} alt="" width={30} height={30} referrerPolicy="no-referrer" /> : <span className="account-initial">{user.handle.slice(0, 1).toUpperCase()}</span>}
      </summary>
      <div className="account-menu" role="menu">
        <div className="account-who">
          <b>{user.displayName}</b>
          <span className="muted">@{user.handle}</span>
        </div>
        <div className="account-stats">
          <span>
            <b>{me!.stats?.xp ?? 0}</b> XP
          </span>
          <span>
            <b>{me!.stats?.solved ?? 0}</b> solved
          </span>
          <span>{me!.rank ? <>Rank <b>#{me!.rank}</b></> : 'Not ranked yet'}</span>
        </div>
        <a role="menuitem" href={href({ page: 'leaderboard' })}>
          <Icon.Bars size={16} /> Leaderboard
        </a>
        <button role="menuitem" onClick={() => void useAccountStore.getState().signOut()}>
          <Icon.ArrowRight size={16} /> Sign out
        </button>
      </div>
    </details>
  );
}

/** `npm run dev` only (the server says so in /meta): sign in as any handle, no GitHub app needed. */
function DevSignIn() {
  const [handle, setHandle] = useState('');
  return (
    <form
      className="dev-signin"
      onSubmit={(e) => {
        e.preventDefault();
        if (handle) void useAccountStore.getState().devSignIn(handle);
      }}
      title="Local development: sign in as any name. Never available on the real site."
    >
      <input aria-label="Dev handle" placeholder="dev handle" value={handle} pattern="[A-Za-z0-9\-]{1,32}" onChange={(e) => setHandle(e.target.value)} />
      <button className="btn sm">Dev sign in</button>
    </form>
  );
}

/** The server was updated: grades here and there could differ until this tab reloads. */
export function EngineBanner() {
  const stale = useAccountStore((s) => s.staleEngine);
  if (!stale) return null;
  return (
    <div className="engine-banner" role="alert">
      <Icon.Info size={16} /> Networky was updated. Reload so that Run checks your network the same way Submit does.
      <button className="btn sm" onClick={() => location.reload()}>
        Reload
      </button>
    </div>
  );
}
