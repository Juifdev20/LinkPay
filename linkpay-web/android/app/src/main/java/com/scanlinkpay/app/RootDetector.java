package com.scanlinkpay.app;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;

/**
 * Heuristics that tell whether the phone the app runs on has been rooted, is an emulator, or has
 * a hooking framework attached.
 *
 * These checks are ADVISORY. Anything running with root can hide from them (Magisk's "Zygisk
 * DenyList", Shamiko, a patched app…), so a clean result proves nothing — the real answer comes from
 * Google Play Integrity, verified on the server. What these checks add is a cheap early warning and a
 * list of reasons for the admins; they can only ever make the server MORE suspicious, never less.
 *
 * The logic is separated from Android (see {@link Probe}) so it can be unit-tested on a plain JVM.
 */
final class RootDetector {

    /** Everything the detector needs to look at; AndroidProbe is the real implementation. */
    interface Probe {
        boolean fileExists(String path);
        boolean packageInstalled(String packageName);
        String buildTags();
        String buildFingerprint();
        String buildModel();
        String buildHardware();
        String buildProduct();
        /** Whole text of a file, or null when it can't be read. */
        String readFile(String path);
        /** A system property (getprop), or null. */
        String getProp(String key);
        boolean classLoadable(String className);
        /** Whether something listens on 127.0.0.1:port (Frida's default is 27042). */
        boolean localPortOpen(int port);
        /** Output of `which su`, or null when there is no su on the PATH. */
        String whichSu();
        boolean appIsDebuggable();
        boolean debuggerAttached();
    }

    static final class Result {
        final List<String> signals;
        final boolean rooted;

        Result(List<String> signals, boolean rooted) {
            this.signals = Collections.unmodifiableList(signals);
            this.rooted = rooted;
        }
    }

    static final String[] SU_PATHS = {
        "/system/bin/su", "/system/xbin/su", "/sbin/su", "/system/su", "/su/bin/su", "/su/xbin/su",
        "/vendor/bin/su", "/data/local/su", "/data/local/bin/su", "/data/local/xbin/su",
        "/system/sd/xbin/su", "/system/bin/failsafe/su", "/system/app/Superuser.apk",
        "/system/xbin/daemonsu", "/system/xbin/busybox"
    };

    static final String[] MAGISK_PATHS = {
        "/sbin/.magisk", "/data/adb/magisk", "/data/adb/modules", "/data/adb/ksu", "/data/adb/ap",
        "/cache/magisk.log", "/data/local/tmp/magisk"
    };

    /** Root managers and root-hiding tools. Each must also be declared in the manifest's <queries> (Android 11+). */
    static final String[] ROOT_PACKAGES = {
        "com.topjohnwu.magisk", "io.github.vvb2060.magisk", "io.github.huskydg.magisk", "me.weishu.kernelsu",
        "eu.chainfire.supersu", "com.koushikdutta.superuser", "com.noshufou.android.su",
        "com.thirdparty.superuser", "com.yellowes.su", "com.devadvance.rootcloak", "com.devadvance.rootcloakplus",
        "de.robv.android.xposed.installer", "org.lsposed.manager", "com.saurik.substrate"
    };

    static final String[] HOOKING_CLASSES = {
        "de.robv.android.xposed.XposedBridge", "com.saurik.substrate.MS$2"
    };

    static final int FRIDA_PORT = 27042;

    private static final Set<String> ROOT_SIGNALS = new LinkedHashSet<>(Arrays.asList(
        "su_binary", "su_in_path", "root_app", "test_keys", "rw_system", "magisk_files", "dangerous_props", "hooking_framework"));

    private RootDetector() {}

    static Result run(Probe p) {
        List<String> signals = new ArrayList<>();

        for (String path : SU_PATHS) {
            if (p.fileExists(path)) { signals.add("su_binary"); break; }
        }
        String which = p.whichSu();
        if (which != null && !which.trim().isEmpty()) signals.add("su_in_path");

        for (String pkg : ROOT_PACKAGES) {
            if (p.packageInstalled(pkg)) { signals.add("root_app"); break; }
        }

        String tags = p.buildTags();
        if (tags != null && tags.contains("test-keys")) signals.add("test_keys");

        if (systemMountedWritable(p.readFile("/proc/mounts"))) signals.add("rw_system");

        for (String path : MAGISK_PATHS) {
            if (p.fileExists(path)) { signals.add("magisk_files"); break; }
        }

        if ("1".equals(p.getProp("ro.debuggable")) || "0".equals(p.getProp("ro.secure"))) signals.add("dangerous_props");

        boolean hooking = false;
        for (String c : HOOKING_CLASSES) {
            if (p.classLoadable(c)) { hooking = true; break; }
        }
        String maps = p.readFile("/proc/self/maps");
        if (maps != null) {
            String lower = maps.toLowerCase();
            if (lower.contains("frida") || lower.contains("gum-js-loop") || lower.contains("xposed") || lower.contains("lsposed")) hooking = true;
        }
        if (p.localPortOpen(FRIDA_PORT)) hooking = true;
        if (hooking) signals.add("hooking_framework");

        if (looksLikeEmulator(p)) signals.add("emulator");
        if (p.appIsDebuggable()) signals.add("debuggable_app");
        if (p.debuggerAttached()) signals.add("debugger_attached");

        boolean rooted = false;
        for (String s : signals) {
            if (ROOT_SIGNALS.contains(s)) { rooted = true; break; }
        }
        return new Result(signals, rooted);
    }

    /** /system, /vendor, /product and the like are read-only on a stock phone; "rw" there means someone remounted them. */
    static boolean systemMountedWritable(String mounts) {
        if (mounts == null) return false;
        for (String line : mounts.split("\n")) {
            String[] f = line.trim().split("\\s+");
            if (f.length < 4) continue;
            String mountPoint = f[1];
            if (!(mountPoint.equals("/system") || mountPoint.equals("/vendor") || mountPoint.equals("/product") || mountPoint.equals("/system_ext"))) continue;
            for (String opt : f[3].split(",")) {
                if (opt.equals("rw")) return true;
            }
        }
        return false;
    }

    static boolean looksLikeEmulator(Probe p) {
        String fp = nz(p.buildFingerprint());
        String model = nz(p.buildModel());
        String hw = nz(p.buildHardware());
        String product = nz(p.buildProduct());
        return fp.startsWith("generic") || fp.startsWith("unknown") || fp.contains("emulator") || fp.contains("sdk_gphone")
            || model.contains("Emulator") || model.contains("Android SDK built for") || model.contains("sdk_gphone")
            || hw.contains("goldfish") || hw.contains("ranchu") || hw.contains("vbox86")
            || product.contains("sdk") || product.contains("emulator") || product.contains("vbox86");
    }

    private static String nz(String s) { return s == null ? "" : s; }
}
