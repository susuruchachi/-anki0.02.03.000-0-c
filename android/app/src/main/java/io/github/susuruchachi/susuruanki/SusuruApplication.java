package io.github.susuruchachi.susuruanki;

// ★【0.04.27】アプリ全体のはじまり：プッシュ通知（Firebase Cloud Messaging）の準備と、通知のチャンネル
// google-services.json は使わず、build.gradle の値（ウェブ版と同じ Firebase プロジェクト・Android アプリの ID）で Firebase を始める

import android.app.Application;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.os.Build;

import com.google.firebase.FirebaseApp;
import com.google.firebase.FirebaseOptions;

public class SusuruApplication extends Application {
    static final String CHANNEL = "susuru";

    @Override
    public void onCreate() {
        super.onCreate();
        initFirebase(this);
        if (Build.VERSION.SDK_INT >= 26) {
            NotificationChannel ch = new NotificationChannel(CHANNEL, "すするanki のお知らせ", NotificationManager.IMPORTANCE_DEFAULT);
            ch.setDescription("学習の催促・週間プランの課題・フレンドのお知らせ・アップデート");
            NotificationManager nm = getSystemService(NotificationManager.class);
            if (nm != null) nm.createNotificationChannel(ch);
        }
    }

    static boolean pushConfigured(android.content.Context ctx) { return !ctx.getString(R.string.fbAndroidAppId).isEmpty(); }

    static void initFirebase(android.content.Context ctx) {
        try {
            if (!pushConfigured(ctx) || !FirebaseApp.getApps(ctx).isEmpty()) return;
            FirebaseOptions o = new FirebaseOptions.Builder()
                .setApiKey(ctx.getString(R.string.fbApiKey))
                .setApplicationId(ctx.getString(R.string.fbAndroidAppId))
                .setProjectId(ctx.getString(R.string.fbProjectId))
                .setGcmSenderId(ctx.getString(R.string.fbSenderId))
                .build();
            FirebaseApp.initializeApp(ctx, o);
        } catch (Exception e) { /* 設定がまちがっていても、アプリは動くように */ }
    }
}
