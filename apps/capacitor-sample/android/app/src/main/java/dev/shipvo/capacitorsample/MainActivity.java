package dev.shipvo.capacitorsample;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;
import dev.shipvo.capacitor.ShipvoPlugin;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(ShipvoPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
