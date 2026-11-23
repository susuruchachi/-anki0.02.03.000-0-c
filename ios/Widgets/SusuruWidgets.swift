// ★【0.04.47】ホーム画面のウィジェット（Android の StreakWidget・CalendarWidget・StarWidget・BoardWidget と同じ内容）
// データはアプリが App Group に置く（SharedStore）。日付が変わったときの「今日まだ」「あと何日」は、ここで数え直す

import SwiftUI
import WidgetKit

// ---------------- データ ----------------
struct SusuruEntry: TimelineEntry {
    let date: Date
    let data: [String: Any]
    let linked: Bool // App Group につながったか
}

struct SusuruProvider: TimelineProvider {
    func placeholder(in context: Context) -> SusuruEntry { SusuruEntry(date: Date(), data: ["streak": 12, "last": W.day(-1, Date())], linked: true) }
    func getSnapshot(in context: Context, completion: @escaping (SusuruEntry) -> Void) { completion(entry(Date())) }
    func getTimeline(in context: Context, completion: @escaping (Timeline<SusuruEntry>) -> Void) {
        // 15分ごと（夜の「あと何時間」・予定の終わったものを薄くする）。日付が変わる直後にも
        let now = Date()
        var dates: [Date] = [now]
        let cal = Calendar.current
        var t = cal.date(bySetting: .second, value: 0, of: now) ?? now
        for _ in 0..<32 { t = t.addingTimeInterval(15 * 60); dates.append(t) }
        if let mid = cal.nextDate(after: now, matching: DateComponents(hour: 0, minute: 0, second: 30), matchingPolicy: .nextTime) { dates.append(mid) }
        dates.sort()
        let d = Self.load()
        completion(Timeline(entries: dates.map { SusuruEntry(date: $0, data: d, linked: SharedStore.fileURL != nil) }, policy: .atEnd))
    }
    private func entry(_ date: Date) -> SusuruEntry { SusuruEntry(date: date, data: Self.load(), linked: SharedStore.fileURL != nil) }
    // ★【0.04.50】航海日誌の分（koukai）は、航海日誌のページが作ったもの（koukai.json）があればそれにする
    static func load() -> [String: Any] {
        var d = SharedStore.read() ?? [:]
        let k = SharedStore.koukaiData(anki: d)
        if !k.isEmpty { d["koukai"] = k }
        if let kk = SharedStore.readKashikari() { d["kashikari"] = kk } // ★【0.04.51】すする帳簿
        return d
    }
}

// ---------------- 共通 ----------------
enum W {
    static let bg = Color(red: 0.08, green: 0.11, blue: 0.17)
    static let warn = Color(red: 0.36, green: 0.22, blue: 0.05)
    static let danger = Color(red: 0.42, green: 0.08, blue: 0.10)
    static let text = Color(red: 0.91, green: 0.93, blue: 0.96)
    static let sub = Color(red: 0.60, green: 0.65, blue: 0.74)
    static let dim = Color(red: 0.37, green: 0.42, blue: 0.51)
    static let gold = Color(red: 1.0, green: 0.69, blue: 0.13)
    static let red = Color(red: 1.0, green: 0.36, blue: 0.42)
    static let blue = Color(red: 0.60, green: 0.82, blue: 1.0)
    static let dow = ["日", "月", "火", "水", "木", "金", "土"]

