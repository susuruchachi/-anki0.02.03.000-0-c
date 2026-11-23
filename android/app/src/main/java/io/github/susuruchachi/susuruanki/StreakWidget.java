package io.github.susuruchachi.susuruanki;

// ★【0.04.18】ホーム画面のウィジェット（Duolingo のような連続記録）
// データはアプリ（ウェブ版）が SusuruApp.setWidgetData で渡す。日付が変わったときの「今日まだ」「記録が途切れた」は
// ここで計算するので、アプリを開かなくても正しく変わる（30分ごとに描き直す）

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.widget.RemoteViews;

import org.json.JSONObject;

import java.text.SimpleDateFormat;
import java.util.Calendar;
import java.util.Locale;

public class StreakWidget extends AppWidgetProvider {
    static final String PREFS = "susuru_widget";

    @Override
    public void onUpdate(Context ctx, AppWidgetManager mgr, int[] ids) { for (int id : ids) render(ctx, mgr, id); scheduleNext(ctx); }

    static void updateAll(Context ctx) {
        AppWidgetManager mgr = AppWidgetManager.getInstance(ctx);
        int[] ids = mgr.getAppWidgetIds(new ComponentName(ctx, StreakWidget.class));
        for (int id : ids) render(ctx, mgr, id);
    }

    static String day(int offset) {
        Calendar c = Calendar.getInstance(); c.add(Calendar.DAY_OF_MONTH, offset);
        return new SimpleDateFormat("yyyy-MM-dd", Locale.US).format(c.getTime());
    }

    static String left(long deadline) {
        long ms = deadline - System.currentTimeMillis();
        if (ms <= 0) return "期限を過ぎています";
        long h = ms / 3600000L, d = h / 24;
        return d >= 1 ? ("あと" + d + "日") : ("あと" + h + "時間" + (ms / 60000L % 60) + "分");
    }

