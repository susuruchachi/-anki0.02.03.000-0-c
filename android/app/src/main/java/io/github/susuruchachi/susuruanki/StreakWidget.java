package io.github.susuruchachi.susuruanki;

// ★【0.04.18】ホーム画面のウィジェット（Duolingo のような連続記録）
// データはアプリ（ウェブ版）が SusuruApp.setWidgetData で渡す。日付が変わったときの「今日まだ」「記録が途切れた」は
// ここで計算するので、アプリを開かなくても正しく変わる（30分ごとに描き直す）

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
    public void onUpdate(Context ctx, AppWidgetManager mgr, int[] ids) { for (int id : ids) render(ctx, mgr, id); }

    static void updateAll(Context ctx) {
        AppWidgetManager mgr = AppWidgetManager.getInstance(ctx);
        int[] ids = mgr.getAppWidgetIds(new ComponentName(ctx, StreakWidget.class));
        for (int id : ids) render(ctx, mgr, id);
    }

    private static String day(int offset) {
        Calendar c = Calendar.getInstance(); c.add(Calendar.DAY_OF_MONTH, offset);
        return new SimpleDateFormat("yyyy-MM-dd", Locale.US).format(c.getTime());
    }

    private static String left(long deadline) {
        long ms = deadline - System.currentTimeMillis();
        if (ms <= 0) return "期限を過ぎています";
        long h = ms / 3600000L, d = h / 24;
        return d >= 1 ? ("あと" + d + "日") : ("あと" + h + "時間" + (ms / 60000L % 60) + "分");
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
                v.setTextViewText(R.id.w_fire, "🕯️"); v.setTextViewText(R.id.w_num, String.valueOf(streak));
                v.setTextColor(R.id.w_num, 0xFFFF6B6B);
                v.setTextViewText(R.id.w_status, "今日まだです！1問解けば " + (streak + 1) + "日連続");
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
