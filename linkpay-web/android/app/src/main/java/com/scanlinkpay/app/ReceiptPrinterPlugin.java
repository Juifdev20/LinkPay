package com.scanlinkpay.app;

import android.Manifest;
import android.annotation.SuppressLint;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothClass;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothGatt;
import android.bluetooth.BluetoothGattCallback;
import android.bluetooth.BluetoothGattCharacteristic;
import android.bluetooth.BluetoothGattService;
import android.bluetooth.BluetoothManager;
import android.bluetooth.BluetoothProfile;
import android.bluetooth.le.BluetoothLeScanner;
import android.bluetooth.le.ScanCallback;
import android.bluetooth.le.ScanResult;
import android.bluetooth.le.ScanSettings;
import android.location.LocationManager;
import android.bluetooth.BluetoothSocket;
import android.bluetooth.BluetoothStatusCodes;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.hardware.usb.UsbConstants;
import android.hardware.usb.UsbDevice;
import android.hardware.usb.UsbDeviceConnection;
import android.hardware.usb.UsbEndpoint;
import android.hardware.usb.UsbInterface;
import android.hardware.usb.UsbManager;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.print.PrintAttributes;
import android.print.PrintManager;
import android.util.Base64;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import androidx.core.content.ContextCompat;

import java.io.OutputStream;
import java.lang.reflect.Method;
import java.net.InetSocketAddress;
import java.net.Socket;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Semaphore;
import java.util.concurrent.TimeUnit;

/**
 * Receipt printing for the POS — raw ESC/POS bytes over standard links
 * only (Bluetooth SPP, Bluetooth LE GATT, USB printer class, TCP 9100), so
 * any thermal printer works without a vendor SDK.
 *
 * - listPaired / printBytes: raw ESC/POS bytes to a thermal printer over
 *   Bluetooth Classic (SPP). The printer is paired in Android's Bluetooth
 *   settings first; the app only lists bonded devices, no scanning.
 * - systemPrint: Android's PrintManager dialog — fallback for any printer
 *   the device reaches through a print service (Wi-Fi, PDF…), since
 *   window.print() is a silent no-op inside the Capacitor WebView.
 *
 * - scanBle / printBle: BLE-only printers (no Classic profile). Found by
 *   a short scan, data written to the printer's "serial over GATT"
 *   characteristic in MTU-sized chunks.
 *
 * Android 12+ needs BLUETOOTH_CONNECT (and BLUETOOTH_SCAN for the BLE scan)
 * granted at runtime, not only declared. Android 11 and older need the
 * location permission — and location turned on — to see BLE devices.
 */
@CapacitorPlugin(
    name = "ReceiptPrinter",
    permissions = {
        @Permission(alias = "bluetooth", strings = { Manifest.permission.BLUETOOTH_CONNECT }),
        @Permission(alias = "bleScan", strings = { Manifest.permission.BLUETOOTH_SCAN }),
        @Permission(alias = "location", strings = { Manifest.permission.ACCESS_FINE_LOCATION })
    }
)
public class ReceiptPrinterPlugin extends Plugin {

    private static final UUID SPP_UUID = UUID.fromString("00001101-0000-1000-8000-00805F9B34FB");
    // The printer must finish pulling the data off the link before it
    // closes — disconnecting right after write() cuts or loses the ticket.
    private static final long FLUSH_DELAY_MS = 800;

    // PrintManager reads the page asynchronously — the WebView must stay
    // referenced until the job is spooled, or it gets garbage-collected.
    private WebView printView;

    private boolean needsRuntimePermission() {
        return Build.VERSION.SDK_INT >= Build.VERSION_CODES.S
            && getPermissionState("bluetooth") != PermissionState.GRANTED;
    }

    private BluetoothAdapter adapter() {
        BluetoothManager bm = (BluetoothManager) getContext().getSystemService(Context.BLUETOOTH_SERVICE);
        return bm != null ? bm.getAdapter() : null;
    }

