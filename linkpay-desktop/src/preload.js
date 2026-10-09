/**
 * Bridge between the web app and the Windows-native features (main.js).
 * Exposed as window.linkpayDesktop — and only on our own pages: any other
 * origin loaded in the window gets nothing. main.js re-checks the origin of
 * every call as well.
 */
const { contextBridge, ipcRenderer } = require('electron');

// The local dev server is trusted only when launched for development (LINKPAY_URL set); a shipped build never trusts localhost.
const TRUSTED = ['https://linkpay-lwt2.onrender.com'];
if (process.env.LINKPAY_URL) TRUSTED.push(new URL(process.env.LINKPAY_URL).origin);

if (TRUSTED.includes(location.origin)) {
  contextBridge.exposeInMainWorld('linkpayDesktop', {
    isDesktop: true,
    info: () => ipcRenderer.invoke('app:info'),
    listPrinters: () => ipcRenderer.invoke('printers:list'),
    printHtml: (html, deviceName) => ipcRenderer.invoke('printers:printHtml', html, deviceName),
    listSerialPorts: () => ipcRenderer.invoke('serial:list'),
    printSerial: (path, bytes) => ipcRenderer.invoke('serial:print', path, Array.from(bytes)),
    printNetwork: (host, port, bytes) => ipcRenderer.invoke('network:print', host, port, Array.from(bytes)),
    setContentProtection: (enabled) => ipcRenderer.invoke('security:setContentProtection', enabled),
  });
}
