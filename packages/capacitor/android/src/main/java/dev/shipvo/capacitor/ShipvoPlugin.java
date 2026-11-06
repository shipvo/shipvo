package dev.shipvo.capacitor;

import android.content.Context;
import android.content.SharedPreferences;
import android.util.Base64;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;

/**
 * The native half of @shipvo/capacitor. It backs the core's KeyValueStore (SharedPreferences)
 * and BundleFiles (app-private files), and points the web view at an unpacked bundle.
 * It makes no release decisions and verifies no signatures: the TypeScript core does both.
 */
@CapacitorPlugin(name = "Shipvo")
public class ShipvoPlugin extends Plugin {
    private static final String PREFS = "shipvo";
    // An instance field: a Plugin lives as long as its Bridge, and the web view's base path belongs to the Bridge.
    // A new Bridge (Activity recreated in the same process) starts on the embedded assets, so it must boot again.
    private volatile String serving;
    private volatile String servingPath;
    private BundleStore store;

    private BundleStore store() {
        if (store == null) store = new BundleStore(getContext().getFilesDir());
        return store;
    }

    private SharedPreferences prefs() { return getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE); }

    @PluginMethod
    public void kvGet(PluginCall call) {
        String key = call.getString("key");
        JSObject r = new JSObject();
        if (key != null && prefs().contains(key)) r.put("value", prefs().getString(key, null));
        call.resolve(r);
    }

    @PluginMethod
    public void kvSet(PluginCall call) {
        String key = call.getString("key"), value = call.getString("value");
        if (key == null || value == null) { call.reject("key and value are required"); return; }
        // commit(), not apply(): the boot counter must be on disk before the page runs.
        if (!prefs().edit().putString(key, value).commit()) { call.reject("could not save"); return; }
        call.resolve();
    }

    @PluginMethod
    public void fileWrite(PluginCall call) {
        try {
            store().write(call.getString("name"), Base64.decode(call.getString("data", ""), Base64.NO_WRAP));
            call.resolve();
        } catch (Exception e) { call.reject(e.getMessage()); }
    }

    @PluginMethod
    public void fileRead(PluginCall call) {
        try {
            JSObject r = new JSObject();
            r.put("data", Base64.encodeToString(store().read(call.getString("name")), Base64.NO_WRAP));
            call.resolve(r);
        } catch (Exception e) { call.reject(e.getMessage()); }
    }

    @PluginMethod
    public void fileRemove(PluginCall call) {
        try { store().remove(call.getString("name")); call.resolve(); } catch (Exception e) { call.reject(e.getMessage()); }
    }

    @PluginMethod
    public void fileList(PluginCall call) {
        JSObject r = new JSObject();
        r.put("names", new JSArray(store().list()));
        call.resolve(r);
    }

    @PluginMethod
    public void fileClear(PluginCall call) {
        store().clear(); serving = null; servingPath = null; call.resolve();
    }

    /** Serve a stored bundle. `sha256` is the hash the core verified; it is checked again before unpacking. */
    @PluginMethod
    public void serve(PluginCall call) {
        try {
            String name = call.getString("name");
            File dir = store().unpack(name, call.getString("sha256"));
            getBridge().setServerBasePath(dir.getAbsolutePath());
            serving = name;
            servingPath = dir.getAbsolutePath();
            call.resolve();
        } catch (Exception e) { call.reject(e.getMessage()); }
    }

    /** Which bundle this process is already serving, so the page it loads does not boot again. */
    @PluginMethod
    public void status(PluginCall call) {
        JSObject r = new JSObject();
        // Report serving only while this Bridge still points at the unpacked directory.
        if (serving != null && servingPath != null && servingPath.equals(getBridge().getServerBasePath())) r.put("serving", serving);
        call.resolve(r);
    }
}
