package com.marsway.app;

import android.content.ContentResolver;
import android.content.ContentValues;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.OutputStream;

/**
 * "Save to Photos" on the Science stop page. The page can't download files inside the app, so it calls
 * Capacitor.Plugins.MarsWayPhotos.savePhoto({ data: base64, fileName, mimeType }) and the photo is
 * saved to the phone's Pictures/MarsWay album. Nothing is uploaded.
 */
@CapacitorPlugin(name = "MarsWayPhotos")
public class MarsWayPhotosPlugin extends Plugin {

    @PluginMethod
    public void savePhoto(PluginCall call) {
        String data = call.getString("data");
        String fileName = call.getString("fileName", "MarsWay.jpg");
        String mimeType = call.getString("mimeType", "image/jpeg");
        if (data == null || data.isEmpty()) {
            call.reject("No photo to save.");
            return;
        }
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
            call.reject("Saving to Photos needs Android 10 or newer.");
            return;
        }
        try {
            byte[] bytes = Base64.decode(data, Base64.DEFAULT);
            ContentValues values = new ContentValues();
            values.put(MediaStore.Images.Media.DISPLAY_NAME, fileName);
            values.put(MediaStore.Images.Media.MIME_TYPE, mimeType);
            values.put(MediaStore.Images.Media.RELATIVE_PATH, Environment.DIRECTORY_PICTURES + "/MarsWay");
            ContentResolver resolver = getContext().getContentResolver();
            Uri uri = resolver.insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values);
            if (uri == null) {
                call.reject("Could not create the file in Photos.");
                return;
            }
            try (OutputStream out = resolver.openOutputStream(uri)) {
                if (out == null) {
                    call.reject("Could not write the file in Photos.");
                    return;
                }
                out.write(bytes);
            }
            call.resolve();
        } catch (Exception error) {
            call.reject(error.getMessage() == null ? "Saving failed." : error.getMessage());
        }
    }
}