    static func fmt(_ d: Date, _ f: String) -> String { let x = DateFormatter(); x.locale = Locale(identifier: "en_US_POSIX"); x.dateFormat = f; return x.string(from: d) }
    static func day(_ offset: Int, _ now: Date) -> String { fmt(Calendar.current.date(byAdding: .day, value: offset, to: now) ?? now, "yyyy-MM-dd") }
    static func parse(_ ds: String) -> Date? { let x = DateFormatter(); x.locale = Locale(identifier: "en_US_POSIX"); x.dateFormat = "yyyy-MM-dd"; return x.date(from: ds) }
    static func md(_ ds: String) -> String {
        guard let d = parse(ds) else { return ds }
        let c = Calendar.current
        return "\(c.component(.month, from: d))/\(c.component(.day, from: d))(\(dow[c.component(.weekday, from: d) - 1]))"
    }
    static func daysBetween(_ a: String, _ b: String) -> Int {
        guard let x = parse(a), let y = parse(b) else { return 0 }
        return Int((y.timeIntervalSince(x) / 86400).rounded())
    }
    static func msToMidnight(_ now: Date) -> Double {
        let c = Calendar.current
        let mid = c.startOfDay(for: c.date(byAdding: .day, value: 1, to: now) ?? now)
        return mid.timeIntervalSince(now)
    }
    // 今日まだのときの危なさ：0=まだ余裕（18時まで） 1=18〜21時 2=21〜23時 3=最後の1時間
    static func risk(_ now: Date) -> Int { let h = Calendar.current.component(.hour, from: now); return h >= 23 ? 3 : h >= 21 ? 2 : h >= 18 ? 1 : 0 }
    static func riskText(_ streak: Int, _ now: Date) -> String {
        let s = msToMidnight(now), h = Int(s / 3600), m = Int(s / 60) % 60
        switch risk(now) {
        case 3: return "🚨 残り\(max(1, Int(s / 60)))分！今すぐ1問で \(streak)日連続を守って！"
        case 2: return "🚨 あと\(h)時間\(m)分で \(streak)日の記録が消えます！"
        case 1: return "⚠️ \(streak)日連続が危ない！今日はあと\(h)時間"
        default: return "今日まだです！1問解けば \(streak + 1)日連続"
        }
    }
    static func left(_ deadline: Double, _ now: Date) -> String {
        let s = deadline / 1000 - now.timeIntervalSince1970
        if s <= 0 { return "期限を過ぎています" }
        let h = Int(s / 3600), d = h / 24
        return d >= 1 ? "あと\(d)日" : "あと\(h)時間\(Int(s / 60) % 60)分"
    }
    static func str(_ d: [String: Any], _ k: String) -> String { d[k] as? String ?? "" }
    static func int(_ d: [String: Any], _ k: String) -> Int { (d[k] as? NSNumber)?.intValue ?? 0 }
    static func dbl(_ d: [String: Any], _ k: String) -> Double { (d[k] as? NSNumber)?.doubleValue ?? 0 }
    static func url(_ page: String) -> URL { URL(string: "susuruanki://open?page=\(page)")! }
    static func dowOf(_ ds: String) -> String { guard let d = parse(ds) else { return "" }; return dow[Calendar.current.component(.weekday, from: d) - 1] }

    // 連続記録の状態：(火の絵, 数, 数の色, 一言, 背景)
    static func streakState(_ d: [String: Any], _ now: Date) -> (String, Int, Color, String, Color) {
        let last = str(d, "last"), today = day(0, now), yesterday = day(-1, now), streak = int(d, "streak")
        let todayN = str(d, "todayDate") == today ? int(d, "today") : 0
        if last == today { return ("🔥", streak, gold, "今日 \(todayN)問 解きました ✅", bg) }
        if last == yesterday && streak > 0 {
            let lv = risk(now)
            return (lv >= 2 ? "🚨" : lv == 1 ? "⚠️" : "🕯️", streak, lv >= 1 ? .white : red, riskText(streak, now), lv >= 2 ? danger : lv == 1 ? warn : bg)
        }
        let best = int(d, "best")
        return ("🕯️", 0, sub, best > 0 ? "記録が途切れました（最長 \(best)日）。今日からまた！" : "今日1問解いて記録をはじめよう", bg)
    }
}

struct NotLinked: View {
    let linked: Bool
    var body: some View {
        Text(linked ? "すするanki を一度開くと、ここに出ます" : "アプリからデータを受け取れません（App Group）。アプリを入れ直してみてください")
            .font(.caption).foregroundStyle(W.sub)
    }
}

