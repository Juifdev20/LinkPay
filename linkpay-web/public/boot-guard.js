/*
 * Self-repair of the very first screen. The page shows the logo and a spinner (#boot-splash in index.html) until the
 * app's JavaScript starts and replaces it. If that JavaScript can never load — typically right after a deployment, when
 * a phone still holds an old page whose script no longer exists on the server — the spinner would turn for ever.
 *
 * This file is a separate classic script (the Content-Security-Policy forbids inline ones) that runs before everything
 * else and does two things:
 *   1. a script/stylesheet of the app that fails to load, or an app that has not started after 25 s, empties the
 *      service worker and its caches and reloads — once;
 *   2. if that did not help (second failure within 10 minutes), the spinner is replaced by a message and two buttons.
 * Nothing the person owns is touched: the login, the saved data and the sales waiting to be sent live in localStorage,
 * which stays. Never done without network: the offline copy is then the only one there is.
 */
(function () {
  var KEY = 'slp_boot_repair_at';
  var WINDOW_MS = 10 * 60 * 1000;
  var WAIT_MS = 25 * 1000;
  var started = false;

  function splash() { return document.getElementById('boot-splash'); }

  function clearCopies() {
    var jobs = [];
    try {
      if (navigator.serviceWorker && navigator.serviceWorker.getRegistrations) {
        jobs.push(navigator.serviceWorker.getRegistrations().then(function (list) {
          return Promise.all(list.map(function (r) { return r.unregister(); }));
        }));
      }
      if (window.caches && caches.keys) {
        jobs.push(caches.keys().then(function (keys) { return Promise.all(keys.map(function (k) { return caches.delete(k); })); }));
      }
    } catch (e) { /* nothing to clear */ }
    return Promise.all(jobs).catch(function () {});
  }

  function showHelp() {
    var box = splash();
    if (!box || box.getAttribute('data-help')) return;
    box.setAttribute('data-help', '1');
    var spinner = box.querySelector('span');
    if (spinner) spinner.style.display = 'none';
    var text = document.createElement('p');
    text.textContent = "L'application n'a pas pu démarrer. Vérifiez votre connexion, puis réessayez.";
    text.style.cssText = 'margin:0;max-width:280px;text-align:center;color:#334155;font-size:15px;line-height:1.4';
    var retry = document.createElement('button');
    retry.textContent = 'Réessayer';
    retry.style.cssText = 'border:0;border-radius:14px;padding:13px 28px;font-size:16px;font-weight:600;color:#fff;background:#1230f8';
    retry.onclick = function () { location.reload(); };
    var repair = document.createElement('button');
    repair.textContent = "Réparer l'application";
    repair.style.cssText = 'border:0;background:none;font-size:14px;font-weight:600;color:#1230f8;padding:6px';
    repair.onclick = function () { clearCopies().then(function () { location.reload(); }); };
    box.appendChild(text);
    box.appendChild(retry);
    box.appendChild(repair);
  }

  function repair() {
    if (started || !splash()) return;
    started = true;
    var last = 0;
    try { last = Number(localStorage.getItem(KEY)) || 0; } catch (e) { /* storage blocked */ }
    // Already repaired a moment ago, or no network (the offline copy is all there is): do not wipe it again.
    if (Date.now() - last < WINDOW_MS || navigator.onLine === false) { showHelp(); return; }
    try { localStorage.setItem(KEY, String(Date.now())); } catch (e) { /* storage blocked */ }
    clearCopies().then(function () { location.reload(); });
  }

  // 1. A file of the app that does not load (404, wrong type…).
  window.addEventListener('error', function (e) {
    var t = e.target;
    if (!t || !t.tagName) return;
    var url = t.src || t.href || '';
    if ((t.tagName === 'SCRIPT' || t.tagName === 'LINK') && url.indexOf('/assets/') !== -1) repair();
  }, true);

  // 2. The app never replaced the splash.
  window.setTimeout(function () { if (splash()) repair(); }, WAIT_MS);
})();
