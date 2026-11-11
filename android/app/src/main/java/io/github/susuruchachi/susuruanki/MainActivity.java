package io.github.susuruchachi.susuruanki;

// ★【0.04.03】すするanki の Android アプリ（WebView 版）
// 前の版（Trusted Web Activity）は中で Chrome を使っていたので、Chrome に時間制限があると開けなかった。
// この版は Android の内蔵部品（Android System WebView）でウェブ版を表示する。中身は今までどおり GitHub Pages から読むので、
// ウェブ版を更新すればアプリも自動で新しくなる（APK を入れ直すのは、このファイルなどアプリ本体を変えたときだけ）。
// ・Google ログイン：WebView の中では Google がログインを許さないので、アプリ側（Credential Manager）でログインし、
//   受け取った ID トークンをウェブ版に渡して Firebase にログインする（window.__susuruNativeLogin）
// ・ファイルの選択（CSV・テキストの取り込み）と保存（エクスポート）・戻るボタン・外のリンクも、アプリ側で受け持つ

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.ContentValues;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.CancellationSignal;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;
import android.view.View;
import android.view.Window;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import androidx.core.content.FileProvider;
import androidx.credentials.ClearCredentialStateRequest;
import androidx.credentials.Credential;
import androidx.credentials.CredentialManager;
import androidx.credentials.CredentialManagerCallback;
import androidx.credentials.CustomCredential;
import androidx.credentials.GetCredentialRequest;
import androidx.credentials.GetCredentialResponse;
import androidx.credentials.exceptions.ClearCredentialException;
import androidx.credentials.exceptions.GetCredentialCancellationException;
import androidx.credentials.exceptions.GetCredentialException;

import com.google.android.libraries.identity.googleid.GetSignInWithGoogleOption;
import com.google.android.libraries.identity.googleid.GoogleIdTokenCredential;

import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.concurrent.Executor;
import java.util.concurrent.Executors;

public class MainActivity extends Activity {
    private static final int FILE_CHOOSER = 1001;
    private WebView web;
    private ValueCallback<Uri[]> fileCallback;
    private final Executor bg = Executors.newSingleThreadExecutor();

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        Window w = getWindow();
        w.setStatusBarColor(Color.parseColor("#080C14"));
        w.setNavigationBarColor(Color.parseColor("#080C14"));

        web = new WebView(this);
        web.setBackgroundColor(Color.parseColor("#080C14"));
        setContentView(web);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(true);
        s.setSupportMultipleWindows(false);
        s.setJavaScriptCanOpenWindowsAutomatically(true);
        s.setUserAgentString(s.getUserAgentString() + " SusuruAnkiApp/" + BuildConfig.VERSION_NAME);
        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(web, true);

