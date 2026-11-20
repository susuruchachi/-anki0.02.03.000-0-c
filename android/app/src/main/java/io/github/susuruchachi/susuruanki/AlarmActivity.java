package io.github.susuruchachi.susuruanki;

// ★【0.04.44】アラームが鳴ったときの全画面（画面が消えている・ロックされているとき）
// 音は通知（Alarms.ring）が鳴らしている。ここのボタンで止める・スヌーズする・アプリを開く

import android.app.Activity;
import android.app.KeyguardManager;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.os.Build;
import android.os.Bundle;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.WindowManager;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;

import java.lang.ref.WeakReference;

public class AlarmActivity extends Activity {
    private static WeakReference<AlarmActivity> cur = new WeakReference<>(null);
    static void closeIfOpen() { AlarmActivity a = cur.get(); if (a != null) a.runOnUiThread(a::finish); }

    private int dp(float v) { return (int) TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v, getResources().getDisplayMetrics()); }

    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        cur = new WeakReference<>(this);
        if (Build.VERSION.SDK_INT >= 27) { setShowWhenLocked(true); setTurnScreenOn(true); }
        else getWindow().addFlags(WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED | WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        getWindow().setStatusBarColor(Color.parseColor("#080C14"));
        getWindow().setNavigationBarColor(Color.parseColor("#080C14"));
        build();
    }
    @Override
    protected void onNewIntent(Intent i) { super.onNewIntent(i); build(); }
    @Override
    protected void onDestroy() { if (cur.get() == this) cur = new WeakReference<>(null); super.onDestroy(); }

    private void build() {
        SharedPreferences p = Alarms.prefs(this);
        final String key = p.getString("ringing", "");
        if (key.isEmpty()) { finish(); return; }
        final String title = p.getString("rTitle", "⏰ すするanki"), body = p.getString("rBody", ""), url = p.getString("rUrl", "./");
        final int snooze = p.getInt("rSnooze", 5);
        final boolean streak = Alarms.STREAK.equals(key);

        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setGravity(Gravity.CENTER);
        root.setPadding(dp(28), dp(40), dp(28), dp(40));
        root.setBackgroundColor(Color.parseColor(streak ? "#2A0E0E" : "#0D1626"));

        TextView icon = new TextView(this);
        icon.setText(streak ? "🔥" : "⏰"); icon.setTextSize(72); icon.setGravity(Gravity.CENTER);
        root.addView(icon);
        TextView t = new TextView(this);
        t.setText(title); t.setTextSize(26); t.setTextColor(Color.WHITE); t.setTypeface(Typeface.DEFAULT_BOLD); t.setGravity(Gravity.CENTER);
        t.setPadding(0, dp(12), 0, dp(8));
        root.addView(t);
        TextView d = new TextView(this);
        d.setText(body); d.setTextSize(17); d.setTextColor(Color.parseColor("#C9D3E6")); d.setGravity(Gravity.CENTER);
        root.addView(d);

        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(64));
        lp.topMargin = dp(18);
        Button main = btn(streak ? "📚 今やる" : "✅ 止める", streak ? "#FF6B3D" : "#4F8CFF");
        main.setOnClickListener(v -> {
            if (streak) { unlockThen(() -> { startActivity(Alarms.openIntent(this, url)); Alarms.stopRinging(this, null); finish(); }); }
            else { Alarms.stopRinging(this, null); finish(); }
        });
        Button sn = btn("💤 " + snooze + "分後にもう一度", "#33405A");
        sn.setOnClickListener(v -> {
            Intent i = new Intent(this, AlarmReceiver.class).setAction(Alarms.ACT_SNOOZE).putExtra("key", key).putExtra("title", title).putExtra("body", body).putExtra("url", url);
            sendBroadcast(i);
            finish();
        });
        LinearLayout.LayoutParams lp1 = new LinearLayout.LayoutParams(lp); lp1.topMargin = dp(36);
        root.addView(main, lp1);
        root.addView(sn, lp);
        if (!streak) {
            Button op = btn("📅 アプリで見る", "#1E2A40");
            op.setOnClickListener(v -> unlockThen(() -> { startActivity(Alarms.openIntent(this, url)); Alarms.stopRinging(this, null); finish(); }));
            root.addView(op, lp);
        }
        setContentView(root);
    }

    private Button btn(String text, String color) {
        Button b = new Button(this);
        b.setText(text); b.setTextSize(19); b.setTextColor(Color.WHITE); b.setAllCaps(false);
        GradientDrawable g = new GradientDrawable(); g.setColor(Color.parseColor(color)); g.setCornerRadius(dp(16));
        b.setBackground(g);
        return b;
    }

    // ロックされていたら、ロックを外してもらってから（アプリを開くとき）
    private void unlockThen(Runnable r) {
        KeyguardManager km = (KeyguardManager) getSystemService(Context.KEYGUARD_SERVICE);
        if (Build.VERSION.SDK_INT >= 26 && km != null && km.isKeyguardLocked()) {
            km.requestDismissKeyguard(this, new KeyguardManager.KeyguardDismissCallback() {
                @Override public void onDismissSucceeded() { r.run(); }
            });
        } else r.run();
    }
}