// ---------------- 🔥 連続記録 ----------------
// ★【0.04.49】直近7日の🔥（アプリの連続記録の欄と同じ）
struct WeekDots: View {
    let studied: Set<String>
    let now: Date
    var size: CGFloat = 22
    var body: some View {
        HStack(spacing: size * 0.28) {
            ForEach(0..<7, id: \.self) { j in
                let ds = W.day(j - 6, now), on = studied.contains(ds), isToday = j == 6
                VStack(spacing: 2) {
                    ZStack {
                        Circle().fill(on ? W.gold.opacity(0.28) : Color.white.opacity(0.07))
                        if on { Text("🔥").font(.system(size: size * 0.55)) }
                    }
                    .frame(width: size, height: size)
                    .overlay(Circle().stroke(isToday ? W.gold : .clear, lineWidth: 1.5))
                    Text(W.dowOf(ds)).font(.system(size: max(8, size * 0.4))).foregroundStyle(isToday ? W.gold : W.sub)
                }
            }
        }
    }
}

struct StreakView: View {
    let e: SusuruEntry
    @Environment(\.widgetFamily) var family
    var body: some View {
        let st = W.streakState(e.data, e.date)
        let fire = st.0, num = st.1, color = st.2, status = st.3, bg = st.4
        let plan = e.data["plan"] as? [String: Any]
        let planText: String = {
            guard let p = plan else { return "" }
            let t = W.str(p, "text"); if t.isEmpty { return "✅ 今週のプランは終わっています" }
            let dl = W.dbl(p, "deadline"); return t + (dl > 0 ? "（\(W.left(dl, e.date))）" : "")
        }()
        let studied = Set((e.data["studied"] as? [String]) ?? [])
        let today = W.day(0, e.date)
        let todayN = W.str(e.data, "todayDate") == today ? W.int(e.data, "today") : 0
        let best = W.int(e.data, "best")
        let small = family == .systemSmall, large = family == .systemLarge
        VStack(alignment: .leading, spacing: large ? 10 : 4) {
            if e.data.isEmpty { NotLinked(linked: e.linked) } else {
                HStack(alignment: .firstTextBaseline, spacing: 4) {
                    Text(fire).font(.system(size: small ? 30 : large ? 44 : 32))
                    Text("\(num)").font(.system(size: small ? 40 : large ? 64 : 42, weight: .heavy, design: .rounded)).foregroundStyle(color)
                    Text("日").font(.headline).foregroundStyle(W.sub)
                    if !small {
                        Spacer(minLength: 4)
                        VStack(alignment: .trailing, spacing: 2) {
                            Text("今日 \(todayN)問").font(.system(size: 13, weight: .bold)).foregroundStyle(todayN > 0 ? W.gold : W.sub)
                            if best > 0 { Text("最長 \(best)日").font(.system(size: 11)).foregroundStyle(W.sub) }
                        }
                    }
                }
                Text(status).font(.system(size: small ? 12 : large ? 16 : 13, weight: .semibold)).foregroundStyle(W.text).lineLimit(small ? 3 : 2)
                if !small { WeekDots(studied: studied, now: e.date, size: large ? 30 : 20) }
                if large {
                    if !planText.isEmpty {
                        VStack(alignment: .leading, spacing: 3) {
                            Text("📚 週間プラン").font(.system(size: 12, weight: .bold)).foregroundStyle(W.sub)
                            Text(planText).font(.system(size: 15)).foregroundStyle(W.blue).lineLimit(3)
                        }
                    }
                    let b = (e.data["board"] as? [String: Any]) ?? [:]
                    if W.int(b, "week") > 0 || !W.str(b, "drill").isEmpty {
                        VStack(alignment: .leading, spacing: 3) {
                            Text("📅 今週 \(W.int(b, "week"))問").font(.system(size: 13)).foregroundStyle(W.text)
                            if !W.str(b, "drill").isEmpty { Text(W.str(b, "drill")).font(.system(size: 13)).foregroundStyle(W.sub).lineLimit(1) }
                        }
                    }
                } else if !small, !planText.isEmpty {
                    Text(planText).font(.system(size: 12)).foregroundStyle(W.blue).lineLimit(1)
                }
                Spacer(minLength: 0)
                Text(W.str(e.data, "foot").isEmpty ? "すするanki" : W.str(e.data, "foot")).font(.system(size: 10)).foregroundStyle(W.dim).lineLimit(1)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .containerBackground(for: .widget) { bg }
        .widgetURL(W.url(planText.isEmpty ? "pgDrill" : "pgHome"))
    }
}

// ---------------- 📅 カレンダー ----------------
struct CalendarView: View {
    let e: SusuruEntry
    @Environment(\.widgetFamily) var family
    // これから：同じ名前は一番近い1回だけ
    static func upcoming(_ cal: [[String: Any]], _ today: String) -> [[String: Any]] {
        var seen = Set<String>(), out: [[String: Any]] = []
        for x in cal where W.str(x, "d") > today && W.str(x, "k") != "class" {
            if seen.insert(W.str(x, "n") + "|" + W.str(x, "k")).inserted { out.append(x) }
        }
        return out
    }
    var body: some View {
        let today = W.day(0, e.date), tomorrow = W.day(1, e.date), nowHM = W.fmt(e.date, "HH:mm")
        let cal = (e.data["cal"] as? [[String: Any]]) ?? []
        let key: ([String: Any]) -> String = { let s = W.str($0, "s"); return s.isEmpty ? "00:00" : s }
        let todays = cal.filter { x in let d = W.str(x, "d"), e2 = W.str(x, "e2"); return d == today || (!e2.isEmpty && d <= today && e2 >= today) }.sorted { key($0) < key($1) }
        let tmr = cal.filter { W.str($0, "d") == tomorrow }.sorted { key($0) < key($1) }
        let ups = Self.upcoming(cal, today)
        let maxToday = family == .systemLarge ? 7 : 3, maxUp = family == .systemLarge ? 6 : 2
        VStack(alignment: .leading, spacing: 3) {
            HStack { Text("📅 \(W.md(today))").font(.headline).foregroundStyle(W.text); Spacer(); if !todays.isEmpty { Text("今日 \(todays.count)件").font(.caption2).foregroundStyle(W.sub) } }
            if e.data.isEmpty { NotLinked(linked: e.linked) } else {
                if todays.isEmpty {
                    Text("今日の予定はありません").font(.caption).foregroundStyle(W.sub)
                    if !tmr.isEmpty { Text("明日：" + tmr.prefix(3).map { (W.str($0, "s").isEmpty ? "" : W.str($0, "s") + " ") + W.str($0, "n") }.joined(separator: "・")).font(.caption).foregroundStyle(W.sub).lineLimit(2) }
                }
                ForEach(Array(todays.prefix(maxToday).enumerated()), id: \.offset) { _, x in
                    let s = W.str(x, "s"), t2 = W.str(x, "t2"), e2 = W.str(x, "e2")
                    let end = t2.isEmpty ? s : t2
                    let past = !end.isEmpty && end < nowHM && e2.isEmpty
                    HStack(spacing: 6) {
                        Text(s.isEmpty ? "終日" : s + (t2.isEmpty ? "" : "〜" + t2)).font(.system(size: 12, design: .monospaced)).foregroundStyle(past ? W.dim : W.blue)
                        Text("\(W.str(x, "i")) \(W.str(x, "n"))" + (e2.isEmpty ? "" : "（〜\(W.md(e2))）")).font(.system(size: 13, weight: past ? .regular : .semibold)).foregroundStyle(past ? W.dim : W.text).lineLimit(1)
                    }
                }
                Divider().overlay(W.dim)
                if ups.isEmpty { Text("45日以内にテスト・期限はありません").font(.caption).foregroundStyle(W.sub) }
                ForEach(Array(ups.prefix(maxUp).enumerated()), id: \.offset) { _, x in
                    let n = W.daysBetween(today, W.str(x, "d"))
                    HStack(spacing: 6) {
                        Text(W.md(W.str(x, "d"))).font(.system(size: 12)).foregroundStyle(W.sub)
                        Text("\(W.str(x, "i")) \(W.str(x, "n"))").font(.system(size: 13)).foregroundStyle(W.text).lineLimit(1)
                        Spacer(minLength: 0)
                        Text(n == 1 ? "明日" : "あと\(n)日").font(.system(size: 12, weight: .bold)).foregroundStyle(n <= 3 ? W.red : W.text)
                    }
                }
            }
            Spacer(minLength: 0)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .containerBackground(for: .widget) { W.bg }
        .widgetURL(W.url("pgCalendar"))
    }
}

// ---------------- ★ 大事な予定 ----------------
struct StarView: View {
    let e: SusuruEntry
    @Environment(\.widgetFamily) var family
    // 1つの予定につき、まだ終わっていない最初の回
    static func pick(_ stars: [[String: Any]], _ today: String) -> [[String: Any]] {
        var seen = Set<String>(), out: [[String: Any]] = []
        for x in stars {
            let last = W.str(x, "e2").isEmpty ? W.str(x, "d") : W.str(x, "e2")
            if last < today { continue }
            let k = W.str(x, "k").isEmpty ? W.str(x, "n") : W.str(x, "k")
            if seen.insert(k).inserted { out.append(x) }
        }
        return out.sorted { W.str($0, "d") < W.str($1, "d") }
    }
    static func leftText(_ x: [String: Any], _ today: String) -> String {
        let d = W.str(x, "d"), e2 = W.str(x, "e2")
        if d <= today && !e2.isEmpty && e2 >= today { return d == today ? "今日から" : "期間中" }
        let n = W.daysBetween(today, d)
        return n <= 0 ? "今日" : n == 1 ? "明日" : "あと\(n)日"
    }
    var body: some View {
        let today = W.day(0, e.date)
        let list = Self.pick((e.data["stars"] as? [[String: Any]]) ?? [], today)
        let rows = family == .systemLarge ? 8 : family == .systemMedium ? 3 : 2
        VStack(alignment: .leading, spacing: 4) {
            Text(list.isEmpty ? "★ 大事な予定" : "★ 大事な予定（\(list.count)）").font(.headline).foregroundStyle(Color(red: 1, green: 0.82, blue: 0.4))
            if e.data.isEmpty { NotLinked(linked: e.linked) }
            else if list.isEmpty { Text("カレンダーの予定に「★ 重要な予定」を付けると、ここに出ます").font(.caption).foregroundStyle(W.sub) }
            ForEach(Array(list.prefix(rows).enumerated()), id: \.offset) { _, x in
                let left = Self.leftText(x, today), n = W.daysBetween(today, W.str(x, "d"))
                let soon = !left.hasPrefix("あと") || n <= 7
                HStack(spacing: 6) {
                    if family != .systemSmall { Text(W.md(W.str(x, "d"))).font(.system(size: 12)).foregroundStyle(W.sub) }
                    Text("\(W.str(x, "i")) \(W.str(x, "n"))").font(.system(size: 13, weight: .semibold)).foregroundStyle(W.text).lineLimit(1)
                    Spacer(minLength: 0)
                    Text(left).font(.system(size: 12, weight: .bold))
                        .foregroundStyle(soon ? Color(red: 0.08, green: 0.11, blue: 0.17) : Color(red: 1, green: 0.82, blue: 0.4))
                        .padding(.horizontal, soon ? 6 : 0).padding(.vertical, soon ? 2 : 0)
                        .background(soon ? Color(red: 1, green: 0.82, blue: 0.4) : .clear, in: Capsule())
                }
            }
            Spacer(minLength: 0)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .containerBackground(for: .widget) { W.bg }
        .widgetURL(W.url("pgCalendar"))
    }
}

// ---------------- 🏆 ランキング ----------------
struct BoardView: View {
    let e: SusuruEntry
    @Environment(\.widgetFamily) var family
    var body: some View {
        let b = (e.data["board"] as? [String: Any]) ?? [:]
        let today = W.day(0, e.date)
        let todayN = W.str(e.data, "todayDate") == today ? W.int(e.data, "today") : 0
        let rank = b["rank"] as? [[String: Any]]
        let st = W.streakState(e.data, e.date)
        let status = st.3, bg = st.4
        let line = W.str(e.data, "last") == today ? "🔥 \(W.int(e.data, "streak"))日連続 ・ 今日 \(todayN)問 ✅" : status
        let medal = ["🥇", "🥈", "🥉"]
        let tasks = (b["tasks"] as? [[String: Any]]) ?? []
        let rows = family == .systemLarge ? 6 : 3
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Text("🏆 今週のランキング").font(.headline).foregroundStyle(W.text)
                Spacer()
                if W.dbl(b, "rankAt") > 0 { Text(W.fmt(Date(timeIntervalSince1970: W.dbl(b, "rankAt") / 1000), "M/d HH:mm") + " 更新").font(.caption2).foregroundStyle(W.dim) }
            }
            if e.data.isEmpty { NotLinked(linked: e.linked) } else {
                if let rank {
                    ForEach(Array(rank.prefix(rows).enumerated()), id: \.offset) { i, x in
                        let me = (x["me"] as? Bool) ?? false, no = W.int(x, "r") > 0 ? W.int(x, "r") : i + 1
                        let t = me ? todayN : W.int(x, "t")
                        HStack(spacing: 4) {
                            Text(no <= 3 ? medal[no - 1] : "\(no).").font(.system(size: 13))
                            Text(W.str(x, "n")).font(.system(size: 13, weight: me ? .bold : .regular)).foregroundStyle(me ? W.gold : W.text).lineLimit(1)
                            Spacer(minLength: 0)
                            Text("\(W.int(x, "w"))問").font(.system(size: 13, weight: .bold)).foregroundStyle(me ? W.gold : W.text)
                            Text("（今日\(t)・🔥\(W.int(x, "s"))）").font(.system(size: 11)).foregroundStyle(W.dim)
                        }
                    }
                    if rank.count <= 1 { Text("フレンドを追加すると一緒に競えます").font(.caption).foregroundStyle(W.dim) }
                } else { Text("ログインしてフレンドを追加すると、ここで今週の問題数を競えます").font(.caption).foregroundStyle(W.sub) }
                Divider().overlay(W.dim)
                Text(line).font(.system(size: 13, weight: .semibold)).foregroundStyle(W.text).lineLimit(2)
                Text("📅 今週 \(W.int(b, "week"))問" + (W.int(e.data, "best") > 0 ? " ・ 最長 \(W.int(e.data, "best"))日" : "")).font(.caption).foregroundStyle(W.sub)
                if family == .systemLarge {
                    Text(tasks.isEmpty ? "週間プランはまだありません" : tasks.map { x in
                        let done = (x["done"] as? Bool) ?? false, wait = (x["wait"] as? Bool) ?? false, p = W.int(x, "p")
                        return (done ? "✅" : wait ? "🔒" : "⬜") + W.str(x, "t") + (!done && !wait && p > 0 ? " \(p)%" : "")
                    }.joined(separator: "  ")).font(.caption).foregroundStyle(W.text).lineLimit(2)
                    Text(W.str(b, "drill").isEmpty ? "📝 暗記テストはまだ始めていません" : W.str(b, "drill")).font(.caption).foregroundStyle(W.sub).lineLimit(1)
                }
            }
            Spacer(minLength: 0)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .containerBackground(for: .widget) { bg }
        .widgetURL(W.url("pgStats"))
    }
}

// ---------------- まとめ ----------------
struct StreakWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "SusuruStreak", provider: SusuruProvider()) { StreakView(e: $0) }
            .configurationDisplayName("すするanki 連続記録").description("連続記録と、週間プランの次の課題")
            .supportedFamilies([.systemSmall, .systemMedium, .systemLarge])
    }
}
struct CalendarWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "SusuruCalendar", provider: SusuruProvider()) { CalendarView(e: $0) }
            .configurationDisplayName("すするanki カレンダー").description("今日の予定と、これからのテスト・期限")
            .supportedFamilies([.systemMedium, .systemLarge])
    }
}
struct StarWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "SusuruStar", provider: SusuruProvider()) { StarView(e: $0) }
            .configurationDisplayName("すするanki 大事な予定").description("★を付けた予定と、あと何日")
            .supportedFamilies([.systemSmall, .systemMedium, .systemLarge])
    }
}
struct BoardWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "SusuruBoard", provider: SusuruProvider()) { BoardView(e: $0) }
            .configurationDisplayName("すするanki ランキング").description("フレンドとの今週のランキングと、自分の進み具合")
            .supportedFamilies([.systemMedium, .systemLarge])
    }
}

@main
struct SusuruWidgets: WidgetBundle {
    var body: some Widget {
        StreakWidget()
        CalendarWidget()
        StarWidget()
        BoardWidget()
        KoukaiCalendarWidget()
        KoukaiDiaryWidget()
        KashikariWidget()
    }
}
