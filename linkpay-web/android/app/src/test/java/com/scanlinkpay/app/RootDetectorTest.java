package com.scanlinkpay.app;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import java.util.Arrays;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Map;
import java.util.Set;

import org.junit.Test;

public class RootDetectorTest {

    /** A stock, unrooted Pixel unless a test changes something. */
    static class FakeProbe implements RootDetector.Probe {
        Set<String> files = new HashSet<>();
        Set<String> packages = new HashSet<>();
        Set<String> classes = new HashSet<>();
        Map<String, String> fileContents = new HashMap<>();
        Map<String, String> props = new HashMap<>();
        String tags = "release-keys";
        String fingerprint = "google/panther/panther:14/UP1A.231105.001/10817346:user/release-keys";
        String model = "Pixel 7";
        String hardware = "panther";
        String product = "panther";
        boolean fridaPort = false;
        String su = null;
        boolean debuggable = false;
        boolean debugger = false;

        @Override public boolean fileExists(String path) { return files.contains(path); }
        @Override public boolean packageInstalled(String p) { return packages.contains(p); }
        @Override public String buildTags() { return tags; }
        @Override public String buildFingerprint() { return fingerprint; }
        @Override public String buildModel() { return model; }
        @Override public String buildHardware() { return hardware; }
        @Override public String buildProduct() { return product; }
        @Override public String readFile(String path) { return fileContents.get(path); }
        @Override public String getProp(String key) { return props.get(key); }
        @Override public boolean classLoadable(String c) { return classes.contains(c); }
        @Override public boolean localPortOpen(int port) { return fridaPort && port == RootDetector.FRIDA_PORT; }
        @Override public String whichSu() { return su; }
        @Override public boolean appIsDebuggable() { return debuggable; }
        @Override public boolean debuggerAttached() { return debugger; }
    }

    private static RootDetector.Result run(FakeProbe p) { return RootDetector.run(p); }

    @Test public void stockPhoneHasNoSignals() {
        FakeProbe p = new FakeProbe();
        p.fileContents.put("/proc/mounts", "/dev/block/dm-3 /system ext4 ro,seclabel,relatime 0 0\n/dev/block/dm-4 /vendor ext4 ro,seclabel 0 0\n/dev/block/sda /data ext4 rw,nosuid 0 0\n");
        p.fileContents.put("/proc/self/maps", "7f000000-7f001000 r-xp 00000000 fd:03 123 /system/lib64/libc.so\n");
        RootDetector.Result r = run(p);
        assertEquals(Arrays.<String>asList(), r.signals);
        assertFalse(r.rooted);
    }

    @Test public void suBinaryMeansRooted() {
        FakeProbe p = new FakeProbe();
        p.files.add("/system/xbin/su");
        RootDetector.Result r = run(p);
        assertTrue(r.signals.contains("su_binary"));
        assertTrue(r.rooted);
    }

    @Test public void suOnThePathMeansRooted() {
        FakeProbe p = new FakeProbe();
        p.su = "/sbin/su";
        assertTrue(run(p).signals.contains("su_in_path"));
        assertTrue(run(p).rooted);
        p.su = "   ";
        assertFalse(run(p).signals.contains("su_in_path"));
    }

    @Test public void magiskAndRootManagersAreRooted() {
        FakeProbe p = new FakeProbe();
        p.packages.add("com.topjohnwu.magisk");
        assertTrue(run(p).signals.contains("root_app"));
        FakeProbe q = new FakeProbe();
        q.files.add("/data/adb/modules");
        RootDetector.Result r = run(q);
        assertTrue(r.signals.contains("magisk_files"));
        assertTrue(r.rooted);
        FakeProbe k = new FakeProbe();
        k.packages.add("me.weishu.kernelsu");
        assertTrue(run(k).rooted);
    }

    @Test public void testKeysBuildIsRooted() {
        FakeProbe p = new FakeProbe();
        p.tags = "dev-keys,test-keys";
        RootDetector.Result r = run(p);
        assertTrue(r.signals.contains("test_keys"));
        assertTrue(r.rooted);
    }

    @Test public void writableSystemPartitionIsRooted() {
        FakeProbe p = new FakeProbe();
        p.fileContents.put("/proc/mounts", "/dev/block/dm-3 /system ext4 rw,seclabel,relatime 0 0\n");
        assertTrue(run(p).signals.contains("rw_system"));
        // "rw" must be a whole option, and only on the system partitions
        assertFalse(RootDetector.systemMountedWritable("/dev/x /system ext4 ro,errors=remount-ro 0 0"));
        assertFalse(RootDetector.systemMountedWritable("/dev/x /data ext4 rw 0 0"));
        assertFalse(RootDetector.systemMountedWritable(null));
        assertTrue(RootDetector.systemMountedWritable("/dev/x /vendor ext4 rw,relatime 0 0"));
    }

    @Test public void dangerousPropertiesAreFlagged() {
        FakeProbe p = new FakeProbe();
        p.props.put("ro.debuggable", "1");
        assertTrue(run(p).signals.contains("dangerous_props"));
        FakeProbe q = new FakeProbe();
        q.props.put("ro.secure", "0");
        assertTrue(run(q).rooted);
        FakeProbe ok = new FakeProbe();
        ok.props.put("ro.debuggable", "0");
        ok.props.put("ro.secure", "1");
        assertFalse(run(ok).signals.contains("dangerous_props"));
    }

    @Test public void hookingFrameworksAreDetected() {
        FakeProbe a = new FakeProbe();
        a.classes.add("de.robv.android.xposed.XposedBridge");
        assertTrue(run(a).signals.contains("hooking_framework"));
        FakeProbe b = new FakeProbe();
        b.fileContents.put("/proc/self/maps", "7f0 r-xp /data/local/tmp/frida-agent-64.so\n");
        assertTrue(run(b).signals.contains("hooking_framework"));
        FakeProbe c = new FakeProbe();
        c.fridaPort = true;
        assertTrue(run(c).rooted);
    }

    @Test public void emulatorsAreFlaggedButAreNotCalledRooted() {
        FakeProbe p = new FakeProbe();
        p.fingerprint = "google/sdk_gphone64_x86_64/emu64xa:14/UE1A/1:userdebug/dev-keys";
        p.model = "sdk_gphone64_x86_64";
        p.hardware = "ranchu";
        RootDetector.Result r = run(p);
        assertTrue(r.signals.contains("emulator"));
        assertFalse(r.rooted);
    }

    @Test public void debuggableAppAndDebuggerAreRecordedButNotRoot() {
        FakeProbe p = new FakeProbe();
        p.debuggable = true;
        p.debugger = true;
        RootDetector.Result r = run(p);
        assertTrue(r.signals.contains("debuggable_app"));
        assertTrue(r.signals.contains("debugger_attached"));
        assertFalse(r.rooted);
    }

    @Test public void unreadableFilesNeverCrashTheDetector() {
        FakeProbe p = new FakeProbe();
        p.tags = null;
        p.fingerprint = null;
        p.model = null;
        assertFalse(run(p).rooted);
    }
}
