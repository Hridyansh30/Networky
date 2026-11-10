// Runs before the page paints (a plain blocking script, not a module) so a
// visitor who picked a theme never sees a flash of the other one.
// It is a separate file, not an inline <script>, because the CSP forbids
// inline scripts.
try {
  var t = localStorage.getItem('networky-theme');
  if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t;
} catch (e) {
  /* storage blocked: fall back to the system theme */
}
