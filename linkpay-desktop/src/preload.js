/**
 * Bridge between the web app and the Windows-native features (main.js).
 * Exposed as window.linkpayDesktop — and only on our own pages: any other
 * origin loaded in the window gets nothing. main.js re-checks the origin of
 * every call as well.
 */
const { contextBridge, ipcRenderer } = require('electron');

const TRUSTED = ['https://linkpay-lwt2.onrender.com', 'http://localhost:5173'];

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
