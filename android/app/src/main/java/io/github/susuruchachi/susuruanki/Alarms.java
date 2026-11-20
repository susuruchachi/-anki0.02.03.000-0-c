package io.github.susuruchachi.susuruanki;

// ★【0.04.44】アラーム（アラームの音で鳴らす）
//  ・連続記録：決めた時刻（夜8時など）になっても今日まだ解いていなければ鳴らす。解くまで、決めた間隔でスヌーズして何度も鳴る（日付が変わるまで）
//  ・予定：カレンダーで「⏰ アラーム」を入れた予定の、何分前かに鳴らす
// 設定はアプリ（ウェブ版）が SusuruApp.setAlarms で渡す。今日解いたかは、ウィジェットのデータ（StreakWidget.PREFS の last）で見る。
// 鳴らし方：アラームの音のチャンネルの通知を、止めるまで音をくり返す形（FLAG_INSISTENT）で出し、画面が消えているときは全画面（AlarmActivity）で出す

import android.app.AlarmManager;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.media.AudioAttributes;
import android.media.RingtoneManager;
import android.net.Uri;
import android.os.Build;

import androidx.core.app.NotificationCompat;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.Calendar;
import java.util.HashSet;
import java.util.Set;

public class Alarms {
    static final String PREFS = "susuru_alarm";
    static final String CHANNEL = "susuru_alarm";
    static final String ACT_FIRE = "io.github.susuruchachi.susuruanki.ALARM_FIRE";
    static final String ACT_SNOOZE = "io.github.susuruchachi.susuruanki.ALARM_SNOOZE";
    static final String ACT_STOP = "io.github.susuruchachi.susuruanki.ALARM_STOP";
    static final String STREAK = "streak";
    static final int NOTIF_ID = 7;

