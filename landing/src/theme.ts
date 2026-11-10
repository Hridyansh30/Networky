// Light / dark theme toggle.
//
// With no saved choice the page follows the system setting (pure CSS, see the
// prefers-color-scheme blocks in styles.css). Clicking the button pins the
// opposite theme in <html data-theme> and remembers it. public/theme.js
// re-applies the saved choice before first paint.

export type Theme = 'light' | 'dark';

const KEY = 'networky-theme';

export function currentTheme(root: HTMLElement = document.documentElement): Theme {
  const pinned = root.dataset.theme;
  if (pinned === 'light' || pinned === 'dark') return pinned;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function label(button: HTMLButtonElement, theme: Theme): void {
  button.setAttribute('aria-label', theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme');
}

export function initTheme(button: HTMLButtonElement | null): void {
  if (!button) return;
  const root = document.documentElement;
  label(button, currentTheme(root));

  button.addEventListener('click', () => {
    const next: Theme = currentTheme(root) === 'dark' ? 'light' : 'dark';
    root.dataset.theme = next;
    label(button, next);
    try {
      localStorage.setItem(KEY, next);
    } catch {
      // Private mode or blocked storage: the choice lasts for this visit only.
    }
  });

  // Keep the label right when the system theme changes and nothing is pinned.
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => label(button, currentTheme(root)));
}
