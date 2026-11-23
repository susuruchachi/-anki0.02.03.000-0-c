// ★【0.04.50】航海日誌の通知（ふつうの通知。UNUserNotificationCenter）
// iOS ではその時刻にアプリを動かせないので、航海日誌のページがウィジェットに渡したデータ（SharedStore.koukaiData の days・diary）から、
// これから14日の通知を先に全部入れておく（データが変わるたび・アプリに戻るたびに入れ直す）。設定はランチャーの画面で
//  ・予定の前：時刻のある予定の「何分前」（何日か続く予定ははじめの日だけ）
//  ・終日の予定：その日の朝（決めた時刻）に、その日の終日の予定をまとめて
//  ・できた事日記：決めた時刻になってもその日まだ書いていなければ（書いたら、ページがデータを渡し直すので消える）
// 押すと、ランチャーの中の航海日誌でその日（日記の欄）を開く

import Foundation
import UIKit
import UserNotifications

@MainActor
final class KoukaiNotifier {
    static let shared = KoukaiNotifier()
    static let prefix = "koukai."

    struct Prefs: Codable, Equatable {
        var events = false   // 予定の前
        var before = 10      // 何分前
        var allDay = false   // 終日の予定をその日の朝に
        var allDayH = 7, allDayM = 0
        var diary = false    // できた事日記をまだ書いていない日に
        var diaryH = 21, diaryM = 0
        var anyOn: Bool { events || allDay || diary }
    }

    private let key = "koukai_notify_prefs"
    var prefs: Prefs {
        get { UserDefaults.standard.data(forKey: key).flatMap { try? JSONDecoder().decode(Prefs.self, from: $0) } ?? Prefs() }
        set { if let d = try? JSONEncoder().encode(newValue) { UserDefaults.standard.set(d, forKey: key) }; dataChanged() }
    }

    private var pending: Task<Void, Never>?
    // 続けて何回も来るので、少し待ってから1回だけ入れ直す
    func dataChanged() {
        pending?.cancel()
        pending = Task { [weak self] in
            try? await Task.sleep(nanoseconds: 700_000_000)
            if Task.isCancelled { return }
            await self?.reschedule()
        }
    }

