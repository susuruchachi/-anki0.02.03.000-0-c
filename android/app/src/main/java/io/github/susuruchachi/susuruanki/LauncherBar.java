package io.github.susuruchachi.susuruanki;

// ★【0.04.53】 画面の上の細いバー：左に「▦ すするアプリ」（ランチャーに戻る）、右にほかの2つのアプリ（すぐ切りかえ）
// iOS のすするアプリの上のバーと同じ形。ページ（WebView）はバーの下に出る
//  ・すするアプリ（io.github.susuruchachi.susurulauncher）が入っていなければ、「▦ すするアプリ」で入れるか聞く（LauncherInstaller）
//  ・ほかのアプリは、入っているものだけ出す（開くたびに見直す）
// すするanki・航海日誌・すする帳簿のアプリに、同じものが入っている（package と SELF の行だけちがう）

import android.app.Activity;
import android.content.Intent;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.net.Uri;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.LinearLayout;
import android.widget.TextView;

public class LauncherBar {
    static final String SELF = "anki";
    private static final String[][] APPS = {
        { "anki", "io.github.susuruchachi.susuruanki", "📚 すするanki" },
        { "koukai", "io.github.susuruchachi.koukainisshi", "⚓ 航海日誌" },
        { "kashikari", "io.github.susuruchachi.kashikari", "💰 すする帳簿" },
    };
    private static final int GOLD = 0xFFE3C384, TEXT = 0xFFEBEBEB, PILL = 0x14FFFFFF, LINE = 0x14FFFFFF;

    private static int dp(Activity a, float v) { return Math.round(TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v, a.getResources().getDisplayMetrics())); }

    private static TextView button(Activity a, String label, int color, boolean bold, boolean pill) {
        TextView t = new TextView(a);
        t.setText(label);
        t.setTextColor(color);
        t.setTextSize(TypedValue.COMPLEX_UNIT_SP, 13);
        t.setSingleLine(true);
        if (bold) t.setTypeface(Typeface.DEFAULT_BOLD);
        t.setGravity(Gravity.CENTER);
        t.setPadding(dp(a, 10), dp(a, 5), dp(a, 10), dp(a, 5));
        if (pill) {
            GradientDrawable g = new GradientDrawable();
            g.setColor(PILL);
            g.setCornerRadius(dp(a, 16));
            t.setBackground(g);
        }
        t.setClickable(true);
        t.setFocusable(true);
        return t;
    }

    // ページ（web）をバーの下に置いた画面（setContentView に渡す）
    static View wrap(Activity a, View web, int bg) {
        LinearLayout root = new LinearLayout(a);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(bg);

        LinearLayout bar = new LinearLayout(a);
        bar.setOrientation(LinearLayout.HORIZONTAL);
        bar.setGravity(Gravity.CENTER_VERTICAL);
        bar.setPadding(dp(a, 6), 0, dp(a, 8), 0);
        bar.setBackgroundColor(bg);
        TextView home = button(a, "▦ すするアプリ", GOLD, true, false);
        home.setContentDescription("すするアプリ（ランチャー）を開く");
        home.setOnClickListener(v -> openLauncher(a));
        bar.addView(home);
        bar.addView(new View(a), new LinearLayout.LayoutParams(0, 1, 1));
        for (String[] x : APPS) {
            if (x[0].equals(SELF)) continue;
            TextView b = button(a, x[2], TEXT, false, true);
            b.setTag(x[1]);
            b.setOnClickListener(v -> openApp(a, x[1]));
            LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
            lp.leftMargin = dp(a, 6);
            bar.addView(b, lp);
        }
        root.addView(bar, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(a, 40)));
        View line = new View(a);
        line.setBackgroundColor(LINE);
        root.addView(line, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 1));
        root.addView(web, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1));

        // 状態バーの下まで描く端末（Android 15 から）では、バーを状態バーの下にずらす。下（ナビゲーションバー）の分はページに渡す
        root.setOnApplyWindowInsetsListener((v, ins) -> {
            v.setPadding(ins.getSystemWindowInsetLeft(), ins.getSystemWindowInsetTop(), ins.getSystemWindowInsetRight(), 0);
            return ins.replaceSystemWindowInsets(0, 0, 0, ins.getSystemWindowInsetBottom());
        });
        root.setTag("susuru-launcher-bar");
        refresh(a, root);
        return root;
    }

    // 入っていないアプリのボタンは出さない（MainActivity の onResume から）
    static void refresh(Activity a) {
        View c = a.findViewById(android.R.id.content);
        View root = c == null ? null : c.findViewWithTag("susuru-launcher-bar");
        if (root != null) refresh(a, root);
    }
    private static void refresh(Activity a, View root) {
        for (String[] x : APPS) {
            View b = root.findViewWithTag(x[1]);
            if (b != null) b.setVisibility(a.getPackageManager().getLaunchIntentForPackage(x[1]) != null ? View.VISIBLE : View.GONE);
        }
    }

    private static void openApp(Activity a, String pkg) {
        Intent i = a.getPackageManager().getLaunchIntentForPackage(pkg);
        if (i == null) { refresh(a); return; }
        try { a.startActivity(i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)); } catch (Exception ignored) {}
    }

    private static void openLauncher(Activity a) {
        if (!LauncherInstaller.installed(a)) { LauncherInstaller.offerNow(a); return; }
        try {
            a.startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse("susurulauncher://home"))
                .setPackage(LauncherInstaller.LAUNCHER).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
        } catch (Exception e) { LauncherInstaller.offerNow(a); }
    }
}
