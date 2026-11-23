package io.github.susuruchachi.susuruanki;

// ★【0.04.44】アラームの時刻になった・通知のボタン（スヌーズ・止める）・端末の再起動やアプリの更新のあと（予約し直す）

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

public class AlarmReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context ctx, Intent in) {
        String a = in.getAction();
        if (a == null) return;
        try {
            if (Alarms.ACT_FIRE.equals(a)) Alarms.fire(ctx, in);
            else if (Alarms.ACT_SNOOZE.equals(a)) Alarms.snooze(ctx, in);
            else if (Alarms.ACT_STOP.equals(a)) Alarms.stopRinging(ctx, null);
            else Alarms.reschedule(ctx); // 再起動・アプリの更新・時刻の変更
        } catch (Exception e) {}
    }
}