    func authStatus() async -> UNAuthorizationStatus { await UNUserNotificationCenter.current().notificationSettings().authorizationStatus }
    func requestAuth() async -> Bool {
        if await authStatus() == .authorized { return true }
        return (try? await UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge])) ?? false
    }

    func test() async {
        guard await requestAuth() else { return }
        let c = UNMutableNotificationContent()
        c.title = "⚓ 航海日誌の通知のテスト"
        c.body = "予定の前やできた事日記の通知は、このように届きます"
        c.sound = .default
        c.userInfo = ["open": "susuruanki://open?app=koukai&view=today"]
        try? await UNUserNotificationCenter.current().add(UNNotificationRequest(identifier: "test.\(UUID().uuidString)", content: c, trigger: UNTimeIntervalNotificationTrigger(timeInterval: 5, repeats: false)))
    }

    struct Item { let id: String; let at: Date; let title: String; let body: String; let open: String }

    func reschedule() async {
        let c = UNUserNotificationCenter.current()
        let p = prefs
        let items = p.anyOn ? Self.plan(p, SharedStore.koukaiData(), Date()) : []
        let bg = UIApplication.shared.beginBackgroundTask(withName: "koukai-notify") {}
        defer { if bg != .invalid { UIApplication.shared.endBackgroundTask(bg) } }
        // 要らなくなった分だけ消す（同じ id で入れると入れかわるので、残す分はそのまま入れ直す）
        let want = Set(items.map(\.id))
        let old = await c.pendingNotificationRequests().map(\.identifier).filter { $0.hasPrefix(Self.prefix) && !want.contains($0) }
        if !old.isEmpty { c.removePendingNotificationRequests(withIdentifiers: old) }
        guard !items.isEmpty, [.authorized, .provisional, .ephemeral].contains(await authStatus()) else { return }
        for it in items {
            let ct = UNMutableNotificationContent()
            ct.title = it.title
            ct.body = it.body
            ct.sound = .default
            ct.threadIdentifier = "koukai"
            ct.userInfo = ["open": it.open]
            let dc = Calendar.current.dateComponents([.year, .month, .day, .hour, .minute], from: it.at)
            try? await c.add(UNNotificationRequest(identifier: it.id, content: ct, trigger: UNCalendarNotificationTrigger(dateMatching: dc, repeats: false)))
        }
    }

    // ---------------- 入れる通知を決める ----------------
    private static func fmt(_ d: Date, _ f: String) -> String { let x = DateFormatter(); x.locale = Locale(identifier: "en_US_POSIX"); x.dateFormat = f; return x.string(from: d) }
    private static func at(_ ds: String, _ hm: String) -> Date? { let x = DateFormatter(); x.locale = Locale(identifier: "en_US_POSIX"); x.dateFormat = "yyyy-MM-dd HH:mm"; return x.date(from: ds + " " + hm) }
    private static func hm(_ h: Int, _ m: Int) -> String { String(format: "%02d:%02d", h, m) }
    private static func str(_ d: [String: Any], _ k: String) -> String { d[k] as? String ?? "" }
    private static func doneCount(_ d: Any?) -> Int {
        guard let items = (d as? [String: Any])?["items"] as? [Any] else { return 0 }
        return items.filter { !($0 is NSNull) && !String(describing: $0).trimmingCharacters(in: .whitespaces).isEmpty }.count
    }

    static func plan(_ p: Prefs, _ k: [String: Any], _ now: Date) -> [Item] {
        let days = k["days"] as? [String: Any] ?? [:]
        let diary = k["diary"] as? [String: Any] ?? [:]
        let cal = Calendar.current
        let soon = now.addingTimeInterval(5)
        func dayKey(_ off: Int) -> String { fmt(cal.date(byAdding: .day, value: off, to: now) ?? now, "yyyy-MM-dd") }
        func events(_ ds: String) -> [[String: Any]] { days[ds] as? [[String: Any]] ?? [] }
        var out: [Item] = []
        for off in 0..<14 {
            let ds = dayKey(off), prev = events(dayKey(off - 1))
            let list = events(ds)
            // 前の日にも同じ名前・同じ時刻のものがあれば、何日か続く予定の2日目から（はじめの日だけ知らせる）
            func continued(_ x: [String: Any]) -> Bool { prev.contains { str($0, "n") == str(x, "n") && str($0, "s") == str(x, "s") } }
            let open = "susuruanki://open?app=koukai&view=day&date=\(ds)"
            if p.events {
                for x in list where !str(x, "s").isEmpty && !continued(x) {
                    guard let start = at(ds, str(x, "s")) else { continue }
                    let fire = start.addingTimeInterval(TimeInterval(-60 * p.before))
                    if fire <= soon { continue }
                    let icon = str(x, "i"), name = str(x, "n"), e = str(x, "e")
                    out.append(Item(id: "\(Self.prefix)ev.\(ds).\(str(x, "s")).\(name)", at: fire,
                                    title: "⚓ " + (icon.isEmpty ? "" : icon + " ") + name,
                                    body: str(x, "s") + (e.isEmpty ? "" : "〜" + e) + (p.before > 0 ? "（あと\(p.before)分）" : "（今から）"),
                                    open: open))
                }
            }
            if p.allDay, let fire = at(ds, hm(p.allDayH, p.allDayM)), fire > soon {
                let names = list.filter { str($0, "s").isEmpty && !continued($0) }.map { (str($0, "i").isEmpty ? "" : str($0, "i") + " ") + str($0, "n") }
                if !names.isEmpty {
                    out.append(Item(id: "\(Self.prefix)ad.\(ds)", at: fire, title: off == 0 ? "⚓ 今日の予定" : "⚓ \(fmt(fire, "M/d"))の予定",
                                    body: names.prefix(6).joined(separator: "\n") + (names.count > 6 ? "\nほか\(names.count - 6)件" : ""), open: open))
                }
            }
            if p.diary, off < 7, doneCount(diary[ds]) == 0, let fire = at(ds, hm(p.diaryH, p.diaryM)), fire > soon {
                out.append(Item(id: "\(Self.prefix)dy.\(ds)", at: fire, title: "✦ 今日のできた事を書こう",
                                body: "どんなに小さなことでも大丈夫。できた事を3つ書こう ✏️", open: "susuruanki://open?app=koukai&view=diary"))
            }
        }
        // iOS が覚えておける通知は64まで（テストの分などに少し残す）
        return Array(out.sorted { $0.at < $1.at }.prefix(56))
    }
}