    static SharedPreferences prefs(Context ctx) { return ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE); }
    static JSONObject cfg(Context ctx) { try { return new JSONObject(prefs(ctx).getString("cfg", "{}")); } catch (Exception e) { return new JSONObject(); } }

    static void ensureChannel(Context ctx) {
        if (Build.VERSION.SDK_INT < 26) return;
        NotificationManager nm = ctx.getSystemService(NotificationManager.class);
        if (nm == null || nm.getNotificationChannel(CHANNEL) != null) return;
        NotificationChannel ch = new NotificationChannel(CHANNEL, "すするanki のアラーム", NotificationManager.IMPORTANCE_HIGH);
        ch.setDescription("連続記録が途切れそうなとき・予定の前に、アラームの音で鳴らす");
        Uri snd = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM);
        if (snd == null) snd = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION);
        ch.setSound(snd, new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ALARM).setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build());
        ch.enableVibration(true);
        ch.setVibrationPattern(new long[]{ 0, 800, 400, 800, 400, 800 });
        ch.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
        nm.createNotificationChannel(ch);
    }

    // ---------------- 状態 ----------------
    static boolean canExact(Context ctx) {
        if (Build.VERSION.SDK_INT < 31) return true;
        AlarmManager am = (AlarmManager) ctx.getSystemService(Context.ALARM_SERVICE);
        return am != null && am.canScheduleExactAlarms();
    }
    static boolean canFullScreen(Context ctx) {
        if (Build.VERSION.SDK_INT < 34) return true;
        NotificationManager nm = ctx.getSystemService(NotificationManager.class);
        return nm == null || nm.canUseFullScreenIntent();
    }
    static String status(Context ctx) {
        try {
            JSONObject o = new JSONObject();
            o.put("notif", Notifier.allowed(ctx));
            o.put("exact", canExact(ctx));
            o.put("fullScreen", canFullScreen(ctx));
            boolean chOk = true;
            if (Build.VERSION.SDK_INT >= 26) { ensureChannel(ctx); NotificationManager nm = ctx.getSystemService(NotificationManager.class); NotificationChannel ch = nm == null ? null : nm.getNotificationChannel(CHANNEL); chOk = ch == null || ch.getImportance() != NotificationManager.IMPORTANCE_NONE; }
            o.put("channel", chOk);
            long next = prefs(ctx).getLong("next", 0);
            o.put("next", next);
            o.put("snoozeAt", prefs(ctx).getLong("snoozeAt", 0));
            return o.toString();
        } catch (Exception e) { return "{}"; }
    }

    // ---------------- 連続記録 ----------------
    static JSONObject widget(Context ctx) { try { return new JSONObject(ctx.getSharedPreferences(StreakWidget.PREFS, Context.MODE_PRIVATE).getString("data", "{}")); } catch (Exception e) { return new JSONObject(); } }
    static boolean doneToday(Context ctx) { return StreakWidget.day(0).equals(widget(ctx).optString("last", "")); }
    static long midnight() {
        Calendar c = Calendar.getInstance(); c.add(Calendar.DAY_OF_MONTH, 1);
        c.set(Calendar.HOUR_OF_DAY, 0); c.set(Calendar.MINUTE, 0); c.set(Calendar.SECOND, 0); c.set(Calendar.MILLISECOND, 0);
        return c.getTimeInMillis();
    }
    static long at(int addDays, int h, int m) {
        Calendar c = Calendar.getInstance(); c.add(Calendar.DAY_OF_MONTH, addDays);
        c.set(Calendar.HOUR_OF_DAY, h); c.set(Calendar.MINUTE, m); c.set(Calendar.SECOND, 0); c.set(Calendar.MILLISECOND, 0);
        return c.getTimeInMillis();
    }
    // 次にスヌーズで鳴らす時刻（日付が変わる5分前まで。もう無ければ 0）
    static long snoozeTime(int min) {
        long now = System.currentTimeMillis(), last = midnight() - 5 * 60000L, t = now + Math.max(1, min) * 60000L;
        if (t <= last) return t;
        return now < last - 60000L ? last : 0;
    }
    static long streakNext(Context ctx, JSONObject s) {
        int h = s.optInt("h", 20), m = s.optInt("m", 0);
        long now = System.currentTimeMillis(), today = at(0, h, m), snooze = prefs(ctx).getLong("snoozeAt", 0);
        if (!doneToday(ctx)) {
            if (snooze > now && snooze < midnight()) return snooze;
            if (now < today) return today;
        }
        return at(1, h, m);
    }

    // ---------------- 予約 ----------------
    static PendingIntent firePi(Context ctx, String key, String title, String body, String url, int code) {
        Intent i = new Intent(ctx, AlarmReceiver.class).setAction(ACT_FIRE)
            .putExtra("key", key).putExtra("title", title).putExtra("body", body).putExtra("url", url);
        return PendingIntent.getBroadcast(ctx, code, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }
    static void set(Context ctx, long when, PendingIntent pi) {
        AlarmManager am = (AlarmManager) ctx.getSystemService(Context.ALARM_SERVICE);
        if (am == null) return;
        try {
            if (canExact(ctx)) {
                Intent show = new Intent(ctx, MainActivity.class).setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
                PendingIntent sp = PendingIntent.getActivity(ctx, 9, show, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
                am.setAlarmClock(new AlarmManager.AlarmClockInfo(when, sp), pi);
            } else if (Build.VERSION.SDK_INT >= 23) am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, when, pi);
            else am.set(AlarmManager.RTC_WAKEUP, when, pi);
        } catch (Exception e) {
            try { am.set(AlarmManager.RTC_WAKEUP, when, pi); } catch (Exception e2) {}
        }
    }
    static void cancel(Context ctx, PendingIntent pi) {
        AlarmManager am = (AlarmManager) ctx.getSystemService(Context.ALARM_SERVICE);
        if (am != null) am.cancel(pi);
    }
    static int evCode(String key) { return 1000 + (key.hashCode() & 0x3fffffff) % 900000; }

    // 設定を受け取る（アプリから）
    static void setConfig(Context ctx, String json) {
        prefs(ctx).edit().putString("cfg", json == null ? "{}" : json).apply();
        reschedule(ctx);
    }

    static void reschedule(Context ctx) {
        JSONObject c = cfg(ctx);
        SharedPreferences.Editor ed = prefs(ctx).edit();
        // 連続記録
        JSONObject s = c.optJSONObject("streak");
        PendingIntent sp = firePi(ctx, STREAK, "", "", "", 1);
        if (s != null && s.optBoolean("on", false)) {
            long next = streakNext(ctx, s);
            set(ctx, next, sp);
            ed.putLong("next", next);
        } else { cancel(ctx, sp); ed.putLong("next", 0).putLong("snoozeAt", 0); }
        // 予定（前に予約したもので、もう無いものは取り消す）
        Set<String> old = new HashSet<>(prefs(ctx).getStringSet("evKeys", new HashSet<>())), now = new HashSet<>();
        JSONArray evs = c.optJSONArray("events");
        long t = System.currentTimeMillis();
        if (evs != null) for (int k = 0; k < evs.length() && now.size() < 60; k++) {
            JSONObject e = evs.optJSONObject(k); if (e == null) continue;
            long when = e.optLong("at", 0); String key = e.optString("k", "");
            if (when <= t || key.isEmpty()) continue;
            set(ctx, when, firePi(ctx, key, e.optString("title", "予定"), e.optString("body", ""), e.optString("url", "./?page=pgCalendar"), evCode(key)));
            now.add(key);
        }
        for (String key : old) if (!now.contains(key)) cancel(ctx, firePi(ctx, key, "", "", "", evCode(key)));
        ed.putStringSet("evKeys", now).apply();
    }

    // 今日解いた（ウィジェットのデータが来た）：鳴っている連続記録のアラームを止め、スヌーズをやめる
    static void onWidgetData(Context ctx) {
        if (!doneToday(ctx)) return;
        if (prefs(ctx).getLong("snoozeAt", 0) > 0 || STREAK.equals(prefs(ctx).getString("ringing", ""))) {
            prefs(ctx).edit().putLong("snoozeAt", 0).apply();
            stopRinging(ctx, STREAK);
        }
        JSONObject s = cfg(ctx).optJSONObject("streak");
        if (s != null && s.optBoolean("on", false)) reschedule(ctx);
    }

    // ---------------- 鳴らす ----------------
    static void fire(Context ctx, Intent in) {
        String key = in.getStringExtra("key"); if (key == null) key = "";
        if (STREAK.equals(key)) {
            JSONObject s = cfg(ctx).optJSONObject("streak");
            if (s == null || !s.optBoolean("on", false)) return;
            if (doneToday(ctx)) { prefs(ctx).edit().putLong("snoozeAt", 0).apply(); reschedule(ctx); return; }
            // 止めても・放っておいても、また鳴るように、次のスヌーズを先に予約しておく
            long nx = snoozeTime(s.optInt("snooze", 10));
            prefs(ctx).edit().putLong("snoozeAt", nx).apply();
            reschedule(ctx);
            JSONObject w = widget(ctx);
            int streak = w.optInt("streak", 0);
            boolean alive = StreakWidget.day(-1).equals(w.optString("last", "")) && streak > 0;
            String title = alive ? "🔥 " + streak + "日連続が消えそう！" : "📚 今日の1問がまだです";
            String body = (alive ? "今日まだ解いていません。1問解けば " + (streak + 1) + "日連続！" : "1問だけでも解いて、連続記録をはじめよう。")
                + (nx > 0 ? "\n解くまで " + s.optInt("snooze", 10) + "分ごとに鳴ります" : "");
            ring(ctx, STREAK, title, body, "./?page=pgDrill", s.optInt("snooze", 10));
        } else {
            ring(ctx, key, in.getStringExtra("title"), in.getStringExtra("body"), in.getStringExtra("url"), 5);
        }
    }

    static PendingIntent actionPi(Context ctx, String act, String key, String title, String body, String url, int code) {
        Intent i = new Intent(ctx, AlarmReceiver.class).setAction(act).putExtra("key", key).putExtra("title", title).putExtra("body", body).putExtra("url", url);
        return PendingIntent.getBroadcast(ctx, code, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    static void ring(Context ctx, String key, String title, String body, String url, int snoozeMin) {
        if (title == null || title.isEmpty()) title = "⏰ すするanki";
        if (body == null) body = "";
        if (url == null || url.isEmpty()) url = "./";
        ensureChannel(ctx);
        prefs(ctx).edit().putString("ringing", key).putString("rTitle", title).putString("rBody", body).putString("rUrl", url).putInt("rSnooze", snoozeMin).apply();
        boolean streak = STREAK.equals(key);
        Intent full = new Intent(ctx, AlarmActivity.class).setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_NO_USER_ACTION | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent fullPi = PendingIntent.getActivity(ctx, 11, full, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        NotificationCompat.Builder b = new NotificationCompat.Builder(ctx, CHANNEL)
            .setSmallIcon(R.drawable.ic_stat_notify)
            .setContentTitle(title)
            .setContentText(body)
            .setStyle(new NotificationCompat.BigTextStyle().bigText(body))
            .setColor(0xFFFF6B3D)
            .setCategory(NotificationCompat.CATEGORY_ALARM)
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setOngoing(true)
            .setAutoCancel(false)
            .setTimeoutAfter(3 * 60000L) // 3分鳴っても止めなければ止める（連続記録は、またスヌーズで鳴る）
            .setFullScreenIntent(fullPi, true)
            .setContentIntent(fullPi)
            .addAction(0, streak ? "📚 今やる" : "✅ 止める", streak ? openPi(ctx, url) : actionPi(ctx, ACT_STOP, key, title, body, url, 12))
            .addAction(0, "💤 " + snoozeMin + "分後", actionPi(ctx, ACT_SNOOZE, key, title, body, url, 13));
        if (Build.VERSION.SDK_INT < 26) {
            b.setSound(RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM), android.media.AudioManager.STREAM_ALARM);
            b.setVibrate(new long[]{ 0, 800, 400, 800 });
        }
        Notification n = b.build();
        n.flags |= Notification.FLAG_INSISTENT; // 止めるまで音をくり返す
        NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
        try { if (nm != null) { nm.cancel(NOTIF_ID); nm.notify(NOTIF_ID, n); } } catch (Exception e) {}
    }

    static void stopRinging(Context ctx, String key) {
        String cur = prefs(ctx).getString("ringing", "");
        if (key != null && !key.isEmpty() && !key.equals(cur) && !cur.isEmpty()) return;
        prefs(ctx).edit().remove("ringing").apply();
        NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm != null) nm.cancel(NOTIF_ID);
        AlarmActivity.closeIfOpen();
    }

    // ボタン：スヌーズ（連続記録は、もう予約してある次のスヌーズまで止める）
    static void snooze(Context ctx, Intent in) {
        String key = in.getStringExtra("key"); if (key == null) key = "";
        stopRinging(ctx, null);
        if (STREAK.equals(key)) {
            JSONObject s = cfg(ctx).optJSONObject("streak");
            if (s != null && prefs(ctx).getLong("snoozeAt", 0) <= System.currentTimeMillis()) { long nx = snoozeTime(s.optInt("snooze", 10)); prefs(ctx).edit().putLong("snoozeAt", nx).apply(); }
            reschedule(ctx);
        } else {
            long when = System.currentTimeMillis() + 5 * 60000L;
            set(ctx, when, firePi(ctx, key, in.getStringExtra("title"), in.getStringExtra("body"), in.getStringExtra("url"), evCode("s" + key)));
        }
    }
    // ボタン：今やる（アプリを開く。開いたら音を止める：MainActivity。連続記録のスヌーズは、解くまで残す）
    // 通知のボタンから一度ほかの部品を通してアプリを開くことは Android 12 からできないので、アプリを直接開く
    static Intent openIntent(Context ctx, String url) {
        Intent i = new Intent(ctx, MainActivity.class).setAction(Intent.ACTION_VIEW).setData(Uri.parse(Notifier.fullUrl(ctx, url))).putExtra("stopAlarm", true);
        i.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        return i;
    }
    static PendingIntent openPi(Context ctx, String url) {
        return PendingIntent.getActivity(ctx, 14, openIntent(ctx, url), PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }
}