    @PluginMethod
    public void listPaired(PluginCall call) {
        if (needsRuntimePermission()) {
            requestPermissionForAlias("bluetooth", call, "listPairedPermission");
            return;
        }
        doListPaired(call);
    }

    @PermissionCallback
    private void listPairedPermission(PluginCall call) {
        if (needsRuntimePermission()) {
            call.reject("Autorisation Bluetooth refusée — activez-la dans les réglages de l'application.");
            return;
        }
        doListPaired(call);
    }

    @SuppressLint("MissingPermission")
    private void doListPaired(PluginCall call) {
        BluetoothAdapter adapter = adapter();
        if (adapter == null) {
            call.reject("Cet appareil n'a pas de Bluetooth.");
            return;
        }
        if (!adapter.isEnabled()) {
            call.reject("Le Bluetooth est désactivé — activez-le puis réessayez.");
            return;
        }
        JSArray devices = new JSArray();
        for (BluetoothDevice d : adapter.getBondedDevices()) {
            JSObject o = new JSObject();
            o.put("name", d.getName() != null ? d.getName() : d.getAddress());
            o.put("address", d.getAddress());
            BluetoothClass cls = d.getBluetoothClass();
            o.put("isPrinter", cls != null && cls.getMajorDeviceClass() == BluetoothClass.Device.Major.IMAGING);
            devices.put(o);
        }
        JSObject ret = new JSObject();
        ret.put("devices", devices);
        call.resolve(ret);
    }

    @PluginMethod
    public void printBytes(PluginCall call) {
        if (needsRuntimePermission()) {
            requestPermissionForAlias("bluetooth", call, "printBytesPermission");
            return;
        }
        doPrintBytes(call);
    }

    @PermissionCallback
    private void printBytesPermission(PluginCall call) {
        if (needsRuntimePermission()) {
            call.reject("Autorisation Bluetooth refusée — activez-la dans les réglages de l'application.");
            return;
        }
        doPrintBytes(call);
    }

    @SuppressLint("MissingPermission")
    private void doPrintBytes(PluginCall call) {
        String address = call.getString("address");
        String data = call.getString("data");
        if (address == null || data == null) {
            call.reject("address et data requis");
            return;
        }
        BluetoothAdapter adapter = adapter();
        if (adapter == null || !adapter.isEnabled()) {
            call.reject("Le Bluetooth est désactivé — activez-le puis réessayez.");
            return;
        }
        byte[] bytes = Base64.decode(data, Base64.DEFAULT);

        // Socket I/O blocks — never on the UI thread.
        new Thread(() -> {
            BluetoothSocket socket = null;
            try {
                // Discovery slows/breaks RFCOMM connects. Needs BLUETOOTH_SCAN
                // on Android 12+, which we don't request — best effort only.
                try { adapter.cancelDiscovery(); } catch (SecurityException ignored) {}
                BluetoothDevice device = adapter.getRemoteDevice(address);
                socket = connect(device);
                OutputStream out = socket.getOutputStream();
                out.write(bytes);
                out.flush();
                Thread.sleep(FLUSH_DELAY_MS);
                call.resolve();
            } catch (Exception e) {
                call.reject("Imprimante injoignable : allumez-la et vérifiez qu'elle est appairée. (" + e.getMessage() + ")");
            } finally {
                if (socket != null) {
                    try { socket.close(); } catch (Exception ignored) {}
                }
            }
        }).start();
    }

    /** Standard SPP socket, then the insecure variant, then the channel-1
     *  reflection hack that many cheap printers only answer to. */
    @SuppressLint("MissingPermission")
    private BluetoothSocket connect(BluetoothDevice device) throws Exception {
        Exception last;
        try {
            BluetoothSocket s = device.createRfcommSocketToServiceRecord(SPP_UUID);
            s.connect();
            return s;
        } catch (Exception e) { last = e; }
        try {
            BluetoothSocket s = device.createInsecureRfcommSocketToServiceRecord(SPP_UUID);
            s.connect();
            return s;
        } catch (Exception e) { last = e; }
        try {
            Method m = device.getClass().getMethod("createRfcommSocket", int.class);
            BluetoothSocket s = (BluetoothSocket) m.invoke(device, 1);
            s.connect();
            return s;
        } catch (Exception e) { last = e; }
        throw last;
    }

