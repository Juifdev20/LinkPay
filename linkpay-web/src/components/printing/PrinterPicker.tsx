import { useEffect, useState } from 'react';
import { Bluetooth, BluetoothSearching, Loader2, Monitor, Printer, RefreshCw, Usb, Wifi } from 'lucide-react';
import type { PaperColumns, TextEncoding } from '@/lib/printing/types';
import {
  isNative, listPairedDevices, listUsbPrinters, pickBlePrinter, pickSerialPrinter, scanBlePrinters, supportsBle, supportsSerial,
  type BleDevice, type PairedDevice, type PrinterConfig, type UsbPrinter,
} from '@/lib/printing/printer';

// User closed the browser's device chooser — not an error worth showing.
const isCancel = (e: any) => e?.name === 'NotFoundError' || e?.name === 'NotAllowedError';

const Option = ({ icon: Icon, label, hint, onClick, disabled }: {
  icon: React.ElementType; label: string; hint?: string; onClick: () => void; disabled?: boolean;
}) => (
  <button
    onClick={onClick}
    disabled={disabled}
    className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-left hover:bg-accent disabled:opacity-50"
  >
    <Icon className="w-4 h-4 text-muted-foreground flex-shrink-0" />
    <span className="flex-1 min-w-0">
      <span className="block truncate">{label}</span>
      {hint && <span className="block text-xs text-muted-foreground truncate">{hint}</span>}
    </span>
  </button>
);

