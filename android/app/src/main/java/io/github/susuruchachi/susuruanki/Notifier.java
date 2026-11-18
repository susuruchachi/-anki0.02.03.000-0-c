package io.github.susuruchachi.susuruanki;

// ★【0.04.27】通知を出す（プッシュ・テスト通知・アプリからのお知らせで共通）
// 催促・課題・煽り・アップデートは、同じ種類の前の通知と入れかえる（ウェブ版の sw.js と同じ）

import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;

import androidx.core.app.NotificationCompat;

import java.util.Arrays;
import java.util.List;

public class Notifier {
    private static final List<String> REPLACE_KINDS = Arrays.asList("reminder", "plan", "taunt", "update");

    static boolean allowed(Context ctx) {
        if (Build.VERSION.SDK_INT >= 33 && ctx.checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) return false;
        NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
        return nm == null || nm.areNotificationsEnabled();
    }

    // url：「./?page=…」「#friends」のような、すするanki のページの中の場所。外のページは開かない
    static String fullUrl(Context ctx, String url) {
        String base = "https://" + ctx.getString(R.string.hostName) + ctx.getString(R.string.pathPrefix);
        if (url == null || url.isEmpty() || url.equals("./")) return base;
        if (url.startsWith(base)) return url;
        if (url.startsWith("./")) return base + url.substring(2);
        if (url.startsWith("?") || url.startsWith("#")) return base + url;
        return base;
    }

    static void show(Context ctx, String title, String body, String tag, String kind, String url) {
        if (!allowed(ctx)) return;
        if (kind == null) kind = "";
        String key = REPLACE_KINDS.contains(kind) ? kind : (tag == null || tag.isEmpty() ? "susuru" : tag);
        Intent i = new Intent(ctx, MainActivity.class).setAction(Intent.ACTION_VIEW).setData(Uri.parse(fullUrl(ctx, url)));
        i.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent pi = PendingIntent.getActivity(ctx, key.hashCode(), i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        NotificationCompat.Builder b = new NotificationCompat.Builder(ctx, SusuruApplication.CHANNEL)
            .setSmallIcon(R.drawable.ic_stat_notify)
            .setContentTitle(title == null || title.isEmpty() ? "すするanki" : title)
            .setContentText(body == null ? "" : body)
            .setStyle(new NotificationCompat.BigTextStyle().bigText(body == null ? "" : body))
            .setColor(0xFF4F8CFF)
            .setAutoCancel(true)
            .setContentIntent(pi)
            .setPriority(NotificationCompat.PRIORITY_DEFAULT);
        NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
        try { if (nm != null) nm.notify(key, 1, b.build()); } catch (Exception e) {}
    }
}