        web.addJavascriptInterface(new Bridge(), "SusuruApp");
        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest req) {
                Uri u = req.getUrl();
                if (isOwnPage(u)) return false;
                // ★【0.04.12】外のページ（チャットのリンクなど）は、アプリの中のブラウザで開く（Chrome に時間制限があっても見られるように）
                openInApp(u);
                return true;
            }
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView v, ValueCallback<Uri[]> cb, FileChooserParams p) {
                if (fileCallback != null) fileCallback.onReceiveValue(null);
                fileCallback = cb;
                Intent i = new Intent(Intent.ACTION_GET_CONTENT);
                i.addCategory(Intent.CATEGORY_OPENABLE);
                i.setType("*/*");
                i.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, p.getMode() == FileChooserParams.MODE_OPEN_MULTIPLE);
                try { startActivityForResult(Intent.createChooser(i, "ファイルを選ぶ"), FILE_CHOOSER); }
                catch (ActivityNotFoundException e) { fileCallback = null; return false; }
                return true;
            }
        });

        if (savedInstanceState != null) web.restoreState(savedInstanceState);
        else web.loadUrl(startUrl(getIntent()));
    }

    private boolean isOwnPage(Uri u) {
        String path = u.getPath() == null ? "" : u.getPath();
        return "https".equals(u.getScheme()) && getString(R.string.hostName).equals(u.getHost()) && path.startsWith(getString(R.string.pathPrefix));
    }

    private String startUrl(Intent intent) {
        Uri d = intent != null ? intent.getData() : null;
        if (d != null && isOwnPage(d)) return d.toString();
        return getString(R.string.launchUrl);
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        Uri d = intent.getData();
        if (d != null && isOwnPage(d)) web.loadUrl(d.toString());
    }

    @Override
    protected void onSaveInstanceState(Bundle out) { super.onSaveInstanceState(out); web.saveState(out); }

    @Override
    protected void onActivityResult(int req, int res, Intent data) {
        super.onActivityResult(req, res, data);
        if (req != FILE_CHOOSER || fileCallback == null) return;
        Uri[] result = null;
        if (res == RESULT_OK && data != null) {
            if (data.getClipData() != null) {
                int n = data.getClipData().getItemCount();
                result = new Uri[n];
                for (int k = 0; k < n; k++) result[k] = data.getClipData().getItemAt(k).getUri();
            } else if (data.getData() != null) result = new Uri[]{ data.getData() };
        }
        fileCallback.onReceiveValue(result);
        fileCallback = null;
    }

    // 戻るボタン：開いている画面・ダイアログをウェブ版で閉じる。閉じるものが無ければアプリを裏に回す
    @Override
    public void onBackPressed() {
        web.evaluateJavascript("(function(){try{return !!(window.susuruAppBack&&window.susuruAppBack());}catch(e){return false;}})()", v -> {
            if (!"true".equals(v)) moveTaskToBack(true);
        });
    }

    @Override
    protected void onPause() { super.onPause(); CookieManager.getInstance().flush(); }

    private void openInApp(Uri u) {
        String sc = u.getScheme();
        if ("http".equals(sc) || "https".equals(sc)) {
            startActivity(new Intent(this, BrowserActivity.class).putExtra(BrowserActivity.EXTRA_URL, u.toString()));
            return;
        }
        try { startActivity(new Intent(Intent.ACTION_VIEW, u)); } catch (ActivityNotFoundException e) { toast("開けるアプリがありません"); }
    }

    private void toast(String m) { runOnUiThread(() -> Toast.makeText(this, m, Toast.LENGTH_SHORT).show()); }

    private void sendLogin(String token, String err) {
        String js = "window.__susuruNativeLogin&&window.__susuruNativeLogin(" + JSONObject.quote(token == null ? "" : token) + "," + JSONObject.quote(err == null ? "" : err) + ")";
        runOnUiThread(() -> web.evaluateJavascript(js, null));
    }

    // ---------------- ウェブ版から呼ぶ ----------------
    private class Bridge {
        @JavascriptInterface public String version() { return BuildConfig.VERSION_NAME; }
        @JavascriptInterface public int versionCode() { return BuildConfig.VERSION_CODE; }
        // このアプリの署名の SHA-1（Firebase に登録したものと同じか確かめる）
        @JavascriptInterface public String signatureSha1() {
            try {
                android.content.pm.PackageInfo pi = Build.VERSION.SDK_INT >= 28
                    ? getPackageManager().getPackageInfo(getPackageName(), android.content.pm.PackageManager.GET_SIGNING_CERTIFICATES)
                    : getPackageManager().getPackageInfo(getPackageName(), android.content.pm.PackageManager.GET_SIGNATURES);
                android.content.pm.Signature[] sigs = Build.VERSION.SDK_INT >= 28 ? pi.signingInfo.getApkContentsSigners() : pi.signatures;
                byte[] d = java.security.MessageDigest.getInstance("SHA-1").digest(sigs[0].toByteArray());
                StringBuilder sb = new StringBuilder();
                for (int k = 0; k < d.length; k++) { if (k > 0) sb.append(':'); sb.append(String.format("%02X", d[k])); }
                return sb.toString();
            } catch (Exception e) { return ""; }
        }

        // Google でログイン（結果は window.__susuruNativeLogin(idToken, error) で返す）
        @JavascriptInterface public void signInWithGoogle() {
            runOnUiThread(() -> {
                try {
                    GetSignInWithGoogleOption opt = new GetSignInWithGoogleOption.Builder(getString(R.string.webClientId)).build();
                    GetCredentialRequest req = new GetCredentialRequest.Builder().addCredentialOption(opt).build();
                    CredentialManager.create(MainActivity.this).getCredentialAsync(MainActivity.this, req, new CancellationSignal(), bg,
                        new CredentialManagerCallback<GetCredentialResponse, GetCredentialException>() {
                            @Override public void onResult(GetCredentialResponse r) {
                                Credential c = r.getCredential();
                                if (c instanceof CustomCredential && GoogleIdTokenCredential.TYPE_GOOGLE_ID_TOKEN_CREDENTIAL.equals(c.getType())) {
                                    try { sendLogin(GoogleIdTokenCredential.createFrom(c.getData()).getIdToken(), null); }
                                    catch (Exception e) { sendLogin(null, "Google の答えを読めませんでした"); }
                                } else sendLogin(null, "Google 以外のログインには対応していません");
                            }
                            @Override public void onError(GetCredentialException e) {
                                // ★ アカウントを選んだあとに Google に断られたとき（Firebase に Android アプリ・SHA-1 が無いなど）も「キャンセル」で返ってくるので、中身も渡す
                                sendLogin(null, (e instanceof GetCredentialCancellationException ? "cancel|" : "error|") + e.getClass().getSimpleName() + "|" + e.getType() + "|" + e.getMessage());
                            }
                        });
                } catch (Exception e) { sendLogin(null, "error|" + e.getClass().getSimpleName() + "||" + e.getMessage()); }
            });
        }

        // ログアウトのとき：次のログインでアカウントを選び直せるように
        @JavascriptInterface public void signOutGoogle() {
            runOnUiThread(() -> CredentialManager.create(MainActivity.this).clearCredentialStateAsync(new ClearCredentialStateRequest(), new CancellationSignal(), bg,
                new CredentialManagerCallback<Void, ClearCredentialException>() {
                    @Override public void onResult(Void v) {}
                    @Override public void onError(ClearCredentialException e) {}
                }));
        }

        // ファイルを「ダウンロード」フォルダーに保存する（エクスポート）。保存できたら true
        @JavascriptInterface public boolean saveFile(String name, String mime, String base64) {
            try {
                byte[] bytes = Base64.decode(base64, Base64.DEFAULT);
                String safe = name.replaceAll("[\\\\/:*?\"<>|]", "_");
                if (Build.VERSION.SDK_INT >= 29) {
                    ContentValues cv = new ContentValues();
                    cv.put(MediaStore.Downloads.DISPLAY_NAME, safe);
                    cv.put(MediaStore.Downloads.MIME_TYPE, mime == null || mime.isEmpty() ? "application/octet-stream" : mime);
                    Uri uri = getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, cv);
                    if (uri == null) return false;
                    try (OutputStream os = getContentResolver().openOutputStream(uri)) { os.write(bytes); }
                } else {
                    File dir = getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS);
                    if (dir == null) return false;
                    try (FileOutputStream os = new FileOutputStream(new File(dir, safe))) { os.write(bytes); }
                }
                toast("「ダウンロード」に保存しました：" + safe);
                return true;
            } catch (Exception e) { toast("保存できませんでした"); return false; }
        }

        // ★ 新しい APK をダウンロードして、上書きインストールの画面を出す（同じ署名鍵なので、アンインストールは要らない）
        //   url はこのアプリのページ（GitHub Pages）の中の APK だけ
        @JavascriptInterface public void installApk(String url) {
            Uri u = Uri.parse(url);
            if (!isOwnPage(u)) return;
            toast("新しいアプリをダウンロードしています…");
            bg.execute(() -> {
                try {
                    File dir = new File(getCacheDir(), "apk"); dir.mkdirs();
                    File f = new File(dir, "susuruanki.apk");
                    HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
                    c.setConnectTimeout(20000); c.setReadTimeout(60000);
                    try (InputStream in = c.getInputStream(); FileOutputStream out = new FileOutputStream(f)) {
                        byte[] buf = new byte[65536]; int n;
                        while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
                    } finally { c.disconnect(); }
                    Uri fu = FileProvider.getUriForFile(MainActivity.this, getPackageName() + ".fileprovider", f);
                    Intent i = new Intent(Intent.ACTION_VIEW);
                    i.setDataAndType(fu, "application/vnd.android.package-archive");
                    i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
                    runOnUiThread(() -> { try { startActivity(i); } catch (Exception e) { toast("インストールの画面を開けませんでした"); } });
                } catch (Exception e) { toast("ダウンロードできませんでした"); }
            });
        }

        // 外のページを、ほかのアプリ（ブラウザなど）で開く
        @JavascriptInterface public void openInApp(String url) { runOnUiThread(() -> MainActivity.this.openInApp(Uri.parse(url))); }
        @JavascriptInterface public void openExternal(String url) {
            try { startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url))); } catch (Exception e) { toast("開けるアプリがありません"); }
        }
    }
}
