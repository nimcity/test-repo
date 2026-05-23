package com.puzzlefighter;

import android.app.Activity;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.view.Window;
import android.view.WindowManager;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

public class MainActivity extends Activity {
    private WebView webView;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        requestWindowFeature(Window.FEATURE_NO_TITLE);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        applyFullscreen();

        webView = new WebView(this);
        setContentView(webView);

        WebSettings s = webView.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setBuiltInZoomControls(false);
        s.setDisplayZoomControls(false);
        s.setLoadWithOverviewMode(true);
        s.setUseWideViewPort(true);
        s.setAllowFileAccessFromFileURLs(true);
        s.setMediaPlaybackRequiresUserGesture(false);

        webView.setWebChromeClient(new WebChromeClient());
        webView.setWebViewClient(new WebViewClient());
        webView.setScrollBarStyle(View.SCROLLBARS_INSIDE_OVERLAY);
        webView.setBackgroundColor(0xFF000000);
        webView.loadUrl("file:///android_asset/www/index.html");
    }

    @SuppressWarnings("deprecation")
    private void applyFullscreen() {
        // Try modern WindowInsetsController (API 30+) via reflection
        if (Build.VERSION.SDK_INT >= 30) {
            try {
                Object ctrl = getWindow().getClass()
                    .getMethod("getInsetsController").invoke(getWindow());
                if (ctrl != null) {
                    // hide statusBars(1) | navigationBars(2) = 3
                    ctrl.getClass().getMethod("hide", int.class).invoke(ctrl, 3);
                    // BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE = 2
                    ctrl.getClass().getMethod("setSystemBarsBehavior", int.class)
                        .invoke(ctrl, 2);
                }
                // setDecorFitsSystemWindows(false) via reflection
                getWindow().getClass()
                    .getMethod("setDecorFitsSystemWindows", boolean.class)
                    .invoke(getWindow(), false);
                // Handle display cutout via reflection (API 28+)
                try {
                    WindowManager.LayoutParams lp = getWindow().getAttributes();
                    lp.getClass().getField("layoutInDisplayCutoutMode").setInt(lp, 1);
                    getWindow().setAttributes(lp);
                } catch (Exception ignored) {}
                return;
            } catch (Exception ignored) {}
        }
        // Fallback: deprecated flags (still work on all Android versions)
        int flags = View.SYSTEM_UI_FLAG_FULLSCREEN
                  | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                  | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                  | View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                  | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                  | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION;
        getWindow().getDecorView().setSystemUiVisibility(flags);
        // Try cutout mode on API 28+ via reflection
        if (Build.VERSION.SDK_INT >= 28) {
            try {
                WindowManager.LayoutParams lp = getWindow().getAttributes();
                lp.getClass().getField("layoutInDisplayCutoutMode").setInt(lp, 1);
                getWindow().setAttributes(lp);
            } catch (Exception ignored) {}
        }
    }

    @Override
    protected void onResume() {
        super.onResume();
        applyFullscreen();
    }

    @Override
    public void onBackPressed() {
        if (webView.canGoBack()) webView.goBack();
        else super.onBackPressed();
    }
}
