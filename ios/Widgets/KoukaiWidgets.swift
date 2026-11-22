// ★【0.04.49】航海日誌のウィジェット（iOS では航海日誌のアプリを分けないので、すするanki のアプリに入れる）
// 中身は航海日誌の Android のウィジェット（CalendarWidget・DiaryWidget）と同じ。データは app-bridge.js の koukaiWidgetData（widget.json の koukai）
// 押すと Safari で航海日誌を開く（その日・できた事の欄）

import SwiftUI
import WidgetKit

enum K {
    static let bg = Color(red: 0x1D / 255, green: 0x2E / 255, blue: 0x3D / 255)
    static let text = Color(red: 0xED / 255, green: 0xE6 / 255, blue: 0xD2 / 255)
    static let dim = Color(red: 0x5E / 255, green: 0x71 / 255, blue: 0x80 / 255)
    static let sub = Color(red: 0x97 / 255, green: 0xA8 / 255, blue: 0xB5 / 255)
    static let signal = Color(red: 0x7F / 255, green: 0xB6 / 255, blue: 0x9E / 255)
    static let brass = Color(red: 0xE3 / 255, green: 0xC3 / 255, blue: 0x84 / 255)
    static let cell = Color(red: 0xC9 / 255, green: 0xA1 / 255, blue: 0x5C / 255)
    static let ink = Color(red: 0x13 / 255, green: 0x1E / 255, blue: 0x29 / 255)
    static let sun = Color(red: 0xC0 / 255, green: 0x60 / 255, blue: 0x5A / 255)
    static let site = "https://koukai-nisshi-calendar.vercel.app/"

    static func data(_ e: SusuruEntry) -> [String: Any] { (e.data["koukai"] as? [String: Any]) ?? [:] }
    static func events(_ k: [String: Any], _ ds: String) -> [[String: Any]] { ((k["days"] as? [String: Any])?[ds] as? [[String: Any]]) ?? [] }
    static func diary(_ k: [String: Any], _ ds: String) -> [String: Any]? { (k["diary"] as? [String: Any])?[ds] as? [String: Any] }
    static func doneCount(_ d: [String: Any]?) -> Int {
        guard let items = d?["items"] as? [Any] else { return 0 }
        return items.filter { !String(describing: $0).trimmingCharacters(in: .whitespaces).isEmpty && !($0 is NSNull) }.count
    }
    // 続けて書いた日数：今日書いていれば今日から、まだなら昨日からさかのぼる
    static func streak(_ k: [String: Any], _ now: Date) -> Int {
        var off = doneCount(diary(k, W.day(0, now))) > 0 ? 0 : -1, n = 0
        while n < 400, doneCount(diary(k, W.day(off, now))) > 0 { n += 1; off -= 1 }
        return n
    }
    static func url(_ q: String) -> URL { URL(string: site + "?" + q)! }
}