function Toggle<T extends string | number>({ value, options, onChange }: {
  value: T; options: { value: T; label: string }[]; onChange: (v: T) => void;
}) {
  return (
    <div className="flex rounded-lg border border-border overflow-hidden text-xs">
      {options.map((o) => (
        <button
          key={String(o.value)}
          onClick={() => onChange(o.value)}
          className={`flex-1 py-1.5 ${value === o.value ? 'bg-primary text-primary-foreground' : 'hover:bg-accent'}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

const SectionTitle = ({ children }: { children: React.ReactNode }) => (
  <p className="px-4 pt-2.5 pb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{children}</p>
);

const IPV4 = /^(\d{1,3}\.){3}\d{1,3}$/;

/**
 * One-time printer choice for this device — only standard connections, so
 * any ESC/POS thermal printer works whatever its brand. Android app:
 * Bluetooth (paired in the phone's settings), USB, network (port 9100).
 * Web: USB/COM port (Web Serial) or BLE (Web Bluetooth), Chrome/Edge only.
 * The system print dialog is always offered as a fallback.
 */
export function PrinterPicker({ initial, onChosen, onCancel }: {
  initial: PrinterConfig | null;
  onChosen: (config: PrinterConfig) => void;
  onCancel: () => void;
}) {
  const [columns, setColumns] = useState<PaperColumns>(initial?.columns ?? 32);
  const [encoding, setEncoding] = useState<TextEncoding>(initial?.encoding ?? 'cp850');
  const [paired, setPaired] = useState<PairedDevice[] | null>(null);
  const [usb, setUsb] = useState<UsbPrinter[] | null>(null);
  const [ble, setBle] = useState<BleDevice[] | null>(null);
  const [scanning, setScanning] = useState(false);
  const [host, setHost] = useState(initial?.kind === 'network' ? initial.host ?? '' : '');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const native = isNative();

  const loadDevices = async () => {
    setLoading(true);
    setError(null);
    // Independent lookups — Bluetooth being off must not hide USB printers.
    const [bt, u] = await Promise.allSettled([listPairedDevices(), listUsbPrinters()]);
    if (bt.status === 'fulfilled') setPaired([...bt.value].sort((a, b) => Number(b.isPrinter) - Number(a.isPrinter)));
    else { setPaired([]); setError(bt.reason?.message || 'Impossible de lire les appareils Bluetooth'); }
    setUsb(u.status === 'fulfilled' ? u.value : []);
    setLoading(false);
  };

  useEffect(() => { if (native) loadDevices(); }, [native]);

  const scanBle = async () => {
    setScanning(true);
    setError(null);
    try {
      setBle(await scanBlePrinters());
    } catch (e: any) {
      setError(e?.message || 'Recherche Bluetooth impossible');
    } finally {
      setScanning(false);
    }
  };

  const base = { columns, encoding };

  const pick = async (fn: (c: PaperColumns) => Promise<PrinterConfig>) => {
    setError(null);
    try {
      onChosen({ ...(await fn(columns)), encoding });
    } catch (e: any) {
      if (!isCancel(e)) setError(e?.message || 'Connexion à l’imprimante impossible');
    }
  };

  const chooseNetwork = () => {
    const [ip, portStr] = host.trim().split(':');
    if (!IPV4.test(ip)) { setError('Adresse IP invalide (ex. 192.168.1.50)'); return; }
    const port = portStr ? Number(portStr) : 9100;
    onChosen({ ...base, kind: 'network', name: `Réseau ${ip}`, host: ip, port });
  };

  const system = () => onChosen({ ...base, kind: 'system', name: native ? 'Impression Android' : 'Imprimante du navigateur' });

  return (
    <div className="max-w-sm mx-auto space-y-3">
      <p className="text-sm font-medium text-foreground text-center">Choisissez l'imprimante (une seule fois)</p>

      <Toggle
        value={columns}
        onChange={setColumns}
        options={[{ value: 32, label: 'Papier 58 mm' }, { value: 48, label: 'Papier 80 mm' }]}
      />
      <Toggle
        value={encoding}
        onChange={setEncoding}
        options={[{ value: 'cp850', label: 'Avec accents' }, { value: 'ascii', label: 'Sans accents' }]}
      />
      <p className="text-[11px] text-muted-foreground text-center">
        Si les accents sortent mal sur le ticket, choisissez « Sans accents ».
      </p>

      <div className="rounded-xl border border-border divide-y divide-border overflow-hidden">
        {native && (
          <>
            {loading && (
              <div className="flex items-center justify-center gap-2 px-4 py-3 text-sm text-muted-foreground">
                <Loader2 className="w-4 h-4 animate-spin" /> Recherche des imprimantes…
              </div>
            )}

            {!loading && (
              <div>
                <SectionTitle>Bluetooth</SectionTitle>
                {paired?.length === 0 && (
                  <p className="px-4 pb-2.5 text-xs text-muted-foreground">
                    Aucun appareil appairé. Appairez d'abord l'imprimante dans Réglages Android › Bluetooth.
                  </p>
                )}
                {paired?.map((d) => (
                  <Option
                    key={d.address}
                    icon={Bluetooth}
                    label={d.name}
                    hint={d.isPrinter ? 'Imprimante' : d.address}
                    onClick={() => onChosen({ ...base, kind: 'bt-classic', name: d.name, address: d.address })}
                  />
                ))}
              </div>
            )}

            {!loading && !!usb?.length && (
              <div>
                <SectionTitle>USB</SectionTitle>
                {usb.map((d) => (
                  <Option
                    key={`${d.vendorId}:${d.productId}`}
                    icon={Usb}
                    label={d.name}
                    hint={d.isPrinter ? 'Imprimante USB' : 'Appareil USB'}
                    onClick={() => onChosen({ ...base, kind: 'usb', name: d.name, usbVendorId: d.vendorId, usbProductId: d.productId })}
                  />
                ))}
              </div>
            )}

            <Option icon={RefreshCw} label="Actualiser la liste" onClick={loadDevices} disabled={loading} />

            <div>
              <SectionTitle>Bluetooth BLE (sans appairage)</SectionTitle>
              {ble?.length === 0 && !scanning && (
                <p className="px-4 pb-2.5 text-xs text-muted-foreground">
                  Aucune imprimante trouvée. Allumez-la, rapprochez-vous et relancez la recherche.
                </p>
              )}
              {ble?.map((d) => (
                <Option
                  key={d.address}
                  icon={Bluetooth}
                  label={d.name}
                  hint={d.address}
                  onClick={() => onChosen({ ...base, kind: 'ble', name: d.name, address: d.address })}
                />
              ))}
              <Option
                icon={scanning ? Loader2 : BluetoothSearching}
                label={scanning ? 'Recherche en cours…' : ble ? 'Relancer la recherche BLE' : 'Rechercher les imprimantes BLE'}
                hint="Si l'imprimante n'apparaît pas dans la liste Bluetooth ci-dessus"
                onClick={scanBle}
                disabled={scanning}
              />
            </div>

            <div className="px-4 py-2.5 space-y-2">
              <p className="flex items-center gap-2 text-sm">
                <Wifi className="w-4 h-4 text-muted-foreground" /> Imprimante réseau (Wi-Fi / câble)
              </p>
              <div className="flex gap-2">
                <input
                  value={host}
                  onChange={(e) => setHost(e.target.value)}
                  inputMode="decimal"
                  placeholder="192.168.1.50"
                  className="flex-1 min-w-0 rounded-md border border-border bg-background px-3 py-1.5 text-sm"
                />
                <button
                  onClick={chooseNetwork}
                  disabled={!host.trim()}
                  className="rounded-md border border-border px-3 text-sm hover:bg-accent disabled:opacity-50"
                >
                  OK
                </button>
              </div>
            </div>
          </>
        )}

        {!native && supportsSerial() && (
          <Option
            icon={Usb}
            label="Imprimante USB ou port COM"
            hint="Aussi pour une imprimante Bluetooth appairée dans Windows"
            onClick={() => pick(pickSerialPrinter)}
          />
        )}
        {!native && supportsBle() && (
          <Option icon={Bluetooth} label="Imprimante Bluetooth (BLE)" onClick={() => pick(pickBlePrinter)} />
        )}

        <Option
          icon={native ? Printer : Monitor}
          label={native ? 'Autre imprimante (fenêtre Android)' : 'Imprimante Windows / navigateur'}
          hint="Passe par la fenêtre d'impression du système"
          onClick={system}
        />
      </div>

      {!native && !supportsSerial() && !supportsBle() && (
        <p className="text-xs text-muted-foreground text-center">
          L'impression directe sur imprimante thermique nécessite Chrome ou Edge.
        </p>
      )}
      {error && <p className="text-sm text-destructive text-center">{error}</p>}

      <button onClick={onCancel} className="w-full text-xs text-muted-foreground hover:underline">Annuler</button>
    </div>
  );
}