    // ------------------------------------------------------------------
    // Bluetooth LE — printers without the Classic (SPP) profile.
    // ------------------------------------------------------------------

    // Vendor "serial over GATT" services used by cheap thermal printers —
    // same list as the web transport (printer.ts). Tried first; any other
    // writable characteristic is the fallback.
    private static final String[] BLE_SERVICES = {
        "000018f0-0000-1000-8000-00805f9b34fb",
        "e7810a71-73ae-499d-8c15-faa9aef0c3f2",
        "49535343-fe7d-4ae5-8fa9-9fafd205e455",
        "0000ff00-0000-1000-8000-00805f9b34fb",
        "0000ffe0-0000-1000-8000-00805f9b34fb",
        "0000fee7-0000-1000-8000-00805f9b34fb",
        "0000ae30-0000-1000-8000-00805f9b34fb",
    };
    // GAP, GATT, Device Information — never the print channel.
    private static final String[] BLE_SKIP = {
        "00001800-0000-1000-8000-00805f9b34fb",
        "00001801-0000-1000-8000-00805f9b34fb",
        "0000180a-0000-1000-8000-00805f9b34fb",
    };
    private static final long BLE_SCAN_MS = 6000;
    private static final int BLE_MTU = 185;

    /** Permission aliases still missing for a BLE operation on this SDK. */
    private String[] missingBleAliases(boolean scan) {
        List<String> missing = new ArrayList<>();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            if (getPermissionState("bluetooth") != PermissionState.GRANTED) missing.add("bluetooth");
            if (scan && getPermissionState("bleScan") != PermissionState.GRANTED) missing.add("bleScan");
        } else if (scan && getPermissionState("location") != PermissionState.GRANTED) {
            missing.add("location");
        }
        return missing.toArray(new String[0]);
    }

    @PluginMethod
    public void scanBle(PluginCall call) {
        String[] missing = missingBleAliases(true);
        if (missing.length > 0) {
            requestPermissionForAliases(missing, call, "scanBlePermission");
            return;
        }
        doScanBle(call);
    }

    @PermissionCallback
    private void scanBlePermission(PluginCall call) {
        if (missingBleAliases(true).length > 0) {
            call.reject(Build.VERSION.SDK_INT >= Build.VERSION_CODES.S
                ? "Autorisation « Appareils à proximité » refusée — activez-la dans les réglages de l'application."
                : "Autorisation de localisation refusée — Android en a besoin pour trouver les imprimantes Bluetooth.");
            return;
        }
        doScanBle(call);
    }

    @SuppressLint("MissingPermission")
    private void doScanBle(PluginCall call) {
        BluetoothAdapter adapter = adapter();
        if (adapter == null || !adapter.isEnabled()) {
            call.reject("Le Bluetooth est désactivé — activez-le puis réessayez.");
            return;
        }
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S && Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            // Before Android 12, BLE scans silently return nothing with location off.
            LocationManager lm = (LocationManager) getContext().getSystemService(Context.LOCATION_SERVICE);
            if (lm != null && !lm.isLocationEnabled()) {
                call.reject("Activez la localisation du téléphone pour rechercher les imprimantes Bluetooth.");
                return;
            }
        }
        BluetoothLeScanner scanner = adapter.getBluetoothLeScanner();
        if (scanner == null) {
            call.reject("Recherche Bluetooth indisponible sur cet appareil.");
            return;
        }

        Map<String, JSObject> found = new LinkedHashMap<>();
        ScanCallback cb = new ScanCallback() {
            @Override
            public void onScanResult(int callbackType, ScanResult result) {
                BluetoothDevice d = result.getDevice();
                String name = d.getName();
                if ((name == null || name.isEmpty()) && result.getScanRecord() != null) {
                    name = result.getScanRecord().getDeviceName();
                }
                // Unnamed beacons/phones flood the list — a printer always
                // advertises a name.
                if (name == null || name.isEmpty()) return;
                JSObject o = new JSObject();
                o.put("name", name);
                o.put("address", d.getAddress());
                o.put("rssi", result.getRssi());
                synchronized (found) { found.put(d.getAddress(), o); }
            }

            @Override
            public void onScanFailed(int errorCode) {
                // Resolved by the timeout below with whatever was found.
            }
        };
        ScanSettings settings = new ScanSettings.Builder().setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY).build();
        scanner.startScan(null, settings, cb);

        new Handler(Looper.getMainLooper()).postDelayed(() -> {
            try { scanner.stopScan(cb); } catch (Exception ignored) {}
            JSArray devices = new JSArray();
            synchronized (found) { for (JSObject o : found.values()) devices.put(o); }
            JSObject ret = new JSObject();
            ret.put("devices", devices);
            call.resolve(ret);
        }, BLE_SCAN_MS);
    }

    @PluginMethod
    public void printBle(PluginCall call) {
        String[] missing = missingBleAliases(false);
        if (missing.length > 0) {
            requestPermissionForAliases(missing, call, "printBlePermission");
            return;
        }
        doPrintBle(call);
    }

    @PermissionCallback
    private void printBlePermission(PluginCall call) {
        if (missingBleAliases(false).length > 0) {
            call.reject("Autorisation Bluetooth refusée — activez-la dans les réglages de l'application.");
            return;
        }
        doPrintBle(call);
    }

    /** Turns the async GATT callbacks into blocking steps for the worker thread. */
    private static class BleSession extends BluetoothGattCallback {
        final CountDownLatch connected = new CountDownLatch(1);
        final CountDownLatch discovered = new CountDownLatch(1);
        final CountDownLatch mtuChanged = new CountDownLatch(1);
        final Semaphore written = new Semaphore(0);
        volatile boolean dropped = false;
        volatile int mtu = 23;
        volatile int writeStatus = BluetoothGatt.GATT_SUCCESS;

        private void releaseAll() {
            connected.countDown();
            discovered.countDown();
            mtuChanged.countDown();
            written.release();
        }

        @Override
        public void onConnectionStateChange(BluetoothGatt gatt, int status, int newState) {
            if (newState == BluetoothProfile.STATE_CONNECTED && status == BluetoothGatt.GATT_SUCCESS) {
                connected.countDown();
            } else {
                dropped = true;
                releaseAll();
            }
        }

        @Override
        public void onServicesDiscovered(BluetoothGatt gatt, int status) {
            discovered.countDown();
        }

        @Override
        public void onMtuChanged(BluetoothGatt gatt, int mtu, int status) {
            if (status == BluetoothGatt.GATT_SUCCESS) this.mtu = mtu;
            mtuChanged.countDown();
        }

        @Override
        public void onCharacteristicWrite(BluetoothGatt gatt, BluetoothGattCharacteristic ch, int status) {
            writeStatus = status;
            written.release();
        }
    }

    private static boolean isWritable(BluetoothGattCharacteristic c) {
        int p = c.getProperties();
        return (p & (BluetoothGattCharacteristic.PROPERTY_WRITE | BluetoothGattCharacteristic.PROPERTY_WRITE_NO_RESPONSE)) != 0;
    }

    private static BluetoothGattCharacteristic findBleCharacteristic(BluetoothGatt gatt) {
        for (String uuid : BLE_SERVICES) {
            BluetoothGattService svc = gatt.getService(UUID.fromString(uuid));
            if (svc == null) continue;
            for (BluetoothGattCharacteristic c : svc.getCharacteristics()) if (isWritable(c)) return c;
        }
        outer:
        for (BluetoothGattService svc : gatt.getServices()) {
            String id = svc.getUuid().toString();
            for (String skip : BLE_SKIP) if (skip.equalsIgnoreCase(id)) continue outer;
            for (BluetoothGattCharacteristic c : svc.getCharacteristics()) if (isWritable(c)) return c;
        }
        return null;
    }

    @SuppressLint("MissingPermission")
    @SuppressWarnings("deprecation")
    private boolean writeChunk(BluetoothGatt gatt, BluetoothGattCharacteristic ch, byte[] chunk, int writeType) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            return gatt.writeCharacteristic(ch, chunk, writeType) == BluetoothStatusCodes.SUCCESS;
        }
        ch.setWriteType(writeType);
        ch.setValue(chunk);
        return gatt.writeCharacteristic(ch);
    }

    @SuppressLint("MissingPermission")
    private void doPrintBle(PluginCall call) {
        String address = call.getString("address");
        String data = call.getString("data");
        if (address == null || data == null) {
            call.reject("address et data requis");
            return;
        }
        BluetoothAdapter adapter = adapter();
        if (adapter == null || !adapter.isEnabled()) {
            call.reject("Le Bluetooth est désactivé — activez-le puis réessayez.");
            return;
        }
        byte[] bytes = Base64.decode(data, Base64.DEFAULT);

        new Thread(() -> {
            BleSession session = new BleSession();
            BluetoothGatt gatt = null;
            try {
                BluetoothDevice device = adapter.getRemoteDevice(address);
                gatt = device.connectGatt(getContext(), false, session, BluetoothDevice.TRANSPORT_LE);
                if (!session.connected.await(10, TimeUnit.SECONDS) || session.dropped) throw new Exception("connexion impossible");
                if (!gatt.discoverServices()) throw new Exception("services illisibles");
                if (!session.discovered.await(10, TimeUnit.SECONDS) || session.dropped) throw new Exception("services illisibles");

                // Bigger packets when the printer accepts it (default MTU 23 → 20 bytes).
                if (gatt.requestMtu(BLE_MTU)) session.mtuChanged.await(3, TimeUnit.SECONDS);
                if (session.dropped) throw new Exception("connexion perdue");

                BluetoothGattCharacteristic ch = findBleCharacteristic(gatt);
                if (ch == null) throw new Exception("aucun canal d'impression trouvé");

                // With-response writes give real flow control — the printer's
                // small buffer can't overflow. No-response only when it's the
                // only option, paced by a short pause.
                boolean withResponse = (ch.getProperties() & BluetoothGattCharacteristic.PROPERTY_WRITE) != 0;
                int writeType = withResponse
                    ? BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT
                    : BluetoothGattCharacteristic.WRITE_TYPE_NO_RESPONSE;
                int chunkSize = Math.max(20, session.mtu - 3);

                for (int off = 0; off < bytes.length; off += chunkSize) {
                    int n = Math.min(chunkSize, bytes.length - off);
                    byte[] chunk = new byte[n];
                    System.arraycopy(bytes, off, chunk, 0, n);
                    // The stack refuses a write while the previous one is in flight.
                    int tries = 0;
                    while (!writeChunk(gatt, ch, chunk, writeType)) {
                        if (++tries > 50 || session.dropped) throw new Exception("envoi refusé");
                        Thread.sleep(20);
                    }
                    if (withResponse) {
                        if (!session.written.tryAcquire(5, TimeUnit.SECONDS) || session.dropped) throw new Exception("envoi interrompu");
                        if (session.writeStatus != BluetoothGatt.GATT_SUCCESS) throw new Exception("envoi rejeté (" + session.writeStatus + ")");
                    } else {
                        // Some stacks never confirm no-response writes — don't block on it.
                        session.written.tryAcquire(300, TimeUnit.MILLISECONDS);
                        if (session.dropped) throw new Exception("connexion perdue");
                        Thread.sleep(10);
                    }
                }
                Thread.sleep(FLUSH_DELAY_MS);
                call.resolve();
            } catch (Exception e) {
                call.reject("Imprimante Bluetooth injoignable : allumez-la et rapprochez-vous. (" + e.getMessage() + ")");
            } finally {
                if (gatt != null) {
                    try { gatt.disconnect(); } catch (Exception ignored) {}
                    try { gatt.close(); } catch (Exception ignored) {}
                }
            }
        }).start();
    }

    // ------------------------------------------------------------------
    // USB (OTG cable, or the USB port of a tablet / POS terminal). Uses the
    // standard USB printer class (07) or, failing that, any interface with
    // a bulk OUT endpoint — no vendor SDK involved.
    // ------------------------------------------------------------------
    private static final String USB_PERMISSION = "com.scanlinkpay.app.USB_PRINTER_PERMISSION";

    private UsbManager usbManager() {
        return (UsbManager) getContext().getSystemService(Context.USB_SERVICE);
    }

    /** First interface that can receive print data: printer class
     *  preferred, else any bulk OUT endpoint. Returns {interface, endpoint}. */
    private Object[] findPrintEndpoint(UsbDevice device) {
        Object[] fallback = null;
        for (int i = 0; i < device.getInterfaceCount(); i++) {
            UsbInterface iface = device.getInterface(i);
            for (int e = 0; e < iface.getEndpointCount(); e++) {
                UsbEndpoint ep = iface.getEndpoint(e);
                if (ep.getType() == UsbConstants.USB_ENDPOINT_XFER_BULK && ep.getDirection() == UsbConstants.USB_DIR_OUT) {
                    if (iface.getInterfaceClass() == UsbConstants.USB_CLASS_PRINTER) return new Object[] { iface, ep };
                    if (fallback == null) fallback = new Object[] { iface, ep };
                }
            }
        }
        return fallback;
    }

    @PluginMethod
    public void listUsb(PluginCall call) {
        UsbManager um = usbManager();
        JSArray devices = new JSArray();
        if (um != null) {
            for (UsbDevice d : um.getDeviceList().values()) {
                Object[] target = findPrintEndpoint(d);
                if (target == null) continue;
                String name = d.getProductName();
                if (name == null || name.isEmpty()) name = "USB " + Integer.toHexString(d.getVendorId()) + ":" + Integer.toHexString(d.getProductId());
                JSObject o = new JSObject();
                o.put("name", name);
                o.put("vendorId", d.getVendorId());
                o.put("productId", d.getProductId());
                o.put("isPrinter", ((UsbInterface) target[0]).getInterfaceClass() == UsbConstants.USB_CLASS_PRINTER);
                devices.put(o);
            }
        }
        JSObject ret = new JSObject();
        ret.put("devices", devices);
        call.resolve(ret);
    }

    @PluginMethod
    public void printUsb(PluginCall call) {
        Integer vendorId = call.getInt("vendorId");
        Integer productId = call.getInt("productId");
        String data = call.getString("data");
        if (vendorId == null || productId == null || data == null) {
            call.reject("vendorId, productId et data requis");
            return;
        }
        UsbManager um = usbManager();
        UsbDevice device = null;
        if (um != null) {
            // Matched by ids, not by device path — the path changes on replug.
            for (UsbDevice d : um.getDeviceList().values()) {
                if (d.getVendorId() == vendorId && d.getProductId() == productId) { device = d; break; }
            }
        }
        if (device == null) {
            call.reject("Imprimante USB non branchée — vérifiez le câble.");
            return;
        }
        byte[] bytes = Base64.decode(data, Base64.DEFAULT);
        if (um.hasPermission(device)) {
            writeUsb(call, um, device, bytes);
            return;
        }

        // First use: Android asks the user to allow access to the device.
        final UsbDevice target = device;
        BroadcastReceiver receiver = new BroadcastReceiver() {
            @Override
            public void onReceive(Context ctx, Intent intent) {
                getContext().unregisterReceiver(this);
                if (intent.getBooleanExtra(UsbManager.EXTRA_PERMISSION_GRANTED, false)) {
                    writeUsb(call, um, target, bytes);
                } else {
                    call.reject("Accès à l'imprimante USB refusé.");
                }
            }
        };
        ContextCompat.registerReceiver(getContext(), receiver, new IntentFilter(USB_PERMISSION), ContextCompat.RECEIVER_NOT_EXPORTED);
        // Explicit + mutable: required since Android 12/14 for the system to
        // fill in EXTRA_PERMISSION_GRANTED.
        Intent intent = new Intent(USB_PERMISSION).setPackage(getContext().getPackageName());
        int flags = Build.VERSION.SDK_INT >= Build.VERSION_CODES.S ? PendingIntent.FLAG_MUTABLE : 0;
        um.requestPermission(device, PendingIntent.getBroadcast(getContext(), 0, intent, flags));
    }

    private void writeUsb(PluginCall call, UsbManager um, UsbDevice device, byte[] bytes) {
        new Thread(() -> {
            Object[] target = findPrintEndpoint(device);
            UsbDeviceConnection conn = um.openDevice(device);
            if (target == null || conn == null) {
                call.reject("Impossible d'ouvrir l'imprimante USB.");
                return;
            }
            UsbInterface iface = (UsbInterface) target[0];
            UsbEndpoint ep = (UsbEndpoint) target[1];
            try {
                if (!conn.claimInterface(iface, true)) throw new Exception("interface occupée");
                for (int off = 0; off < bytes.length; off += 4096) {
                    int n = Math.min(4096, bytes.length - off);
                    byte[] chunk = new byte[n];
                    System.arraycopy(bytes, off, chunk, 0, n);
                    if (conn.bulkTransfer(ep, chunk, n, 5000) < 0) throw new Exception("envoi interrompu");
                }
                Thread.sleep(FLUSH_DELAY_MS);
                call.resolve();
            } catch (Exception e) {
                call.reject("Impression USB impossible : " + e.getMessage());
            } finally {
                conn.releaseInterface(iface);
                conn.close();
            }
        }).start();
    }

    // ------------------------------------------------------------------
    // Network (Wi-Fi / Ethernet). Raw TCP on port 9100 ("JetDirect") is
    // what every network thermal printer listens on.
    // ------------------------------------------------------------------
    @PluginMethod
    public void printNetwork(PluginCall call) {
        String host = call.getString("host");
        int port = call.getInt("port", 9100);
        String data = call.getString("data");
        if (host == null || host.isEmpty() || data == null) {
            call.reject("host et data requis");
            return;
        }
        byte[] bytes = Base64.decode(data, Base64.DEFAULT);
        new Thread(() -> {
            try (Socket socket = new Socket()) {
                socket.connect(new InetSocketAddress(host, port), 5000);
                OutputStream out = socket.getOutputStream();
                out.write(bytes);
                out.flush();
                Thread.sleep(FLUSH_DELAY_MS);
                call.resolve();
            } catch (Exception e) {
                call.reject("Imprimante réseau injoignable (" + host + ":" + port + ") — même Wi-Fi ? " + e.getMessage());
            }
        }).start();
    }

    @PluginMethod
    public void systemPrint(PluginCall call) {
        String html = call.getString("html");
        String jobName = call.getString("jobName", "Recu");
        if (html == null || html.isEmpty()) {
            call.reject("html requis");
            return;
        }

        getActivity().runOnUiThread(() -> {
            WebView view = new WebView(getContext());
            view.setWebViewClient(new WebViewClient() {
                private boolean started = false;

                @Override
                public void onPageFinished(WebView v, String url) {
                    if (started) return; // can fire more than once
                    started = true;
                    try {
                        PrintManager pm = (PrintManager) getActivity().getSystemService(Context.PRINT_SERVICE);
                        pm.print(jobName, v.createPrintDocumentAdapter(jobName), new PrintAttributes.Builder().build());
                        call.resolve();
                    } catch (Exception e) {
                        call.reject("Impression impossible : " + e.getMessage());
                    }
                }
            });
            printView = view;
            view.loadDataWithBaseURL(null, html, "text/html", "UTF-8", null);
        });
    }
}
