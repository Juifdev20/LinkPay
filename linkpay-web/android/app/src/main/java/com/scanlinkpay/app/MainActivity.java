package com.scanlinkpay.app;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Local plugins must be registered before the bridge starts.
        registerPlugin(ReceiptPrinterPlugin.class);
        registerPlugin(ScreenProtectionPlugin.class);
        registerPlugin(DeviceIntegrityPlugin.class);
        super.onCreate(savedInstanceState);
        // Screenshot protection decided by the super admin, applied before
        // anything is drawn (the app refreshes it from the server afterwards).
        ScreenProtectionPlugin.apply(this, ScreenProtectionPlugin.isEnabled(this));
    }
}
