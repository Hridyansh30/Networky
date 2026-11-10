import '@fontsource-variable/inter';
import './styles.css';
import { initTheme } from './theme';
import { initMotion } from './motion';
import { initDemo } from './demo';

initTheme(document.getElementById('theme-toggle') as HTMLButtonElement | null);
initMotion();
initDemo();
