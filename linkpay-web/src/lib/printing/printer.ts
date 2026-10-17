import { Capacitor, registerPlugin } from '@capacitor/core';
import type { PaperColumns, ReceiptLine, TextEncoding } from './types';
import { receiptToEscPos } from './escpos';
import { printHtmlInIframe, receiptToHtml } from './html';

/**
 * Transport layer — sends the ESC/POS bytes to the printer.
 *
 * Every transport is a STANDARD one — no brand-specific SDK — so any
 * ESC/POS thermal printer works whatever its make:
 *
 * - Android app (native ReceiptPrinter plugin):
 *   · Bluetooth Classic (SPP) — printer paired in Android's settings first.
 *     Also covers Sunmi-style terminals ("InnerPrinter" virtual device).
 *   · Bluetooth LE — printers without the Classic profile, found by a scan.
 *   · USB (OTG / terminal port) — USB printer class or any bulk endpoint.
 *   · Network (Wi-Fi / Ethernet) — raw TCP on port 9100.
 * - Web (Chrome / Edge only): Web Serial for USB-serial printers or a
 *   Bluetooth printer paired in Windows (shows up as a COM port), and Web
 *   Bluetooth for BLE printers.
 * - Fallback everywhere: the system print dialog (window.print() on the
 *   web, Android's PrintManager in the app).
 */

export type PrinterKind =
  | 'bt-classic' | 'usb' | 'network' | 'serial' | 'ble' | 'system'
  // ScanLinkPay for Windows (linkpay-desktop): a printer installed in
  // Windows (silent, via its driver — any brand) or a COM port.
  | 'desktop-printer' | 'desktop-serial';

export interface PrinterConfig {
  kind: PrinterKind;
  name: string;
  columns: PaperColumns;
  /** Missing on configs saved before the setting existed → 'cp850'. */
  encoding?: TextEncoding;
  /** bt-classic, and ble in the Android app: MAC address of the device. */
  address?: string;
  /** usb / serial: USB ids, to find the device / authorised port again. */
  usbVendorId?: number;
  usbProductId?: number;
  /** ble: Web Bluetooth device id. */
  deviceId?: string;
  /** desktop-printer: Windows printer name. desktop-serial: COM port path. */
  deviceName?: string;
  /** network: printer IP and raw port (9100). */
  host?: string;
  port?: number;
}

export interface BleDevice {
  name: string;
  address: string;
  rssi: number;
}

export interface UsbPrinter {
  name: string;
  vendorId: number;
  productId: number;
  isPrinter: boolean;
}

export interface PairedDevice {
  name: string;
  address: string;
  isPrinter: boolean;
}

interface ReceiptPrinterPlugin {
  listPaired(): Promise<{ devices: PairedDevice[] }>;
  printBytes(options: { address: string; data: string }): Promise<void>;
  scanBle(): Promise<{ devices: BleDevice[] }>;
  printBle(options: { address: string; data: string }): Promise<void>;
  listUsb(): Promise<{ devices: UsbPrinter[] }>;
  printUsb(options: { vendorId: number; productId: number; data: string }): Promise<void>;
  printNetwork(options: { host: string; port: number; data: string }): Promise<void>;
  systemPrint(options: { html: string; jobName?: string }): Promise<void>;
}

const NativePrinter = registerPlugin<ReceiptPrinterPlugin>('ReceiptPrinter');

export const isNative = () => Capacitor.isNativePlatform();
/** Running inside the ScanLinkPay Windows app. */
export const desktop = () => (typeof window !== 'undefined' ? window.linkpayDesktop : undefined);
export const isDesktop = () => !!desktop();
// The Windows app has native COM ports instead (no browser chooser there).
export const supportsSerial = () => !isNative() && !isDesktop() && 'serial' in navigator;
export const supportsBle = () => !isNative() && !isDesktop() && 'bluetooth' in navigator;

// ------------------------------------------------------------------
// Saved choice — per device, the cashier picks the printer once.
// ------------------------------------------------------------------
const STORAGE_KEY = 'pos-printer-config';

export function loadPrinter(): PrinterConfig | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as PrinterConfig) : null;
  } catch {
    return null;
  }
}

export function savePrinter(config: PrinterConfig | null) {
  try {
    if (config) localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
    else localStorage.removeItem(STORAGE_KEY);
  } catch { /* storage blocked — the choice just won't persist */ }
}

