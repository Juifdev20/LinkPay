package com.scanlinkpay.app;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.android.play.core.integrity.IntegrityManager;
import com.google.android.play.core.integrity.IntegrityManagerFactory;
import com.google.android.play.core.integrity.IntegrityTokenRequest;

/**
 * Device and app integrity for the web layer.
 *
 *  - checkRoot(): the on-device heuristics (see RootDetector) — advisory, can be hidden by root tools.
 *  - requestIntegrityToken({ nonce, cloudProjectNumber }): a Google Play Integrity token that the
 *    API verifies with Google. This is the trustworthy part: it says whether the app is the genuine
 *    build signed by us and whether the device is certified and unmodified.
 *
 * The app never decides anything from these results itself; it forwards them to the API
 * (POST /integrity/verify), which does.
 */
@CapacitorPlugin(name = "DeviceIntegrity")
public class DeviceIntegrityPlugin extends Plugin {

    @PluginMethod
    public void checkRoot(PluginCall call) {
        // File, process and socket probes: off the UI thread.
        new Thread(() -> {
            RootDetector.Result r = RootDetector.run(new AndroidProbe(getContext()));
            JSArray signals = new JSArray();
            for (String s : r.signals) signals.put(s);
            JSObject out = new JSObject();
            out.put("rooted", r.rooted);
            out.put("signals", signals);
            call.resolve(out);
        }, "root-check").start();
    }

    @PluginMethod
    public void requestIntegrityToken(PluginCall call) {
        String nonce = call.getString("nonce");
        String project = call.getString("cloudProjectNumber");
        if (nonce == null || nonce.isEmpty()) {
            call.reject("nonce is required");
            return;
        }
        long projectNumber;
        try {
            projectNumber = Long.parseLong(project == null ? "" : project.trim());
        } catch (NumberFormatException e) {
            call.reject("cloudProjectNumber is required");
            return;
        }

        IntegrityManager manager = IntegrityManagerFactory.create(getContext().getApplicationContext());
        manager
            .requestIntegrityToken(IntegrityTokenRequest.builder().setNonce(nonce).setCloudProjectNumber(projectNumber).build())
            .addOnSuccessListener(response -> {
                JSObject out = new JSObject();
                out.put("token", response.token());
                call.resolve(out);
            })
            .addOnFailureListener(e -> call.reject("INTEGRITY_UNAVAILABLE", e instanceof Exception ? (Exception) e : new Exception(e)));
    }
}
