// ★【0.04.73】🆕 アップデートのお知らせ（iOS のすするアプリ）
// すするanki のお知らせ（アップデート・催促など）はサーバーからのプッシュ通知だが、iOS のアプリは無料の Apple ID で入れているので
// プッシュ通知（APNs）を受け取れない。そこで iOS の「バックグラウンド更新」（BGAppRefreshTask）を使う：
//  アプリを閉じていても、iOS が決めたとき（ふだん使っていれば数時間おきくらい）にアプリを少し起こすので、
//  そのときにすするanki のサイトの version-info.js・release-notes.js を読んで、新しい版が出ていればふつうの通知を出す
//  ・🆕 すするanki の新しい版（APP_VERSION）：お知らせ（release-notes.js のいちばん上）の題を出す。押すとすするanki
//  ・📲 すするアプリ（この iOS アプリ）の新しい版（IOS_APP_VERSION が入っている版より新しい）：押すとすするanki の設定（.ipa のリンク）
// はじめて確かめたときは、今の版を覚えるだけ（前からある版は知らせない）。設定はランチャーの画面（オン・オフ）

import BackgroundTasks
import Foundation
import UIKit
import UserNotifications

@MainActor
final class UpdateNotifier {
    static let shared = UpdateNotifier()
    static let taskID = "io.github.susuruchachi.susuruanki.refresh" // Info.plist の BGTaskSchedulerPermittedIdentifiers と同じ
    private static let site = "https://susuruchachi.github.io/-anki0.02.03.000-0-c/"
    private let onKey = "update_notify_on", appKey = "update_notified_app", iosKey = "update_notified_ios", checkedKey = "update_checked_at"

    var on: Bool {
        get { UserDefaults.standard.bool(forKey: onKey) }
        set { UserDefaults.standard.set(newValue, forKey: onKey); if newValue { schedule() } }
    }
    var lastChecked: Date? {
        let t = UserDefaults.standard.double(forKey: checkedKey)
        return t > 0 ? Date(timeIntervalSince1970: t) : nil
    }

    // アプリの起動時（didFinishLaunching の中）に一度だけ
    nonisolated static func register() {
        BGTaskScheduler.shared.register(forTaskWithIdentifier: taskID, using: nil) { task in
            guard let task = task as? BGAppRefreshTask else { task.setTaskCompleted(success: false); return }
            let work = Task { @MainActor in
                UpdateNotifier.shared.schedule() // 次の分を先に頼んでおく
                let ok = await UpdateNotifier.shared.check()
                task.setTaskCompleted(success: ok)
            }
            task.expirationHandler = { work.cancel() }
        }
    }

    // 次に起こしてもらう（2時間より後。実際にいつになるかは iOS が決める）
    func schedule() {
        guard on else { BGTaskScheduler.shared.cancel(taskRequestWithIdentifier: Self.taskID); return }
        let r = BGAppRefreshTaskRequest(identifier: Self.taskID)
        r.earliestBeginDate = Date().addingTimeInterval(2 * 3600)
        try? BGTaskScheduler.shared.submit(r)
    }

    // "0.04.67" → [0, 4, 67]
    private static func ver(_ s: String) -> [Int] { s.split(separator: ".").map { Int($0) ?? 0 } }
    static func newer(_ a: String, than b: String) -> Bool {
        let x = ver(a), y = ver(b)
        for i in 0..<max(x.count, y.count) {
            let p = i < x.count ? x[i] : 0, q = i < y.count ? y[i] : 0
            if p != q { return p > q }
        }
        return false
    }
    private static func first(_ pattern: String, in text: String) -> String? {
        guard let re = try? NSRegularExpression(pattern: pattern),
              let m = re.firstMatch(in: text, range: NSRange(text.startIndex..., in: text)), m.numberOfRanges > 1,
              let r = Range(m.range(at: 1), in: text) else { return nil }
        return String(text[r])
    }
    private static func fetch(_ name: String) async -> String? {
        guard let u = URL(string: site + name + "?t=\(Int(Date().timeIntervalSince1970))") else { return nil }
        var req = URLRequest(url: u)
        req.cachePolicy = .reloadIgnoringLocalCacheData
        req.timeoutInterval = 20
        guard let (d, res) = try? await URLSession.shared.data(for: req), (res as? HTTPURLResponse)?.statusCode == 200 else { return nil }
        return String(data: d, encoding: .utf8)
    }

    // 確かめて、新しければ知らせる。うまく読めたら true
    @discardableResult
    func check() async -> Bool {
        guard on, let vi = await Self.fetch("version-info.js") else { return false }
        UserDefaults.standard.set(Date().timeIntervalSince1970, forKey: checkedKey)
        let d = UserDefaults.standard
        let auth = await UNUserNotificationCenter.current().notificationSettings().authorizationStatus
        let canNotify = [.authorized, .provisional, .ephemeral].contains(auth)

        // 🆕 すするanki
        if let app = Self.first(#"const APP_VERSION = "([^"]+)""#, in: vi) {
            let last = d.string(forKey: appKey)
            if let last, Self.newer(app, than: last), canNotify {
                var body = "新しい機能・修正があります。開いてお知らせを見てみましょう"
                if let rn = await Self.fetch("release-notes.js"),
                   Self.first(#"version:\s*'([^']+)'"#, in: rn) == app,
                   let t = Self.first(#"title:\s*'((?:[^'\\]|\\.)*)'"#, in: rn) { body = t.replacingOccurrences(of: "\\'", with: "'") }
                await post(id: "update.app.\(app)", title: "🆕 すするanki v\(app)", body: body, open: "susuruanki://open?app=anki")
            }
            if last == nil || Self.newer(app, than: last ?? "") { d.set(app, forKey: appKey) }
        }
        // 📲 すするアプリ（この iOS アプリ）
        if let ios = Self.first(#"const IOS_APP_VERSION = "([^"]+)""#, in: vi) {
            let mine = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "0"
            let last = d.string(forKey: iosKey) // 前に知らせた版（同じ版は1回だけ知らせる）
            if Self.newer(ios, than: mine), last.map({ Self.newer(ios, than: $0) }) ?? true, canNotify {
                await post(id: "update.ios.\(ios)", title: "📲 すするアプリの新しい版 v\(ios)",
                           body: "すするanki の設定から .ipa をダウンロードして、iloader で入れ直してください（データはそのまま）",
                           open: "susuruanki://open?app=anki&page=pgBackup")
            }
            if Self.newer(ios, than: mine), canNotify { d.set(ios, forKey: iosKey) }
        }
        return true
    }

    private func post(id: String, title: String, body: String, open: String) async {
        let c = UNMutableNotificationContent()
        c.title = title
        c.body = body
        c.sound = .default
        c.threadIdentifier = "update"
        c.userInfo = ["open": open]
        try? await UNUserNotificationCenter.current().add(UNNotificationRequest(identifier: id, content: c, trigger: nil))
    }
}
