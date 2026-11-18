package io.github.susuruchachi.susuruanki;

// ★【0.04.24】アプリの自動更新
// ・新しい APK を裏でダウンロードしておき、Android の PackageInstaller（セッション）で入れる
// ・このアプリ自身が「このアプリを入れたアプリ」になっていれば（＝一度この仕組みで更新したあと）、Android 12 以上では確認なしで入れられる
//   → アプリを閉じて（裏に回して）1分たって、プレイ中でなければ入れ替える。次に開いたときには新しい版
// ・まだ確認なしにできないとき（初めて・Android 11 以前）は、アプリを開いているときに確認を出して入れる（その1回で、次から確認なしになる）

import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.pm.InstallSourceInfo;
import android.content.pm.PackageInfo;
import android.content.pm.PackageInstaller;
import android.content.pm.PackageManager;
import android.os.Build;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;

public class ApkUpdater {
    static final String ACTION_RESULT = "io.github.susuruchachi.susuruanki.APK_INSTALL_RESULT";
    static volatile boolean installing = false;
    static volatile int visible = 0; // 見えているこのアプリの画面の数（アプリの中のブラウザも数える）

    static volatile boolean appAlive = false; // アプリの画面（MainActivity）が生きているか（プロセスが作り直されたら false＝プレイ中ではない）
    static final String ACTION_AUTO = "io.github.susuruchachi.susuruanki.APK_AUTO_INSTALL";

    static void onShown(Context ctx) {
        visible++; InstallResultReceiver.foreground = true;
        alarm(ctx, false);
    }
    static void onHidden(Context ctx) {
        visible = Math.max(0, visible - 1);
        InstallResultReceiver.foreground = visible > 0;
        if (visible == 0 && ready(ctx) && canSilent(ctx)) alarm(ctx, true);
    }
    // 1分後に起こしてもらう（on=false で取り消し）
    static void alarm(Context ctx, boolean on) {
        try {
            android.app.AlarmManager am = (android.app.AlarmManager) ctx.getSystemService(Context.ALARM_SERVICE);
            PendingIntent pi = PendingIntent.getBroadcast(ctx, 4, new Intent(ctx, InstallResultReceiver.class).setAction(ACTION_AUTO), PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
            if (am == null) return;
            if (on) am.set(android.app.AlarmManager.RTC_WAKEUP, System.currentTimeMillis() + 60000L, pi); else am.cancel(pi);
        } catch (Exception e) {}
    }
    // 起こされたとき：見えている画面がなく、プレイ中でなければ入れ替える
    static boolean autoOk(Context ctx) {
        return visible == 0 && (!appAlive || MainActivity.jsIdle) && ready(ctx) && canSilent(ctx);
    }

    static File apkFile(Context ctx) { File d = new File(ctx.getCacheDir(), "apk"); d.mkdirs(); return new File(d, "susuruanki.apk"); }

    // ダウンロード済みの APK の versionCode（無い・壊れていれば 0）
    static long readyVersion(Context ctx) {
        File f = apkFile(ctx);
        if (!f.exists()) return 0;
        try {
            PackageInfo pi = ctx.getPackageManager().getPackageArchiveInfo(f.getAbsolutePath(), 0);
            if (pi == null || !ctx.getPackageName().equals(pi.packageName)) return 0;
            return Build.VERSION.SDK_INT >= 28 ? pi.getLongVersionCode() : pi.versionCode;
        } catch (Exception e) { return 0; }
    }
    static long myVersion() { return BuildConfig.VERSION_CODE; }
    static boolean ready(Context ctx) { return readyVersion(ctx) > myVersion(); }

    // ダウンロード（同じ版がもうあれば何もしない）。失敗したら false
    static boolean download(Context ctx, String url, long wantCode) {
        if (wantCode > 0 && readyVersion(ctx) >= wantCode) return true;
        File tmp = new File(apkFile(ctx).getParentFile(), "download.tmp");
        try {
            HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
            c.setConnectTimeout(20000); c.setReadTimeout(60000);
            try (InputStream in = c.getInputStream(); FileOutputStream out = new FileOutputStream(tmp)) {
                byte[] buf = new byte[65536]; int n;
                while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
            } finally { c.disconnect(); }
            File f = apkFile(ctx);
            if (f.exists()) f.delete();
            if (!tmp.renameTo(f)) return false;
            return ready(ctx);
        } catch (Exception e) { tmp.delete(); return false; }
    }

    // 確認なしで入れられるか（Android 12 以上で、このアプリを入れたのがこのアプリ自身・提供元の許可あり）
    static boolean canSilent(Context ctx) {
        if (Build.VERSION.SDK_INT < 31) return false;
        try {
            if (!ctx.getPackageManager().canRequestPackageInstalls()) return false;
            InstallSourceInfo s = ctx.getPackageManager().getInstallSourceInfo(ctx.getPackageName());
            String me = ctx.getPackageName();
            if (Build.VERSION.SDK_INT >= 34 && me.equals(s.getUpdateOwnerPackageName())) return true;
            return me.equals(s.getInstallingPackageName());
        } catch (Exception e) { return false; }
    }

    // セッションで入れる。確認が要るときは、結果の受け取り（InstallResultReceiver）が確認の画面を開く
    static boolean install(Context ctx) {
        if (installing || !ready(ctx)) return false;
        installing = true;
        PackageInstaller pi = ctx.getPackageManager().getPackageInstaller();
        try {
            PackageInstaller.SessionParams p = new PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL);
            p.setAppPackageName(ctx.getPackageName());
            if (Build.VERSION.SDK_INT >= 31) p.setRequireUserAction(PackageInstaller.SessionParams.USER_ACTION_NOT_REQUIRED);
            if (Build.VERSION.SDK_INT >= 34) p.setRequestUpdateOwnership(true);
            File f = apkFile(ctx);
            int id = pi.createSession(p);
            try (PackageInstaller.Session s = pi.openSession(id)) {
                try (InputStream in = new FileInputStream(f); OutputStream out = s.openWrite("base.apk", 0, f.length())) {
                    byte[] buf = new byte[65536]; int n;
                    while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
                    s.fsync(out);
                }
                Intent i = new Intent(ctx, InstallResultReceiver.class).setAction(ACTION_RESULT);
                int flags = PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= 31 ? PendingIntent.FLAG_MUTABLE : 0);
                s.commit(PendingIntent.getBroadcast(ctx, 3, i, flags).getIntentSender());
            }
            return true;
        } catch (Exception e) { installing = false; return false; }
    }
}
