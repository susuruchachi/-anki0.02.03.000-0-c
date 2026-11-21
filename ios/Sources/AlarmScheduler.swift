// ★【0.04.45】⏰ アラーム（AlarmKit・iOS 26 から）
// iOS では、決まった時刻にアプリを動かして「今日解いたか」を確かめられない。そこでページ（app-bridge.js）が、
// 鳴らす時刻の一覧（連続記録は今日まだなら 20:00・20:10…、明日・明後日も同じ。予定の前）を作って渡し、ここで全部入れ直す。
// 今日解いたら、ページがまた一覧を渡す（今日の分が無くなる）ので、今日の残りは鳴らない。
// 「止める」でその回だけ止まり、次の回（スヌーズの間隔）でまた鳴る。「今やる」・「開く」でアプリを開く

import AlarmKit
import AppIntents
import Foundation
import SwiftUI

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
    private let sigKey = "susuru_alarm_sig"

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

    // ページから：鳴らす時刻の一覧を受け取って、入れ直す（前と同じなら何もしない）
    func apply(json: String) async {
        guard let d = json.data(using: .utf8), let cfg = try? JSONDecoder().decode(Config.self, from: d) else { return }
        let now = Date()
        let items = cfg.items.filter { Date(timeIntervalSince1970: $0.at / 1000) > now.addingTimeInterval(5) }.sorted { $0.at < $1.at }.prefix(60)
        let sig = cfg.sig ?? json
        let have = (try? mgr.alarms) ?? []
        if UserDefaults.standard.string(forKey: sigKey) == sig, have.count >= items.count { return }
        if items.isEmpty && have.isEmpty { UserDefaults.standard.set(sig, forKey: sigKey); return }
        if !items.isEmpty, !(await requestAuth()) { return }
        for a in have { try? mgr.cancel(id: a.id) }
        for it in items { await schedule(at: Date(timeIntervalSince1970: it.at / 1000), title: it.title, open: it.open ?? "開く") }
        UserDefaults.standard.set(sig, forKey: sigKey)
    }

    func test(title: String) async {
        guard await requestAuth() else { return }
        UserDefaults.standard.removeObject(forKey: sigKey) // 次にページが一覧を送ったとき、入れ直す
        await schedule(at: Date().addingTimeInterval(5), title: title.isEmpty ? "⏰ アラームのテスト" : title, open: "開く")
    }

    private func schedule(at date: Date, title: String, open: String) async {
        let id = UUID()
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
        _ = try? await mgr.schedule(id: id, configuration: conf)
    }
}