    // ★【0.04.19】今日まだ解いていないときの危なさ：0=まだ余裕（18時まで） 1=18〜21時 2=21〜23時 3=最後の1時間
    static int riskLevel() {
        int h = Calendar.getInstance().get(Calendar.HOUR_OF_DAY);
        return h >= 23 ? 3 : h >= 21 ? 2 : h >= 18 ? 1 : 0;
    }
    static long msToMidnight() {
        Calendar c = Calendar.getInstance(); c.add(Calendar.DAY_OF_MONTH, 1);
        c.set(Calendar.HOUR_OF_DAY, 0); c.set(Calendar.MINUTE, 0); c.set(Calendar.SECOND, 0); c.set(Calendar.MILLISECOND, 0);
        return c.getTimeInMillis() - System.currentTimeMillis();
    }
    static String riskText(int streak) {
        long ms = msToMidnight(), h = ms / 3600000L, m = ms / 60000L % 60;
        switch (riskLevel()) {
            case 3: return "🚨 残り" + Math.max(1, ms / 60000L) + "分！今すぐ1問で " + streak + "日連続を守って！";
            case 2: return "🚨 あと" + h + "時間" + m + "分で " + streak + "日の記録が消えます！";
            case 1: return "⚠️ " + streak + "日連続が危ない！今日はあと" + h + "時間";
            default: return "今日まだです！1問解けば " + (streak + 1) + "日連続";
        }
    }
    static boolean atRisk(Context ctx) {
        try {
            JSONObject d = new JSONObject(ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString("data", "{}"));
            return day(-1).equals(d.optString("last", "")) && d.optInt("streak", 0) > 0;
        } catch (Exception e) { return false; }
    }
    // 次に描き直す時刻：危ないときは18時から15分ごと、まだ余裕なら18時、解き終わっていれば日付が変わったら
    static void scheduleNext(Context ctx) {
        try {
            long now = System.currentTimeMillis(), next;
            if (atRisk(ctx)) {
                if (riskLevel() >= 1) next = now + (riskLevel() >= 3 ? 5 : 15) * 60000L;
                else { Calendar c = Calendar.getInstance(); c.set(Calendar.HOUR_OF_DAY, 18); c.set(Calendar.MINUTE, 0); c.set(Calendar.SECOND, 5); next = c.getTimeInMillis(); }
                next = Math.min(next, now + msToMidnight() + 60000L);
            } else next = now + msToMidnight() + 60000L;
            Intent i = new Intent(ctx, StreakWidget.class).setAction(TICK);
            PendingIntent pi = PendingIntent.getBroadcast(ctx, 1, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
            AlarmManager am = (AlarmManager) ctx.getSystemService(Context.ALARM_SERVICE);
            if (am != null) am.set(AlarmManager.RTC, next, pi);
        } catch (Exception e) {}
    }
    static final String TICK = "io.github.susuruchachi.susuruanki.WIDGET_TICK";

    @Override
    public void onReceive(Context ctx, Intent intent) {
        if (TICK.equals(intent.getAction())) { refreshAll(ctx); return; }
        super.onReceive(ctx, intent);
    }

    // 両方のウィジェット（小さい連続記録・大きいランキング）を描き直す
    static void refreshAll(Context ctx) {
        updateAll(ctx);
        BoardWidget.updateAll(ctx);
        CalendarWidget.updateAll(ctx);
        StarWidget.updateAll(ctx); // ★【0.04.43】
        scheduleNext(ctx);
    }

    static void render(Context ctx, AppWidgetManager mgr, int id) {
        RemoteViews v = new RemoteViews(ctx.getPackageName(), R.layout.widget_streak);
        SharedPreferences p = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        String url = null;
        try {
            JSONObject d = new JSONObject(p.getString("data", "{}"));
            String last = d.optString("last", ""), today = day(0), yesterday = day(-1);
            int streak = d.optInt("streak", 0), todayN = today.equals(d.optString("todayDate", "")) ? d.optInt("today", 0) : 0;
            if (today.equals(last)) {
                v.setTextViewText(R.id.w_fire, "🔥"); v.setTextViewText(R.id.w_num, String.valueOf(streak));
                v.setTextColor(R.id.w_num, 0xFFFFB020);
                v.setTextViewText(R.id.w_status, "今日 " + todayN + "問 解きました ✅");
            } else if (yesterday.equals(last) && streak > 0) {
                // ★【0.04.19】夜が近づくほど強く知らせる
                int lv = riskLevel();
                v.setTextViewText(R.id.w_fire, lv >= 2 ? "🚨" : lv == 1 ? "⚠️" : "🕯️"); v.setTextViewText(R.id.w_num, String.valueOf(streak));
                v.setTextColor(R.id.w_num, lv >= 1 ? 0xFFFFFFFF : 0xFFFF6B6B);
                v.setTextViewText(R.id.w_status, riskText(streak));
                if (lv >= 1) v.setInt(R.id.w_root, "setBackgroundResource", lv >= 2 ? R.drawable.widget_bg_danger : R.drawable.widget_bg_warn);
            } else {
                v.setTextViewText(R.id.w_fire, "🕯️"); v.setTextViewText(R.id.w_num, "0");
                v.setTextColor(R.id.w_num, 0xFF9AA6BC);
                v.setTextViewText(R.id.w_status, d.optInt("best", 0) > 0 ? ("記録が途切れました（最長 " + d.optInt("best", 0) + "日）。今日からまた！") : "今日1問解いて記録をはじめよう");
            }
            JSONObject plan = d.optJSONObject("plan");
            if (plan != null && plan.optString("text", "").length() > 0) {
                long dl = plan.optLong("deadline", 0);
                v.setTextViewText(R.id.w_plan, plan.optString("text") + (dl > 0 ? "（" + left(dl) + "）" : ""));
                url = plan.optString("url", null);
            } else v.setTextViewText(R.id.w_plan, d.has("plan") ? "✅ 今週のプランは終わっています" : "");
            String foot = d.optString("foot", "");
            v.setTextViewText(R.id.w_foot, foot.isEmpty() ? "すするanki" : foot);
        } catch (Exception e) { /* データがまだ無いときは、はじめの表示のまま */ }
        Intent i = new Intent(ctx, MainActivity.class);
        if (url != null && !url.isEmpty()) { i.setAction(Intent.ACTION_VIEW); i.setData(Uri.parse(url)); }
        i.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        v.setOnClickPendingIntent(R.id.w_root, PendingIntent.getActivity(ctx, 0, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE));
        mgr.updateAppWidget(id, v);
    }
}
