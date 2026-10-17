package com.scanlinkpay.app;

import android.app.Activity;
import android.content.Context;
import android.content.SharedPreferences;
import android.view.WindowManager;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Screenshot protection — the platform-wide switch the super admin controls
 * (platform_settings.screenshot_protection). FLAG_SECURE makes screenshots,
 * screen recordings and the recent-apps preview of the app come out black,
 * like WhatsApp does.
 *
 * The last decision is kept in SharedPreferences and re-applied by
 * MainActivity.onCreate BEFORE the WebView shows anything — so the splash,
 * the login and the PIN screens are protected even with no network.
 */
@CapacitorPlugin(name = "ScreenProtection")
public class ScreenProtectionPlugin extends Plugin {

    private static final String PREFS = "screen_protection";
    private static final String KEY = "enabled";

    static boolean isEnabled(Context ctx) {
        return ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getBoolean(KEY, false);
    }

    static void apply(Activity activity, boolean enabled) {
        if (enabled) {
            activity.getWindow().addFlags(WindowManager.LayoutParams.FLAG_SECURE);
        } else {
            activity.getWindow().clearFlags(WindowManager.LayoutParams.FLAG_SECURE);
        }
    }

    /** Tells the app it's back in the foreground, so it re-reads the switch
     *  (more reliable than the WebView's visibilitychange). */
    @Override
    protected void handleOnResume() {
        super.handleOnResume();
        notifyListeners("resume", null);
    }

    @PluginMethod
    public void setEnabled(PluginCall call) {
        boolean enabled = Boolean.TRUE.equals(call.getBoolean("enabled", false));
        SharedPreferences.Editor editor = getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit();
        editor.putBoolean(KEY, enabled).apply();
        getActivity().runOnUiThread(() -> {
            apply(getActivity(), enabled);
            call.resolve();
        });
    }
}
