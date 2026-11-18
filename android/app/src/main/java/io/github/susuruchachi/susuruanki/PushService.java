package io.github.susuruchachi.susuruanki;

// ★【0.04.27】プッシュ通知を受け取って、Android の通知にする（サーバーはデータだけのメッセージを送る：title・body・tag・kind・url）

import com.google.firebase.messaging.FirebaseMessagingService;
import com.google.firebase.messaging.RemoteMessage;

import java.util.Map;

public class PushService extends FirebaseMessagingService {
    @Override
    public void onMessageReceived(RemoteMessage m) {
        Map<String, String> d = m.getData();
        String title = d.get("title"), body = d.get("body");
        if (m.getNotification() != null) {
            if (title == null) title = m.getNotification().getTitle();
            if (body == null) body = m.getNotification().getBody();
        }
        Notifier.show(this, title, body, d.get("tag"), d.get("kind"), d.get("url"));
    }

    @Override
    public void onNewToken(String token) {
        getSharedPreferences("susuru_push", MODE_PRIVATE).edit().putString("token", token).apply();
    }
}
