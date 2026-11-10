import { href, useRoute } from '../app/router';
import { useTheme } from '../app/theme';
import { Icon, Logo } from './icons';

/** Header of the Home, Projects and Learn pages. */
export function TopNav() {
  const route = useRoute();
  return (
    <header className="topnav">
      <a className="brand" href={href({ page: 'home' })}>
        <Logo />
        <span>Networky</span>
      </a>
      <nav aria-label="Main">
        {(
          [
            ['home', 'Home', Icon.Home],
            ['projects', 'Projects', Icon.Folder],
            ['learn', 'Learn', Icon.Book],
          ] as const
        ).map(([page, label, I]) => (
          <a key={page} href={href({ page })} className={route.page === page ? 'active' : ''} aria-current={route.page === page ? 'page' : undefined}>
            <I size={17} />
            {label}
          </a>
        ))}
      </nav>
      <div className="topnav-end">
        <ThemeToggle />
      </div>
    </header>
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
