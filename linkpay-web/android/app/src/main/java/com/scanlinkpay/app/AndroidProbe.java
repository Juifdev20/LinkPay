package com.scanlinkpay.app;

import android.content.Context;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Debug;

import java.io.BufferedReader;
import java.io.File;
import java.io.FileReader;
import java.io.InputStream;
import java.net.InetSocketAddress;
import java.net.Socket;
import java.util.Scanner;

/** The real device, seen through {@link RootDetector.Probe}. Every check fails closed to "nothing found". */
final class AndroidProbe implements RootDetector.Probe {
    private final Context context;

    AndroidProbe(Context context) {
        this.context = context;
    }

    @Override public boolean fileExists(String path) {
        try { return new File(path).exists(); } catch (Exception e) { return false; }
    }

    @Override public boolean packageInstalled(String packageName) {
        try {
            context.getPackageManager().getPackageInfo(packageName, 0);
            return true;
        } catch (PackageManager.NameNotFoundException e) {
            return false;
        } catch (Exception e) {
            return false;
        }
    }

    @Override public String buildTags() { return Build.TAGS; }
    @Override public String buildFingerprint() { return Build.FINGERPRINT; }
    @Override public String buildModel() { return Build.MODEL; }
    @Override public String buildHardware() { return Build.HARDWARE; }
    @Override public String buildProduct() { return Build.PRODUCT; }

    @Override public String readFile(String path) {
        try (BufferedReader r = new BufferedReader(new FileReader(path))) {
            StringBuilder sb = new StringBuilder();
            String line;
            int lines = 0;
            while ((line = r.readLine()) != null && lines++ < 5000) sb.append(line).append('\n');
            return sb.toString();
        } catch (Exception e) {
            return null;
        }
    }

    @Override public String getProp(String key) {
        Process p = null;
        try {
            p = Runtime.getRuntime().exec(new String[] {"getprop", key});
            return firstLine(p.getInputStream());
        } catch (Exception e) {
            return null;
        } finally {
            if (p != null) p.destroy();
        }
    }

    @Override public boolean classLoadable(String className) {
        try {
            Class.forName(className);
            return true;
        } catch (Throwable t) {
            return false;
        }
    }

    @Override public boolean localPortOpen(int port) {
        try (Socket s = new Socket()) {
            s.connect(new InetSocketAddress("127.0.0.1", port), 150);
            return true;
        } catch (Exception e) {
            return false;
        }
    }

    @Override public String whichSu() {
        Process p = null;
        try {
            p = Runtime.getRuntime().exec(new String[] {"which", "su"});
            return firstLine(p.getInputStream());
        } catch (Exception e) {
            return null;
        } finally {
            if (p != null) p.destroy();
        }
    }

    @Override public boolean appIsDebuggable() {
        return (context.getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0;
    }

    @Override public boolean debuggerAttached() {
        return Debug.isDebuggerConnected() || Debug.waitingForDebugger();
    }

    private static String firstLine(InputStream in) {
        try (Scanner sc = new Scanner(in)) {
            return sc.hasNextLine() ? sc.nextLine() : null;
        }
    }
}
