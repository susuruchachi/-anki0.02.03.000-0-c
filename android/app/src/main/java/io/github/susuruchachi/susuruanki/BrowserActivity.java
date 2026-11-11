package io.github.susuruchachi.susuruanki;

// ★【0.04.12】アプリの中のブラウザ：チャットなどのリンクを、Chrome に飛ばずにアプリの中で開く
// （Chrome に時間制限があっても見られるように）。上の帯：✕ 閉じる・ページの題名・↗ ほかのアプリで開く。戻るボタンで前のページ → 閉じる

import android.app.Activity;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.Typeface;
import android.net.Uri;
import android.os.Bundle;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.TextView;
import android.widget.Toast;

public class BrowserActivity extends Activity {
    public static final String EXTRA_URL = "url";
    private WebView web;
    private TextView title;
    private ProgressBar bar;

    private int dp(int v) { return (int) TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v, getResources().getDisplayMetrics()); }

    private TextView barButton(String text) {
        TextView b = new TextView(this);
        b.setText(text); b.setTextColor(Color.WHITE); b.setTextSize(16); b.setGravity(Gravity.CENTER);
        b.setPadding(dp(14), 0, dp(14), 0);
        b.setLayoutParams(new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.MATCH_PARENT));
        return b;
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().setStatusBarColor(Color.parseColor("#080C14"));
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(Color.parseColor("#080C14"));

        LinearLayout top = new LinearLayout(this);
        top.setOrientation(LinearLayout.HORIZONTAL);
        top.setBackgroundColor(Color.parseColor("#141B2B"));
        top.setLayoutParams(new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(48)));
        TextView close = barButton("✕ 閉じる");
        close.setOnClickListener(v -> finish());
        title = new TextView(this);
        title.setTextColor(Color.parseColor("#E8EDF5")); title.setTextSize(13); title.setSingleLine(true);
        title.setEllipsize(android.text.TextUtils.TruncateAt.END); title.setGravity(Gravity.CENTER_VERTICAL);
        title.setTypeface(Typeface.DEFAULT_BOLD);
        title.setLayoutParams(new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.MATCH_PARENT, 1f));
        TextView ext = barButton("↗");
        ext.setOnClickListener(v -> {
            try { startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(web.getUrl()))); }
            catch (Exception e) { Toast.makeText(this, "開けるアプリがありません", Toast.LENGTH_SHORT).show(); }
        });
        top.addView(close); top.addView(title); top.addView(ext);

        bar = new ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal);
        bar.setLayoutParams(new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(3)));
        bar.setMax(100);

        web = new WebView(this);
        web.setLayoutParams(new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f));
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setLoadWithOverviewMode(true);
        s.setUseWideViewPort(true);
        s.setBuiltInZoomControls(true);
        s.setDisplayZoomControls(false);
        s.setSupportMultipleWindows(false);
        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest req) {
                String scheme = req.getUrl().getScheme();
                if ("http".equals(scheme) || "https".equals(scheme)) return false; // ふつうのページはこの中で開く
                // mailto: や アプリへのリンクなどは、端末のほかのアプリで
                try { startActivity(new Intent(Intent.ACTION_VIEW, req.getUrl())); } catch (Exception e) { Toast.makeText(BrowserActivity.this, "開けるアプリがありません", Toast.LENGTH_SHORT).show(); }
                return true;
            }
            @Override
            public void onPageFinished(WebView view, String url) { if (view.getTitle() != null && !view.getTitle().isEmpty()) title.setText(view.getTitle()); }
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override public void onProgressChanged(WebView view, int p) { bar.setProgress(p); bar.setVisibility(p >= 100 ? View.GONE : View.VISIBLE); }
            @Override public void onReceivedTitle(WebView view, String t) { if (t != null) title.setText(t); }
        });
        root.addView(top); root.addView(bar); root.addView(web);
        setContentView(root);

        String url = getIntent().getStringExtra(EXTRA_URL);
        if (url == null) { finish(); return; }
        title.setText(url);
        if (savedInstanceState != null) web.restoreState(savedInstanceState); else web.loadUrl(url);
    }

    @Override protected void onSaveInstanceState(Bundle out) { super.onSaveInstanceState(out); web.saveState(out); }

    @Override
    public void onBackPressed() { if (web.canGoBack()) web.goBack(); else finish(); }

    @Override protected void onDestroy() { if (web != null) { web.stopLoading(); web.destroy(); } super.onDestroy(); }
}