// ---------------- ⚓ 航海日誌のカレンダー ----------------
struct KoukaiCalendarView: View {
    let e: SusuruEntry
    @Environment(\.widgetFamily) var family
    // 今月の1日がある週の日曜日から、要る週の数だけ
    static func grid(_ now: Date) -> (cells: [String], month: Int, rows: Int) {
        let cal = Calendar.current
        let first = cal.date(from: cal.dateComponents([.year, .month], from: now)) ?? now
        let lead = cal.component(.weekday, from: first) - 1
        let dim = cal.range(of: .day, in: .month, for: first)?.count ?? 30
        let rows = (lead + dim + 6) / 7
        let start = cal.date(byAdding: .day, value: -lead, to: first) ?? first
        let cells = (0..<(rows * 7)).map { W.fmt(cal.date(byAdding: .day, value: $0, to: start) ?? start, "yyyy-MM-dd") }
        return (cells, cal.component(.month, from: now), rows)
    }
    var body: some View {
        let k = K.data(e), now = e.date, today = W.day(0, now), nowHM = W.fmt(now, "HH:mm")
        let g = Self.grid(now)
        let large = family == .systemLarge
        let todays = K.events(k, today)
        let cal = Calendar.current
        VStack(alignment: .leading, spacing: large ? 4 : 2) {
            HStack {
                Text("⚓ \(cal.component(.year, from: now))年\(g.month)月").font(.system(size: 14, weight: .bold)).foregroundStyle(K.brass)
                Spacer()
                if !todays.isEmpty { Text("今日 \(todays.count)件").font(.system(size: 10)).foregroundStyle(K.sub) }
            }
            if k.isEmpty {
                Text(e.data.isEmpty ? "すするanki を一度開くと、ここに出ます" : "すするanki を開くと、予定が届きます").font(.caption).foregroundStyle(K.sub)
            } else {
                HStack(spacing: 0) {
                    ForEach(0..<7, id: \.self) { i in
                        Text(W.dow[i]).font(.system(size: 9)).foregroundStyle(i == 0 ? K.sun : i == 6 ? K.signal : K.sub).frame(maxWidth: .infinity)
                    }
                }
                VStack(spacing: 1) {
                    ForEach(0..<g.rows, id: \.self) { r in
                        HStack(spacing: 1) {
                            ForEach(0..<7, id: \.self) { c in
                                let ds = g.cells[r * 7 + c]
                                let d = W.parse(ds) ?? now
                                let inMonth = cal.component(.month, from: d) == g.month
                                let isToday = ds == today
                                let nEv = min(3, K.events(k, ds).count), done = K.doneCount(K.diary(k, ds))
                                VStack(spacing: 0) {
                                    Text("\(cal.component(.day, from: d))")
                                        .font(.system(size: large ? 12 : 10, weight: isToday ? .bold : .regular))
                                        .foregroundStyle(isToday ? K.ink : !inMonth ? K.dim : c == 0 ? K.sun : K.text)
                                    HStack(spacing: 0) {
                                        Text(String(repeating: "•", count: nEv)).foregroundStyle(isToday ? K.ink : inMonth ? K.signal : K.dim)
                                        if done > 0 { Text("✦").foregroundStyle(isToday ? K.ink : done >= 3 ? K.brass : K.sub) }
                                        if nEv == 0 && done == 0 { Text(" ") }
                                    }.font(.system(size: large ? 8 : 6))
                                }
                                .frame(maxWidth: .infinity, maxHeight: .infinity)
                                .background(isToday ? K.cell : .clear, in: RoundedRectangle(cornerRadius: 6))
                            }
                        }
                    }
                }
                .frame(maxHeight: large ? 200 : .infinity)
                if large {
                    Divider().overlay(K.dim)
                    if todays.isEmpty { Text("今日の予定はありません").font(.system(size: 13)).foregroundStyle(K.sub) }
                    ForEach(Array(todays.prefix(4).enumerated()), id: \.offset) { _, x in
                        let s = W.str(x, "s"), en = W.str(x, "e")
                        let past = !s.isEmpty && (en.isEmpty ? s : en) < nowHM
                        HStack(spacing: 6) {
                            Text(s.isEmpty ? "終日" : s).font(.system(size: 12, design: .monospaced)).foregroundStyle(past ? K.dim : K.signal)
                            Text((W.str(x, "i").isEmpty ? "" : W.str(x, "i") + " ") + W.str(x, "n")).font(.system(size: 13, weight: past ? .regular : .semibold)).foregroundStyle(past ? K.dim : K.text).lineLimit(1)
                        }
                    }
                }
            }
            if large { Spacer(minLength: 0) }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .containerBackground(for: .widget) { K.bg }
        .widgetURL(K.url("view=today"))
    }
}

// ---------------- ✦ 今日のできた事 ----------------
struct KoukaiDiaryView: View {
    let e: SusuruEntry
    @Environment(\.widgetFamily) var family
    var body: some View {
        let k = K.data(e), now = e.date, today = W.day(0, now)
        let d = K.diary(k, today), done = K.doneCount(d), st = K.streak(k, now)
        let items = ((d?["items"] as? [Any]) ?? []).map { ($0 is NSNull) ? "" : String(describing: $0).trimmingCharacters(in: .whitespaces) }
        let small = family == .systemSmall
        let anki: String = { if let a = d?["anki"] as? NSNumber { return "\(a.intValue)語" }; return "—" }()
        VStack(alignment: .leading, spacing: small ? 3 : 5) {
            HStack {
                Text("✦ 今日のできた事" + (small ? "" : "  \(W.md(today))")).font(.system(size: small ? 12 : 14, weight: .bold)).foregroundStyle(K.brass).lineLimit(1)
                Spacer(minLength: 0)
                if st > 0 { Text("\(st)日連続").font(.system(size: 10, weight: .bold)).foregroundStyle(K.brass) }
            }
            if k.isEmpty {
                Text("すするanki を一度開くと、ここに出ます").font(.caption).foregroundStyle(K.sub)
            } else if done == 0 {
                Text("まだ書いていません").font(.system(size: 11)).foregroundStyle(K.sub)
                Text("どんなに小さなことでも大丈夫。\nタップして、できた事を3つ書こう ✏️").font(.system(size: small ? 11 : 13)).foregroundStyle(K.text).lineLimit(small ? 4 : 3)
            } else {
                ForEach(0..<3, id: \.self) { i in
                    let s = i < items.count ? items[i] : ""
                    HStack(alignment: .firstTextBaseline, spacing: 3) {
                        Text("\(i + 1).").font(.system(size: small ? 11 : 13, weight: .bold)).foregroundStyle(s.isEmpty ? K.dim : K.brass)
                        Text(s.isEmpty ? "（あと1つ書けます）" : s).font(.system(size: small ? 11 : 13)).foregroundStyle(s.isEmpty ? K.dim : K.text).lineLimit(small ? 1 : 2)
                    }
                }
            }
            Spacer(minLength: 0)
            if !k.isEmpty {
                HStack(spacing: 4) {
                    Text("📚 すするanki").font(.system(size: 10)).foregroundStyle(K.sub)
                    Text(anki).font(.system(size: 10, weight: .bold)).foregroundStyle(anki == "—" ? K.dim : K.brass)
                    if done >= 3 && !small { Text("🎉 3つ書けました").font(.system(size: 10)).foregroundStyle(K.brass) }
                }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .containerBackground(for: .widget) { K.bg }
        .widgetURL(K.url("view=diary"))
    }
}

struct KoukaiCalendarWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "KoukaiCalendar", provider: SusuruProvider()) { KoukaiCalendarView(e: $0) }
            .configurationDisplayName("航海日誌 カレンダー").description("今月の予定（点）と、できた事を書いた日（✦）、今日の予定")
            .supportedFamilies([.systemMedium, .systemLarge])
    }
}
struct KoukaiDiaryWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "KoukaiDiary", provider: SusuruProvider()) { KoukaiDiaryView(e: $0) }
            .configurationDisplayName("航海日誌 できた事日記").description("今日できた事（3つ）と、続けて書いた日数")
            .supportedFamilies([.systemSmall, .systemMedium])
    }
}
