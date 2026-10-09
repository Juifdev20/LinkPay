/**
 * ScanLinkPay for Windows — an Electron shell around the web app that is
 * already deployed, plus the native features a browser can't offer on a
 * till PC:
 *   - silent printing to any printer installed in Windows (USB POS printers
 *     with a driver, whatever the brand), ESC/POS on COM ports and on the
 *     network (TCP 9100);
 *   - screenshot protection (black window in captures/recordings), driven by
 *     the same super-admin switch as the Android app.
 *
 * The UI itself is loaded from the web deployment, so every web release
 * reaches this app at once — the Microsoft Store only ships shell changes.
 */
const { app, BrowserWindow, ipcMain, shell, Menu, session } = require('electron');
const path = require('path');
const fs = require('fs');
const net = require('net');

const PROD_URL = 'https://linkpay-lwt2.onrender.com';
const APP_URL = process.env.LINKPAY_URL || PROD_URL;
// Only our own pages may use the native bridge.
const TRUSTED_ORIGINS = new Set([new URL(PROD_URL).origin, new URL(APP_URL).origin]);

// The printer must finish pulling the data before the link closes.
const FLUSH_DELAY_MS = 800;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let mainWindow = null;

// ------------------------------------------------------------------
// One instance only — a second launch focuses the existing window.
// ------------------------------------------------------------------
if (!app.requestSingleInstanceLock()) {
  app.quit();
}
app.on('second-instance', () => {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.focus();
});

// ------------------------------------------------------------------
// Window size/position remembered between launches.
// ------------------------------------------------------------------
const stateFile = () => path.join(app.getPath('userData'), 'window-state.json');

function loadWindowState() {
  try {
    return JSON.parse(fs.readFileSync(stateFile(), 'utf8'));
  } catch {
    return { width: 1280, height: 800, maximized: true };
  }
}

function saveWindowState(win) {
  try {
    const bounds = win.getNormalBounds();
    fs.writeFileSync(stateFile(), JSON.stringify({ ...bounds, maximized: win.isMaximized() }));
  } catch { /* not critical */ }
}

function isTrusted(url) {
  try {
    return TRUSTED_ORIGINS.has(new URL(url).origin);
  } catch {
    return false;
  }
}

function createWindow() {
  const state = loadWindowState();
  mainWindow = new BrowserWindow({
    x: state.x,
    y: state.y,
    width: state.width || 1280,
    height: state.height || 800,
    minWidth: 380,
    minHeight: 600,
    backgroundColor: '#f8fafc', // same as the web boot splash — no white flash
    icon: path.join(__dirname, '..', 'resources', 'icon.png'),
    title: 'ScanLinkPay',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  if (state.maximized) mainWindow.maximize();
  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.on('close', () => saveWindowState(mainWindow));
  mainWindow.on('closed', () => { mainWindow = null; });

  // Anything that isn't our app opens in the system browser.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (!isTrusted(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!isTrusted(url)) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });

  mainWindow.loadURL(APP_URL);
}

// ------------------------------------------------------------------
// Native bridge — every call checks it comes from our own page.
// ------------------------------------------------------------------
function handle(channel, fn) {
  ipcMain.handle(channel, async (event, ...args) => {
    const origin = event.senderFrame?.url;
    if (!origin || !isTrusted(origin)) throw new Error('Origine non autorisée');
    return fn(event, ...args);
  });
}

// Printers installed in Windows (USB POS printers with a driver, PDF…).
handle('printers:list', async (event) => {
  const printers = await event.sender.getPrintersAsync();
  return printers.map((p) => ({ name: p.name, displayName: p.displayName || p.name, isDefault: !!p.isDefault }));
});

// Silent print of a receipt/label page — no dialog. Works with the Windows
// driver of any brand of POS printer.
handle('printers:printHtml', async (_event, html, deviceName) => {
  const win = new BrowserWindow({ show: false, webPreferences: { sandbox: true, javascript: false } });
  try {
    await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
    await new Promise((resolve, reject) => {
      win.webContents.print(
        { silent: true, deviceName, printBackground: true, margins: { marginType: 'none' } },
        (success, reason) => (success ? resolve() : reject(new Error(reason || 'Impression impossible'))),
      );
    });
  } finally {
    win.destroy();
  }
});

// COM ports — USB-serial POS printers, and Bluetooth printers paired in Windows.
handle('serial:list', async () => {
  const { SerialPort } = require('serialport');
  const ports = await SerialPort.list();
  return ports.map((p) => ({ path: p.path, label: [p.path, p.friendlyName || p.manufacturer].filter(Boolean).join(' — ') }));
});

handle('serial:print', async (_event, portPath, bytes) => {
  const { SerialPort } = require('serialport');
  const port = new SerialPort({ path: portPath, baudRate: 9600, autoOpen: false });
  await new Promise((resolve, reject) => port.open((err) => (err ? reject(err) : resolve())));
  try {
    await new Promise((resolve, reject) => port.write(Buffer.from(bytes), (err) => (err ? reject(err) : resolve())));
    await new Promise((resolve, reject) => port.drain((err) => (err ? reject(err) : resolve())));
    await sleep(FLUSH_DELAY_MS);
  } finally {
    await new Promise((resolve) => port.close(() => resolve()));
  }
});

// Network POS printers — raw ESC/POS on TCP 9100.
handle('network:print', async (_event, host, port, bytes) => {
  await new Promise((resolve, reject) => {
    const socket = net.createConnection({ host, port: port || 9100, timeout: 5000 });
    socket.on('connect', () => {
      socket.write(Buffer.from(bytes), () => {
        setTimeout(() => socket.end(), FLUSH_DELAY_MS);
      });
    });
    socket.on('close', (hadError) => (hadError ? null : resolve()));
    socket.on('timeout', () => { socket.destroy(); reject(new Error(`Imprimante réseau injoignable (${host}:${port || 9100})`)); });
    socket.on('error', (err) => reject(new Error(`Imprimante réseau injoignable (${host}:${port || 9100}) — ${err.message}`)));
  });
});

// Screenshot protection: the window comes out black in captures/recordings.
handle('security:setContentProtection', async (_event, enabled) => {
  mainWindow?.setContentProtection(!!enabled);
});

handle('app:info', async () => ({ version: app.getVersion(), platform: process.platform }));

// ------------------------------------------------------------------
app.whenReady().then(() => {
  // A till doesn't need the default File/Edit/View menu.
  Menu.setApplicationMenu(null);

  // The page may only ask for what a till needs (camera to scan QR codes,
  // notifications), and only from our own origin — any other site, or any
  // other permission (location, USB, clipboard-read…), is refused.
  const ALLOWED_PERMISSIONS = new Set(['media', 'notifications']);
  const fromTrustedPage = (wc, url) => isTrusted(url || wc.getURL());
  session.defaultSession.setPermissionRequestHandler((wc, permission, callback, details) => {
    callback(ALLOWED_PERMISSIONS.has(permission) && fromTrustedPage(wc, details && details.requestingUrl));
  });
  session.defaultSession.setPermissionCheckHandler((wc, permission, origin) =>
    ALLOWED_PERMISSIONS.has(permission) && isTrusted(origin));

  createWindow();
});

// No <webview> and no navigation to a foreign site from ANY web contents the
// app ever creates (window.open is already denied above for the main one).
app.on('web-contents-created', (_event, contents) => {
  contents.on('will-attach-webview', (event) => event.preventDefault());
  contents.on('will-navigate', (event, url) => {
    if (!isTrusted(url) && !url.startsWith('data:text/html')) event.preventDefault();
  });
});

app.on('window-all-closed', () => app.quit());
