/**
 * Native bridge exposed by the ScanLinkPay Windows app (linkpay-desktop,
 * preload.js). Undefined in browsers and in the Android app.
 */
interface LinkpayDesktopBridge {
  isDesktop: true;
  info(): Promise<{ version: string; platform: string }>;
  /** Printers installed in Windows (USB POS printers with a driver, PDF…). */
  listPrinters(): Promise<{ name: string; displayName: string; isDefault: boolean }[]>;
  /** Silent print of a standalone HTML page — no dialog. */
  printHtml(html: string, deviceName: string): Promise<void>;
  listSerialPorts(): Promise<{ path: string; label: string }[]>;
  printSerial(path: string, bytes: Uint8Array): Promise<void>;
  printNetwork(host: string, port: number, bytes: Uint8Array): Promise<void>;
  setContentProtection(enabled: boolean): Promise<void>;
}

interface Window {
  linkpayDesktop?: LinkpayDesktopBridge;
}
