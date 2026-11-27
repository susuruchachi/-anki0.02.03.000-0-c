// ★【0.04.50】ランチャーの画面：アプリを選ぶ・今日のようす（ウィジェットのデータから）・ランチャーと航海日誌の通知の設定

import SwiftUI
import UIKit
import UserNotifications

@MainActor
final class LauncherModel: ObservableObject {
    private static let autoKey = "launcher_auto_last"
    @Published var autoOpenLast: Bool { didSet { UserDefaults.standard.set(autoOpenLast, forKey: Self.autoKey) } }
    @Published var prefs: KoukaiNotifier.Prefs {
        didSet {
            guard prefs != oldValue else { return }
            KoukaiNotifier.shared.prefs = prefs
            if prefs.anyOn { Task { _ = await KoukaiNotifier.shared.requestAuth(); await self.refreshAuth() } }
        }
    }
    // ★【0.04.73】アップデートのお知らせ
    @Published var updateOn: Bool = UserDefaults.standard.bool(forKey: "update_notify_on") {
        didSet {
            guard updateOn != oldValue else { return }
            UpdateNotifier.shared.on = updateOn
            if updateOn { Task { _ = await KoukaiNotifier.shared.requestAuth(); await self.refreshAuth(); await UpdateNotifier.shared.check(); self.refresh() } }
        }
    }
    @Published var updateChecked: Date? = nil
    @Published var auth: UNAuthorizationStatus = .notDetermined
    @Published var lines: [MiniApp: String] = [:]

    init() {
        autoOpenLast = UserDefaults.standard.bool(forKey: Self.autoKey)
        prefs = KoukaiNotifier.shared.prefs
    }

    private static func day(_ off: Int) -> String {
        let x = DateFormatter(); x.locale = Locale(identifier: "en_US_POSIX"); x.dateFormat = "yyyy-MM-dd"
        return x.string(from: Calendar.current.date(byAdding: .day, value: off, to: Date()) ?? Date())
    }
    private static func doneCount(_ d: Any?) -> Int {
        guard let items = (d as? [String: Any])?["items"] as? [Any] else { return 0 }
        return items.filter { !($0 is NSNull) && !String(describing: $0).trimmingCharacters(in: .whitespaces).isEmpty }.count
    }

    // それぞれのアプリの今日のようす（アプリが最後にウィジェットに渡したデータ）
    func refresh() {
        let today = Self.day(0), yest = Self.day(-1)
        var l: [MiniApp: String] = [:]
        if let d = SharedStore.read(), !d.isEmpty {
            let streak = (d["streak"] as? NSNumber)?.intValue ?? 0, last = d["last"] as? String ?? ""
            l[.anki] = last == today ? "🔥 \(streak)日連続・今日はできました ✅"
                : last == yest && streak > 0 ? "⚠️ 今日まだです（\(streak)日連続中）"
                : "🕯️ 今日1問解いて、記録をはじめよう"
        }
        let k = SharedStore.koukaiData()
        if !k.isEmpty {
            let n = ((k["days"] as? [String: Any])?[today] as? [Any])?.count ?? 0
            let done = Self.doneCount((k["diary"] as? [String: Any])?[today])
            l[.koukai] = (n > 0 ? "今日の予定 \(n)件" : "今日の予定はありません") + "・できた事 \(done)/3" + (done >= 3 ? " 🎉" : "")
        }
        // ★【0.04.51】すする帳簿
        if let kk = SharedStore.readKashikari() {
            if (kk["signedIn"] as? Bool) == true {
                let yen = { (k: String) -> String in
                    let f = NumberFormatter(); f.numberStyle = .decimal; f.locale = Locale(identifier: "ja_JP")
                    return "¥" + (f.string(from: (kk[k] as? NSNumber) ?? 0) ?? "0")
                }
                let claims = (kk["claims"] as? NSNumber)?.intValue ?? 0
                l[.kashikari] = "返ってくる \(yen("inSum"))・返す \(yen("outSum"))" + (claims > 0 ? "\n🔔「返したよ」が \(claims)件 届いています" : "")
            } else {
                l[.kashikari] = "ログインすると、ここに貸し借りが出ます"
            }
        }
        lines = l
        updateChecked = UpdateNotifier.shared.lastChecked
        Task { await refreshAuth() }
    }

    func refreshAuth() async { auth = await KoukaiNotifier.shared.authStatus() }
}

struct LauncherHome: View {
    @ObservedObject var model: LauncherModel
    let open: (MiniApp) -> Void

    private let bg = Color(red: 8 / 255, green: 12 / 255, blue: 20 / 255)
    private let card = Color(red: 0.10, green: 0.13, blue: 0.20)
    private let sub = Color(red: 0.60, green: 0.65, blue: 0.74)
    private let koukaiTint = MiniApp.koukai.tint

    private var dateText: String {
        let x = DateFormatter(); x.locale = Locale(identifier: "ja_JP"); x.dateFormat = "M月d日（E）"
        return x.string(from: Date())
    }
    static func timeText(_ d: Date) -> String {
        let x = DateFormatter(); x.locale = Locale(identifier: "ja_JP"); x.dateFormat = "M/d H:mm"
        return x.string(from: d)
    }
    private var version: String { Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "" }

