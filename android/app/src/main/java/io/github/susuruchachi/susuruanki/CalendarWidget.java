package io.github.susuruchachi.susuruanki;

// ★【0.04.25】カレンダーのウィジェット：今日の予定（時刻順。終わったものは薄く）と、これからのテスト・期限（あと何日）
// データはアプリが SusuruApp.setWidgetData で渡す（cal：今日から45日ぶんの予定）。日付が変わっても、ここで数え直す

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.graphics.Typeface;
import android.net.Uri;
import android.text.SpannableStringBuilder;
import android.text.Spanned;
import android.text.style.ForegroundColorSpan;
import android.text.style.StyleSpan;
import android.widget.RemoteViews;

import org.json.JSONArray;
import org.json.JSONObject;

import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Calendar;
import java.util.Date;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;

public class CalendarWidget extends AppWidgetProvider {
    private static final String[] DOW = { "日", "月", "火", "水", "木", "金", "土" };

    @Override
    public void onUpdate(Context ctx, AppWidgetManager mgr, int[] ids) { for (int id : ids) render(ctx, mgr, id); StreakWidget.scheduleNext(ctx); }

    static void updateAll(Context ctx) {
        AppWidgetManager mgr = AppWidgetManager.getInstance(ctx);
        int[] ids = mgr.getAppWidgetIds(new ComponentName(ctx, CalendarWidget.class));
        for (int id : ids) render(ctx, mgr, id);
    }

    private static void add(SpannableStringBuilder b, String s, int color, boolean bold) {
        int st = b.length(); b.append(s);
        b.setSpan(new ForegroundColorSpan(color), st, b.length(), Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
        if (bold) b.setSpan(new StyleSpan(Typeface.BOLD), st, b.length(), Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
    }
    private static Date parse(String ds) { try { return new SimpleDateFormat("yyyy-MM-dd", Locale.US).parse(ds); } catch (Exception e) { return null; } }
    private static String md(String ds) {
        Date d = parse(ds); if (d == null) return ds;
        Calendar c = Calendar.getInstance(); c.setTime(d);
        return (c.get(Calendar.MONTH) + 1) + "/" + c.get(Calendar.DAY_OF_MONTH) + "(" + DOW[c.get(Calendar.DAY_OF_WEEK) - 1] + ")";
    }
    private static long daysBetween(String a, String b) {
        Date x = parse(a), y = parse(b); if (x == null || y == null) return 0;
        return Math.round((y.getTime() - x.getTime()) / 86400000.0);
    }
    private static String time(JSONObject x) {
        String s = x.optString("s", ""), t = x.optString("t2", "");
        return s.isEmpty() ? "終日" : s + (t.isEmpty() ? "" : "〜" + t);
    }

    static void render(Context ctx, AppWidgetManager mgr, int id) {
        RemoteViews v = new RemoteViews(ctx.getPackageName(), R.layout.widget_calendar);
        String today = StreakWidget.day(0), tomorrow = StreakWidget.day(1);
        v.setTextViewText(R.id.c_date, "📅 " + md(today));
        try {
            JSONObject d = new JSONObject(ctx.getSharedPreferences(StreakWidget.PREFS, Context.MODE_PRIVATE).getString("data", "{}"));
            JSONArray cal = d.optJSONArray("cal");
            if (cal != null) {
                List<JSONObject> todays = new ArrayList<>(), tmr = new ArrayList<>(), ups = new ArrayList<>();
                for (int i = 0; i < cal.length(); i++) {
                    JSONObject x = cal.getJSONObject(i);
                    String ds = x.optString("d"), e2 = x.optString("e2", "");
                    boolean on = ds.equals(today) || (!e2.isEmpty() && ds.compareTo(today) <= 0 && e2.compareTo(today) >= 0);
                    if (on) todays.add(x);
                    else if (ds.equals(tomorrow)) tmr.add(x);
                    if (ds.compareTo(today) > 0 && !"class".equals(x.optString("k"))) ups.add(x);
                }
                java.util.Comparator<JSONObject> byTime = (a, b) -> (a.optString("s", "").isEmpty() ? "00:00" : a.optString("s")).compareTo(b.optString("s", "").isEmpty() ? "00:00" : b.optString("s"));
                todays.sort(byTime); tmr.sort(byTime);
                String now = new SimpleDateFormat("HH:mm", Locale.US).format(new Date());
                SpannableStringBuilder t = new SpannableStringBuilder();
                for (JSONObject x : todays) {
                    String end = x.optString("t2", "").isEmpty() ? x.optString("s", "") : x.optString("t2");
                    boolean past = !end.isEmpty() && end.compareTo(now) < 0 && x.optString("e2", "").isEmpty();
                    if (t.length() > 0) t.append("\n");
                    add(t, time(x) + " ", past ? 0xFF5E6B82 : 0xFF9AD1FF, false);
                    add(t, x.optString("i") + " " + x.optString("n") + (x.optString("e2", "").isEmpty() ? "" : "（〜" + md(x.optString("e2")) + "）"), past ? 0xFF5E6B82 : 0xFFE8EDF5, !past);
                }
                if (todays.isEmpty()) {
                    add(t, "今日の予定はありません", 0xFF9AA6BC, false);
                    if (!tmr.isEmpty()) {
                        add(t, "\n明日：", 0xFF9AA6BC, false);
                        for (int i = 0; i < Math.min(3, tmr.size()); i++) add(t, (i > 0 ? "・" : "") + (tmr.get(i).optString("s", "").isEmpty() ? "" : tmr.get(i).optString("s") + " ") + tmr.get(i).optString("n"), 0xFFC9D1E0, false);
                    }
                }
                v.setTextViewText(R.id.c_today, t);
                v.setTextViewText(R.id.c_count, todays.isEmpty() ? "" : "今日 " + todays.size() + "件");
                // これから：同じ名前は一番近い1回だけ
                SpannableStringBuilder u = new SpannableStringBuilder();
                Set<String> seen = new HashSet<>();
                int n = 0;
                for (JSONObject x : ups) {
                    String key = x.optString("n") + "|" + x.optString("k");
                    if (seen.contains(key)) continue; seen.add(key);
                    long left = daysBetween(today, x.optString("d"));
                    if (u.length() > 0) u.append("\n");
                    add(u, md(x.optString("d")) + " ", 0xFF9AA6BC, false);
                    add(u, x.optString("i") + " " + x.optString("n"), 0xFFE8EDF5, false);
                    add(u, "  " + (left == 1 ? "明日" : "あと" + left + "日"), left <= 3 ? 0xFFFF5D6C : 0xFFC9D1E0, true);
                    if (++n >= 6) break;
                }
                if (n == 0) add(u, "45日以内にテスト・期限はありません", 0xFF9AA6BC, false);
                v.setTextViewText(R.id.c_up, u);
            }
        } catch (Exception e) { /* データがまだ無いときは、はじめの表示のまま */ }
        Intent i = new Intent(ctx, MainActivity.class);
        i.setAction(Intent.ACTION_VIEW);
        i.setData(Uri.parse("https://" + ctx.getString(R.string.hostName) + ctx.getString(R.string.pathPrefix) + "?page=pgCalendar"));
        i.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        v.setOnClickPendingIntent(R.id.c_root, PendingIntent.getActivity(ctx, 5, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE));
        mgr.updateAppWidget(id, v);
    }
}
