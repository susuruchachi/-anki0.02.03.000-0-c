package io.github.susuruchachi.susuruanki;

// ★【0.04.52】 すするアプリ（Android のランチャー：すするanki・航海日誌・すする帳簿を1つのところから開くアプリ）が
// まだ入っていなければ、開いたときに「入れますか？」と聞いて、入れる（susuru-obenri-tools の launcher-android/）
//  ・「入れる」：APK をダウンロードして、PackageInstaller のセッションで入れる（はじめて入れるアプリなので、Android の確認の画面が出る）。
//    うまくいかなければ、ブラウザで APK のダウンロードを開く
//  ・「あとで」：3日たったらまた聞く　「今後は聞かない」：もう聞かない
// すするanki・航海日誌・すする帳簿のアプリに、同じものが入っている（package の行だけちがう）

import android.app.Activity;
import android.app.AlertDialog;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageInfo;
import android.content.pm.PackageInstaller;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.widget.Toast;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;

public class LauncherInstaller {
    static final String LAUNCHER = "io.github.susuruchachi.susurulauncher";
    static final String APK_URL = "https://susuruchachi.github.io/susuru-obenri-tools/apk/susuru-launcher.apk";
    static final String ACTION_RESULT = "io.github.susuruchachi.susuruanki.LAUNCHER_INSTALL_RESULT";
    private static final String PREFS = "susuru_launcher_offer";
    private static final long AGAIN_MS = 3L * 24 * 3600 * 1000;
    private static boolean shownThisTime = false;
    static volatile boolean foreground = false;

    static boolean installed(Context c) {
        try { c.getPackageManager().getPackageInfo(LAUNCHER, 0); return true; } catch (PackageManager.NameNotFoundException e) { return false; }
    }

    // MainActivity の onResume から
    static void maybeOffer(Activity a) {
        foreground = true;
        if (shownThisTime || installed(a)) return;
        SharedPreferences p = a.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        if (p.getBoolean("never", false) || System.currentTimeMillis() - p.getLong("askedAt", 0) < AGAIN_MS) return;
        shownThisTime = true;
        // 開いてすぐは、ページの読み込み・ほかのお知らせと重なるので少し待つ
        new Handler(Looper.getMainLooper()).postDelayed(() -> {
            if (a.isFinishing() || a.isDestroyed() || !foreground || installed(a)) return;
            p.edit().putLong("askedAt", System.currentTimeMillis()).apply();
            try {
                new AlertDialog.Builder(a)
                    .setTitle("🚀 すするアプリを入れませんか？")
                    .setMessage("すするanki・航海日誌・すする帳簿を、1つのところからすぐ開ける小さなアプリです（ホーム画面のウィジェット・アイコンの長押し付き）。\n\nこのアプリは今まで通りそのまま使えます。")
                    .setPositiveButton("入れる", (d, w) -> start(a))
                    .setNegativeButton("あとで", null)
                    .setNeutralButton("今後は聞かない", (d, w) -> p.edit().putBoolean("never", true).apply())
                    .show();
            } catch (Exception ignored) {}
        }, 3000);
    }

    static void onPause() { foreground = false; }

    private static void start(Activity a) {
        Toast.makeText(a, "すするアプリをダウンロードしています…", Toast.LENGTH_SHORT).show();
        final Context app = a.getApplicationContext();
        new Thread(() -> {
            boolean ok = false;
            try { File f = download(app); ok = f != null && install(app, f); } catch (Exception ignored) {}
            if (!ok) a.runOnUiThread(() -> openInBrowser(a));
        }).start();
    }

    private static void openInBrowser(Context c) {
        try { c.startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(APK_URL)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)); }
        catch (Exception e) { Toast.makeText(c, "すするアプリをダウンロードできませんでした", Toast.LENGTH_LONG).show(); }
    }

    private static File download(Context c) throws Exception {
        File dir = new File(c.getCacheDir(), "launcher"); dir.mkdirs();
        File f = new File(dir, "susuru-launcher.apk");
        HttpURLConnection con = (HttpURLConnection) new URL(APK_URL + "?t=" + System.currentTimeMillis()).openConnection();
        con.setConnectTimeout(15000); con.setReadTimeout(30000); con.setInstanceFollowRedirects(true);
        try {
            if (con.getResponseCode() != 200) return null;
            try (InputStream in = con.getInputStream(); OutputStream out = new FileOutputStream(f)) {
                byte[] buf = new byte[65536]; int n;
                while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
            }
        } finally { con.disconnect(); }
        // ほんとうにすするアプリの APK か
        PackageInfo pi = c.getPackageManager().getPackageArchiveInfo(f.getPath(), 0);
        return pi != null && LAUNCHER.equals(pi.packageName) ? f : null;
    }

    private static boolean install(Context c, File f) throws Exception {
        PackageInstaller pi = c.getPackageManager().getPackageInstaller();
        PackageInstaller.SessionParams p = new PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL);
        p.setAppPackageName(LAUNCHER);
        int id = pi.createSession(p);
        try (PackageInstaller.Session s = pi.openSession(id)) {
            try (InputStream in = new FileInputStream(f); OutputStream out = s.openWrite("base.apk", 0, f.length())) {
                byte[] buf = new byte[65536]; int n;
                while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
                s.fsync(out);
            }
            Intent i = new Intent(c, Result.class).setAction(ACTION_RESULT);
            int flags = PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= 31 ? PendingIntent.FLAG_MUTABLE : 0);
            s.commit(PendingIntent.getBroadcast(c, 7, i, flags).getIntentSender());
        }
        return true;
    }

    // 入れた結果：確認が要るときは確認の画面を開く（AndroidManifest.xml の receiver）
    public static class Result extends BroadcastReceiver {
        @Override
        public void onReceive(Context ctx, Intent intent) {
            int status = intent.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE);
            if (status == PackageInstaller.STATUS_PENDING_USER_ACTION) {
                Intent confirm = intent.getParcelableExtra(Intent.EXTRA_INTENT);
                if (confirm == null) return;
                confirm.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                try { ctx.startActivity(confirm); } catch (Exception e) { openInBrowser(ctx); }
            } else if (status == PackageInstaller.STATUS_SUCCESS) {
                Toast.makeText(ctx, "✅ すするアプリを入れました（ホーム画面のアプリの一覧にあります）", Toast.LENGTH_LONG).show();
            } else if (status != PackageInstaller.STATUS_FAILURE_ABORTED) {
                String msg = intent.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE);
                Toast.makeText(ctx, "すするアプリを入れられませんでした" + (msg != null ? "（" + msg + "）" : ""), Toast.LENGTH_LONG).show();
            }
        }
    }
}
