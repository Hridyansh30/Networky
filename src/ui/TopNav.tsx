import { useEffect } from 'react';
import { href, useRoute, type Route } from '../app/router';
import { useTheme } from '../app/theme';
import { PROBLEMS } from '../problems/catalog';
import { learnerStats } from '../problems/stats';
import { useProblemStore } from '../store/problemStore';
import { Icon, Logo } from './icons';

const LINKS: readonly [Route, string, (typeof Icon)[keyof typeof Icon], Route['page'][]][] = [
  [{ page: 'home' }, 'Home', Icon.Home, ['home']],
  [{ page: 'problems' }, 'Problems', Icon.Code, ['problems', 'problem']],
  [{ page: 'learn' }, 'Learn', Icon.Book, ['learn']],
  [{ page: 'workspace' }, 'Playground', Icon.Play, ['workspace']],
  [{ page: 'projects' }, 'Projects', Icon.Folder, ['projects']],
];

/** Header of every page except the workspace. */
export function TopNav() {
  const route = useRoute();
  return (
    <header className="topnav">
      <a className="brand" href={href({ page: 'home' })}>
        <Logo />
        <span>Networky</span>
      </a>
      <nav aria-label="Main">
        {LINKS.map(([to, label, I, pages]) => {
          const active = pages.includes(route.page);
          return (
            <a key={label} href={href(to)} className={active ? 'active' : ''} aria-current={active ? 'page' : undefined}>
              <I size={17} />
              {label}
            </a>
          );
        })}
      </nav>
      <div className="topnav-end">
        <XpBar />
        <ThemeToggle />
      </div>
    </header>
  );
}

/** Loads saved progress once for whichever page needs it. */
export function useProgress() {
  const progress = useProblemStore((s) => s.progress);
  const loaded = useProblemStore((s) => s.loaded);
  useEffect(() => {
    if (!useProblemStore.getState().loaded) void useProblemStore.getState().loadAll();
  }, []);
  return { progress, loaded };
}

/**
 * Level and XP, from problems solved in this browser. Local only until
 * accounts exist (phase 6), so it is motivation, not a ranking.
 */
export function XpBar() {
  const { progress } = useProgress();
  const { xp, level } = learnerStats(progress, PROBLEMS);
  return (
    <div className="xp" title={`${xp} XP in total. Earned by solving problems: easy 10, medium 20, hard 40, less for hints used. Saved in this browser.`}>
      <span className="xp-level">Lv. {level.level}</span>
      <span className="xp-track" role="progressbar" aria-label={`Level ${level.level} progress`} aria-valuemin={0} aria-valuemax={level.span} aria-valuenow={level.into}>
        <span style={{ width: `${(100 * level.into) / level.span}%` }} />
      </span>
      <span className="xp-count">
        {level.into} / {level.span} XP
      </span>
    </div>
  );
}

export function ThemeToggle() {
  const [theme, toggle] = useTheme();
  return (
    <button className="icon-btn" onClick={toggle} title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'} aria-label="Toggle colour theme">
      {theme === 'dark' ? <Icon.Sun /> : <Icon.Moon />}
    </button>
  );
}