    var body: some View {
        ZStack {
            bg.ignoresSafeArea()
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(dateText).font(.subheadline).foregroundStyle(sub)
                        Text("どれを開く？").font(.largeTitle.bold()).foregroundStyle(.white)
                    }
                    .padding(.top, 12)

                    ForEach(MiniApp.allCases) { a in
                        Button { open(a) } label: { tile(a) }.buttonStyle(.plain)
                    }

                    Text("アプリを開いているときは、上のバーの「ランチャー」でここに戻れます。バーの右のボタンで、ほかのアプリにすぐ切りかえられます。ホーム画面のアイコンの長押しからも開けます。")
                        .font(.footnote).foregroundStyle(sub)

                    settings
                    Text("すするアプリ \(version)").font(.caption2).foregroundStyle(sub.opacity(0.7)).frame(maxWidth: .infinity)
                }
                .padding(.horizontal, 20)
                .padding(.bottom, 32)
                .frame(maxWidth: 560)
                .frame(maxWidth: .infinity)
            }
        }
        .onAppear { model.refresh() }
    }

    private func tile(_ a: MiniApp) -> some View {
        HStack(spacing: 14) {
            Text(a.emoji).font(.system(size: 34))
                .frame(width: 62, height: 62)
                .background(a.tint.opacity(0.16), in: RoundedRectangle(cornerRadius: 16, style: .continuous))
            VStack(alignment: .leading, spacing: 3) {
                Text(a.title).font(.title3.bold()).foregroundStyle(.white)
                Text(a.subtitle).font(.caption).foregroundStyle(sub)
                if let l = model.lines[a], !l.isEmpty {
                    Text(l).font(.footnote.weight(.semibold)).foregroundStyle(a.tint).lineLimit(2)
                }
            }
            Spacer(minLength: 0)
            Image(systemName: "chevron.right").foregroundStyle(sub)
        }
        .padding(16)
        .background(a.tileBG, in: RoundedRectangle(cornerRadius: 20, style: .continuous))
        .contentShape(Rectangle())
    }

    // ---------------- 設定 ----------------
    private func time(_ h: WritableKeyPath<KoukaiNotifier.Prefs, Int>, _ m: WritableKeyPath<KoukaiNotifier.Prefs, Int>) -> Binding<Date> {
        Binding(
            get: { Calendar.current.date(bySettingHour: model.prefs[keyPath: h], minute: model.prefs[keyPath: m], second: 0, of: Date()) ?? Date() },
            set: {
                let c = Calendar.current.dateComponents([.hour, .minute], from: $0)
                var p = model.prefs
                p[keyPath: h] = c.hour ?? 0; p[keyPath: m] = c.minute ?? 0
                model.prefs = p
            })
    }

    private var settings: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("⚙️ ランチャー").font(.headline).foregroundStyle(.white)
            Toggle("起動したら、前に開いていたアプリをすぐ出す", isOn: $model.autoOpenLast).tint(.orange)

            Divider().overlay(sub.opacity(0.4))
            Text("🆕 アップデートのお知らせ").font(.headline).foregroundStyle(.white)
            Toggle("すするanki・すするアプリの新しい版が出たら知らせる", isOn: $model.updateOn).tint(.orange)
            if model.updateOn && model.auth == .denied {
                Text("🚫 通知が許可されていないので届きません").font(.footnote).foregroundStyle(.red)
                Button("⚙️ 設定を開いて許可する") { if let u = URL(string: UIApplication.openSettingsURLString) { UIApplication.shared.open(u) } }
                    .buttonStyle(.bordered)
            }
            Text("アプリを閉じていても、iOS が決めたとき（ふだん使っていれば数時間おきくらい）に新しい版が出ていないか確かめます。すぐには届きません。iPhone・iPad の設定の「一般 → Appのバックグラウンド更新」がオンのときだけ動きます。" + (model.updateChecked.map { "（最後に確かめた時刻：\(Self.timeText($0))）" } ?? ""))
                .font(.caption).foregroundStyle(sub)

            Divider().overlay(sub.opacity(0.4))
            Text("🔔 航海日誌の通知").font(.headline).foregroundStyle(.white)
            Toggle("予定の前に知らせる", isOn: $model.prefs.events).tint(koukaiTint)
            if model.prefs.events {
                Picker("いつ", selection: $model.prefs.before) {
                    ForEach([0, 5, 10, 15, 30, 60], id: \.self) { Text($0 == 0 ? "始まる時刻" : "\($0)分前").tag($0) }
                }
                .pickerStyle(.menu).tint(koukaiTint)
            }
            Toggle("終日の予定を、その日の朝に知らせる", isOn: $model.prefs.allDay).tint(koukaiTint)
            if model.prefs.allDay {
                DatePicker("知らせる時刻", selection: time(\.allDayH, \.allDayM), displayedComponents: .hourAndMinute)
            }
            Toggle("できた事日記を、まだ書いていない日に知らせる", isOn: $model.prefs.diary).tint(koukaiTint)
            if model.prefs.diary {
                DatePicker("知らせる時刻", selection: time(\.diaryH, \.diaryM), displayedComponents: .hourAndMinute)
            }
            if model.prefs.anyOn {
                if model.auth == .denied {
                    Text("🚫 通知が許可されていないので届きません").font(.footnote).foregroundStyle(.red)
                    Button("⚙️ 設定を開いて許可する") { if let u = URL(string: UIApplication.openSettingsURLString) { UIApplication.shared.open(u) } }
                        .buttonStyle(.bordered)
                } else {
                    Button("🔔 通知を試す（5秒後に届きます）") { Task { await KoukaiNotifier.shared.test(); await model.refreshAuth() } }
                        .buttonStyle(.bordered).tint(koukaiTint)
                }
            }
            Text("予定・日記は、このアプリで航海日誌を開いたときに受け取ったものです（ほかの端末で足した予定は、このアプリを開くと届きます）。すするanki のアラーム（連続記録・予定）は、すするanki の設定の「⏰ アラーム」から。")
                .font(.caption).foregroundStyle(sub)
        }
        .foregroundStyle(.white)
        .padding(16)
        .background(card, in: RoundedRectangle(cornerRadius: 20, style: .continuous))
    }
}
