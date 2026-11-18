package io.github.susuruchachi.susuruanki;

// ★【0.04.19】大きいホーム画面のウィジェット：フレンドとの今週のランキングと、自分の進み具合
// データは StreakWidget と同じ（アプリが SusuruApp.setWidgetData で渡す。ランキングは最後にアプリを開いたときのもの）

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
import java.util.Date;
import java.util.Locale;

public class BoardWidget extends AppWidgetProvider {
    @Override
    public void onUpdate(Context ctx, AppWidgetManager mgr, int[] ids) { for (int id : ids) render(ctx, mgr, id); StreakWidget.scheduleNext(ctx); }

    static void updateAll(Context ctx) {
        AppWidgetManager mgr = AppWidgetManager.getInstance(ctx);
        int[] ids = mgr.getAppWidgetIds(new ComponentName(ctx, BoardWidget.class));
        for (int id : ids) render(ctx, mgr, id);
    }

    private static void add(SpannableStringBuilder b, String s, int color, boolean bold) {
        int st = b.length(); b.append(s);
        b.setSpan(new ForegroundColorSpan(color), st, b.length(), Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
        if (bold) b.setSpan(new StyleSpan(Typeface.BOLD), st, b.length(), Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
    }

    static void render(Context ctx, AppWidgetManager mgr, int id) {
        RemoteViews v = new RemoteViews(ctx.getPackageName(), R.layout.widget_board);
        try {
            JSONObject d = new JSONObject(ctx.getSharedPreferences(StreakWidget.PREFS, Context.MODE_PRIVATE).getString("data", "{}"));
            String today = StreakWidget.day(0), last = d.optString("last", "");
            boolean sameDay = today.equals(d.optString("todayDate", ""));
            int streak = d.optInt("streak", 0), todayN = sameDay ? d.optInt("today", 0) : 0;
            JSONObject b = d.optJSONObject("board");
            if (b == null) b = new JSONObject();

            // ── ランキング
            JSONArray rank = b.optJSONArray("rank");
            SpannableStringBuilder r = new SpannableStringBuilder();
            if (rank == null) add(r, "ログインしてフレンドを追加すると、ここで今週の問題数を競えます", 0xFF9AA6BC, false);
            else {
                String[] medal = { "🥇", "🥈", "🥉" };
                for (int i = 0; i < rank.length(); i++) {
                    JSONObject x = rank.getJSONObject(i);
                    boolean me = x.optBoolean("me");
                    int no = x.optInt("r", i + 1);
                    // 自分の今日・今週の数はウィジェットのデータのほうが新しい
                    int w = x.optInt("w"), t = x.optInt("t");
                    if (me) t = todayN;
                    if (r.length() > 0) r.append("\n");
                    add(r, (no <= 3 ? medal[no - 1] : (no + ". ")) + " ", 0xFFE8EDF5, false);
                    String name = x.optString("n", "");
                    if (name.length() > 9) name = name.substring(0, 9) + "…";
                    add(r, name, me ? 0xFFFFB020 : 0xFFE8EDF5, me);
                    add(r, "  " + w + "問", me ? 0xFFFFB020 : 0xFFC9D1E0, true);
                    add(r, "（今日" + t + "・🔥" + x.optInt("s") + "）", 0xFF7F8BA3, false);
                }
                if (rank.length() <= 1) add(r, "\nフレンドを追加すると一緒に競えます", 0xFF7F8BA3, false);
            }
            v.setTextViewText(R.id.b_rank, r);
            long at = b.optLong("rankAt", 0);
            v.setTextViewText(R.id.b_rank_at, at > 0 ? new SimpleDateFormat("M/d HH:mm", Locale.US).format(new Date(at)) + " 更新" : "");

            // ── 自分の今日の状態（夜は強く知らせる）
            String status;
            int bg = R.drawable.widget_bg;
            if (today.equals(last)) status = "🔥 " + streak + "日連続 ・ 今日 " + todayN + "問 ✅";
            else if (StreakWidget.day(-1).equals(last) && streak > 0) {
                status = StreakWidget.riskText(streak);
                int lv = StreakWidget.riskLevel();
                if (lv >= 1) bg = lv >= 2 ? R.drawable.widget_bg_danger : R.drawable.widget_bg_warn;
            } else status = "🕯️ 記録が途切れました。今日1問からまた始めよう";
            v.setTextViewText(R.id.b_status, status);
            v.setInt(R.id.b_root, "setBackgroundResource", bg);
            v.setTextViewText(R.id.b_week, "📅 今週 " + b.optInt("week", 0) + "問" + (d.optInt("best", 0) > 0 ? " ・ 最長 " + d.optInt("best") + "日" : ""));

            // ── 週間プランの課題
            JSONArray tasks = b.optJSONArray("tasks");
            SpannableStringBuilder t = new SpannableStringBuilder();
            if (tasks != null && tasks.length() > 0) {
                for (int i = 0; i < tasks.length(); i++) {
                    JSONObject x = tasks.getJSONObject(i);
                    if (t.length() > 0) t.append("  ");
                    boolean done = x.optBoolean("done"), wait = x.optBoolean("wait");
                    add(t, (done ? "✅" : wait ? "🔒" : "⬜") + x.optString("t") + (!done && !wait && x.optInt("p") > 0 ? " " + x.optInt("p") + "%" : ""),
                        done ? 0xFF7BD88F : wait ? 0xFF7F8BA3 : 0xFFE8EDF5, !done && !wait);
                }
            } else add(t, "週間プランはまだありません", 0xFF7F8BA3, false);
            v.setTextViewText(R.id.b_tasks, t);
            JSONObject plan = d.optJSONObject("plan");
            long dl = plan != null ? plan.optLong("deadline", 0) : 0;
            v.setTextViewText(R.id.b_plan, plan != null && plan.optString("text", "").length() > 0 ? plan.optString("text") + (dl > 0 ? "（" + StreakWidget.left(dl) + "）" : "") : "");

            // ── 暗記テストの進み具合
            v.setTextViewText(R.id.b_drill, b.optString("drill", "📝 暗記テストはまだ始めていません"));
        } catch (Exception e) { /* データがまだ無いときは、はじめの表示のまま */ }
        Intent i = new Intent(ctx, MainActivity.class);
        i.setAction(Intent.ACTION_VIEW);
        i.setData(Uri.parse("https://" + ctx.getString(R.string.hostName) + ctx.getString(R.string.pathPrefix) + "?page=pgStats"));
        i.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        v.setOnClickPendingIntent(R.id.b_root, PendingIntent.getActivity(ctx, 2, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE));
        mgr.updateAppWidget(id, v);
    }
}