// The printer's buffer must be flushed to paper before the link closes —
// disconnecting right after the write cuts the ticket short or loses it.
const FLUSH_DELAY_MS = 800;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const toBase64 = (bytes: Uint8Array) => {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
};

// ------------------------------------------------------------------
// Android — Bluetooth Classic
// ------------------------------------------------------------------
export async function listPairedDevices(): Promise<PairedDevice[]> {
  const { devices } = await NativePrinter.listPaired();
  return devices;
}

// Android — Bluetooth LE (~6 s scan; strongest signal first)
export async function scanBlePrinters(): Promise<BleDevice[]> {
  const { devices } = await NativePrinter.scanBle();
  return [...devices].sort((a, b) => b.rssi - a.rssi);
}

// Android — USB
export async function listUsbPrinters(): Promise<UsbPrinter[]> {
  const { devices } = await NativePrinter.listUsb();
  return devices;
}

// ------------------------------------------------------------------
// Web Serial
// ------------------------------------------------------------------
/** Must run inside a click handler (browser permission prompt). */
export async function pickSerialPrinter(columns: PaperColumns): Promise<PrinterConfig> {
  const port = await (navigator as any).serial.requestPort();
  const info = port.getInfo?.() || {};
  return {
    kind: 'serial',
    name: info.usbVendorId ? `USB ${info.usbVendorId.toString(16)}:${(info.usbProductId ?? 0).toString(16)}` : 'Port série (COM)',
    columns,
    usbVendorId: info.usbVendorId,
    usbProductId: info.usbProductId,
  };
}

async function findSerialPort(config: PrinterConfig) {
  const ports: any[] = await (navigator as any).serial.getPorts();
  const match = ports.find((p) => {
    const info = p.getInfo?.() || {};
    return info.usbVendorId === config.usbVendorId && info.usbProductId === config.usbProductId;
  });
  // Bluetooth COM ports carry no USB ids — the single authorised port is it.
  const port = match || (ports.length === 1 ? ports[0] : null);
  if (port) return port;
  // Permission lost (cleared site data…): ask again. Still inside the
  // "Imprimer" click's user activation window.
  return (navigator as any).serial.requestPort();
}

async function printSerial(config: PrinterConfig, bytes: Uint8Array) {
  const port = await findSerialPort(config);
  // Baud rate is ignored by USB-CDC and Bluetooth COM ports; 9600 is the
  // factory default of real RS-232 thermal printers.
  if (!port.writable) await port.open({ baudRate: 9600 });
  const writer = port.writable.getWriter();
  try {
    await writer.write(bytes);
    await sleep(FLUSH_DELAY_MS);
  } finally {
    writer.releaseLock();
    await port.close().catch(() => {});
  }
}

// ------------------------------------------------------------------
// Web Bluetooth (BLE). Cheap thermal printers expose a vendor-specific
// "serial over GATT" service — these are the common ones.
// ------------------------------------------------------------------
const BLE_SERVICES = [
  '000018f0-0000-1000-8000-00805f9b34fb',
  'e7810a71-73ae-499d-8c15-faa9aef0c3f2',
  '49535343-fe7d-4ae5-8fa9-9fafd205e455',
  '0000ff00-0000-1000-8000-00805f9b34fb',
  '0000ffe0-0000-1000-8000-00805f9b34fb',
  '0000fee7-0000-1000-8000-00805f9b34fb',
  '0000ae30-0000-1000-8000-00805f9b34fb',
];
// BLE writes are limited by the MTU; 20 bytes is safe on every printer.
const BLE_CHUNK = 20;

let bleDevice: any = null; // kept for the session — no re-prompt each ticket

/** Must run inside a click handler (browser permission prompt). */
export async function pickBlePrinter(columns: PaperColumns): Promise<PrinterConfig> {
  const device = await (navigator as any).bluetooth.requestDevice({
    acceptAllDevices: true,
    optionalServices: BLE_SERVICES,
  });
  bleDevice = device;
  return { kind: 'ble', name: device.name || 'Imprimante Bluetooth', columns, deviceId: device.id };
}

