// ★【0.04.45】⏰ アラーム（AlarmKit・iOS 26 から）
// iOS では、決まった時刻にアプリを動かして「今日解いたか」を確かめられない。そこでページ（app-bridge.js）が、
// 鳴らす時刻の一覧（連続記録は今日まだなら 20:00・20:10…、明日・明後日も同じ。予定の前）を作って渡し、ここで全部入れ直す。
// 今日解いたら、ページがまた一覧を渡す（今日の分が無くなる）ので、今日の残りは鳴らない。
// ★【0.04.46】入れ直すのは変わった分だけ（前は全部消してから入れ直していて、アプリを閉じたときに途中で止められ、消えたままになっていた。
//  「アラームを試す」も消していた）。閉じるあいだも最後まで入れられるように、裏で少し動かしてもらう
// 「止める」でその回だけ止まり、次の回（スヌーズの間隔）でまた鳴る。「今やる」・「開く」でアプリを開く

import AlarmKit
import AppIntents
import Foundation
import SwiftUI
import UIKit

struct SusuruAlarmMeta: AlarmMetadata {}

// アラームの「今やる」：アプリを開く
struct OpenSusuruIntent: LiveActivityIntent {
    static var title: LocalizedStringResource = "すするanki を開く"
    static var openAppWhenRun: Bool = true
    @Parameter(title: "id") var alarmID: String
    init() { alarmID = "" }
    init(alarmID: String) { self.alarmID = alarmID }
    func perform() async throws -> some IntentResult { .result() }
}

@MainActor
final class AlarmScheduler {
    static let shared = AlarmScheduler()
    private let mgr = AlarmManager.shared
    private let mapKey = "susuru_alarm_map2" // 一覧の1つ（時刻・名前）→ 入れたアラームの id

    struct Item: Decodable { let at: Double; let title: String; let k: String?; let open: String? }
    struct Config: Decodable { let items: [Item]; let sig: String? }

    func authText() -> String {
        switch mgr.authorizationState {
        case .authorized: return "authorized"
        case .denied: return "denied"
        case .notDetermined: return "notDetermined"
        @unknown default: return "unknown"
        }
    }

    func requestAuth() async -> Bool {
        if mgr.authorizationState == .authorized { return true }
        do { return try await mgr.requestAuthorization() == .authorized } catch { return false }
    }

    func status() async -> [String: Any] {
        let list = (try? mgr.alarms) ?? []
        return ["ios": true, "auth": authText(), "count": list.count]
    }

    // ページから：鳴らす時刻の一覧を受け取って、変わった分だけ入れ直す
    func apply(json: String) async {
        guard let d = json.data(using: .utf8), let cfg = try? JSONDecoder().decode(Config.self, from: d) else { return }
        let now = Date()
        let items = cfg.items.filter { Date(timeIntervalSince1970: $0.at / 1000) > now.addingTimeInterval(5) }.sorted { $0.at < $1.at }.prefix(60)
        var want: [String: Item] = [:]
        for it in items { want["\(Int64(it.at))|\(it.title)"] = it }
        let existing = Set(((try? mgr.alarms) ?? []).map { $0.id.uuidString })
        let first = UserDefaults.standard.object(forKey: mapKey) == nil
        var map = (UserDefaults.standard.dictionary(forKey: mapKey) as? [String: String]) ?? [:]
        map = map.filter { existing.contains($0.value) } // 鳴り終わった・消えたもの
        let toCancel = map.filter { want[$0.key] == nil }
        let toAdd = want.filter { map[$0.key] == nil }
        if toCancel.isEmpty && toAdd.isEmpty && !first { UserDefaults.standard.set(map, forKey: mapKey); return }
        if !toAdd.isEmpty, !(await requestAuth()) { return }
        let bg = UIApplication.shared.beginBackgroundTask(withName: "susuru-alarms") {}
        defer { if bg != .invalid { UIApplication.shared.endBackgroundTask(bg) } }
        // 前の版で入れたアラーム（どれがどれか分からない）は、はじめに一度だけ消す
        if first { for idStr in existing { if let id = UUID(uuidString: idStr) { try? mgr.cancel(id: id) } } }
        for (k, idStr) in toCancel { if let id = UUID(uuidString: idStr) { try? mgr.cancel(id: id) }; map.removeValue(forKey: k) }
        UserDefaults.standard.set(map, forKey: mapKey)
        for (k, it) in toAdd.sorted(by: { $0.value.at < $1.value.at }) {
            let id = UUID()
            if await schedule(id: id, at: Date(timeIntervalSince1970: it.at / 1000), title: it.title, open: it.open ?? "開く") {
                map[k] = id.uuidString
                UserDefaults.standard.set(map, forKey: mapKey) // 途中で止められても、入れた分は覚えておく
            }
        }
    }

    func test(title: String) async {
        guard await requestAuth() else { return }
        // 一覧に入らないアラームなので、ページが一覧を送り直しても消えない
        _ = await schedule(id: UUID(), at: Date().addingTimeInterval(5), title: title.isEmpty ? "⏰ アラームのテスト" : title, open: "開く")
    }

    @discardableResult
    private func schedule(id: UUID, at date: Date, title: String, open: String) async -> Bool {
        let alert = AlarmPresentation.Alert(
            title: LocalizedStringResource(String.LocalizationValue(title)),
            stopButton: AlarmButton(text: "止める", textColor: .white, systemImageName: "stop.circle"),
            secondaryButton: AlarmButton(text: LocalizedStringResource(String.LocalizationValue(open)), textColor: .white, systemImageName: "book.fill"),
            secondaryButtonBehavior: .custom
        )
        let attrs = AlarmAttributes<SusuruAlarmMeta>(presentation: AlarmPresentation(alert: alert), metadata: SusuruAlarmMeta(), tintColor: .orange)
        let conf = AlarmManager.AlarmConfiguration<SusuruAlarmMeta>(
            schedule: .fixed(date),
            attributes: attrs,
            secondaryIntent: OpenSusuruIntent(alarmID: id.uuidString)
        )
        do { _ = try await mgr.schedule(id: id, configuration: conf); return true } catch { return false }
    }
}
