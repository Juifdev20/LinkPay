// Light or dark from the first frame (also before login): the saved choice, else the phone's theme.
// A file of its own, not inline: the Android build's Content-Security-Policy only allows scripts from the app itself.
try {
  var t = localStorage.getItem('linkpay-theme') || 'system';
  var dark = t === 'dark' || (t === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.classList.add(dark ? 'dark' : 'light');
} catch (e) {}