async function findBleDevice(config: PrinterConfig) {
  if (bleDevice && bleDevice.id === config.deviceId) return bleDevice;
  const bt = (navigator as any).bluetooth;
  if (bt.getDevices) {
    const devices: any[] = await bt.getDevices();
    const known = devices.find((d) => d.id === config.deviceId);
    if (known) return (bleDevice = known);
  }
  // Chrome without persistent permissions: the cashier re-selects it once
  // per session (still inside the "Imprimer" click's user activation).
  const device = await bt.requestDevice({ acceptAllDevices: true, optionalServices: BLE_SERVICES });
  return (bleDevice = device);
}

async function findWritableCharacteristic(server: any) {
  for (const uuid of BLE_SERVICES) {
    let service: any;
    try { service = await server.getPrimaryService(uuid); } catch { continue; }
    const chars: any[] = await service.getCharacteristics();
    const c = chars.find((ch) => ch.properties.writeWithoutResponse || ch.properties.write);
    if (c) return c;
  }
  throw new Error("Cette imprimante Bluetooth n'expose pas de service d'impression connu (BLE).");
}

async function printBle(config: PrinterConfig, bytes: Uint8Array) {
  const device = await findBleDevice(config);
  const server = await device.gatt.connect();
  try {
    const ch = await findWritableCharacteristic(server);
    for (let i = 0; i < bytes.length; i += BLE_CHUNK) {
      const chunk = bytes.slice(i, i + BLE_CHUNK);
      if (ch.properties.writeWithoutResponse) {
        await ch.writeValueWithoutResponse(chunk);
        await sleep(5); // don't overrun the printer's small buffer
      } else {
        await ch.writeValueWithResponse(chunk);
      }
    }
    await sleep(FLUSH_DELAY_MS);
  } finally {
    device.gatt.disconnect();
  }
}

// ------------------------------------------------------------------
// System print dialog (fallback)
// ------------------------------------------------------------------

async function systemPrint(html: string, jobName: string) {
  // window.print() is a silent no-op in the Capacitor WebView → PrintManager.
  if (isNative()) await NativePrinter.systemPrint({ html, jobName });
  else await printHtmlInIframe(html);
}

// ------------------------------------------------------------------
// Entry point
// ------------------------------------------------------------------
export async function printReceipt(lines: ReceiptLine[], config: PrinterConfig, jobName = 'Recu', opts: { cut?: boolean } = {}) {
  const bytes = receiptToEscPos(lines, config.columns, config.encoding ?? 'cp850', opts.cut ?? true);
  switch (config.kind) {
    case 'bt-classic':
      if (!config.address) throw new Error('Imprimante Bluetooth non configurée');
      await NativePrinter.printBytes({ address: config.address, data: toBase64(bytes) });
      return;
    case 'usb':
      if (config.usbVendorId == null || config.usbProductId == null) throw new Error('Imprimante USB non configurée');
      await NativePrinter.printUsb({ vendorId: config.usbVendorId, productId: config.usbProductId, data: toBase64(bytes) });
      return;
    case 'network':
      if (!config.host) throw new Error('Imprimante réseau non configurée');
      if (isDesktop()) {
        await desktop()!.printNetwork(config.host, config.port ?? 9100, bytes);
        return;
      }
      await NativePrinter.printNetwork({ host: config.host, port: config.port ?? 9100, data: toBase64(bytes) });
      return;
    case 'serial':
      return printSerial(config, bytes);
    case 'ble':
      // The Capacitor WebView has no Web Bluetooth — native GATT instead.
      if (isNative()) {
        if (!config.address) throw new Error('Imprimante Bluetooth non configurée');
        await NativePrinter.printBle({ address: config.address, data: toBase64(bytes) });
        return;
      }
      return printBle(config, bytes);
    case 'system':
      return systemPrint(receiptToHtml(lines, config.columns), jobName);
    case 'desktop-printer':
      if (!config.deviceName || !isDesktop()) throw new Error("Imprimante Windows indisponible — ouvrez l'application ScanLinkPay pour Windows.");
      // The printer's Windows driver renders the page — works for any brand.
      await desktop()!.printHtml(receiptToHtml(lines, config.columns), config.deviceName);
      return;
    case 'desktop-serial':
      if (!config.deviceName || !isDesktop()) throw new Error("Port COM indisponible — ouvrez l'application ScanLinkPay pour Windows.");
      await desktop()!.printSerial(config.deviceName, bytes);
      return;
  }
}
