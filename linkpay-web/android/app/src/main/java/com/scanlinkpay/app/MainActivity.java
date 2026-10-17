package com.scanlinkpay.app;

import android.os.Bundle;
import android.view.View;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Local plugins must be registered before the bridge starts.
        registerPlugin(ReceiptPrinterPlugin.class);
        registerPlugin(ScreenProtectionPlugin.class);
        registerPlugin(DeviceIntegrityPlugin.class);
        super.onCreate(savedInstanceState);
        // No Android 12+ "stretch" at the end of a scroll: it stretches the
        // whole WebView, top and bottom bars included, which feels like a web page.
        getBridge().getWebView().setOverScrollMode(View.OVER_SCROLL_NEVER);
        // Screenshot protection decided by the super admin, applied before
        // anything is drawn (the app refreshes it from the server afterwards).
        ScreenProtectionPlugin.apply(this, ScreenProtectionPlugin.isEnabled(this));
    }
}
