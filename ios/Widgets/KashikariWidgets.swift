// ★【0.04.51】すする帳簿（貸し借り帳・家計簿）のウィジェット
// 中身はすする帳簿の Android のウィジェット（KashikariWidget）と同じ：返ってくる予定・返す予定の合計、相手ごとの差し引き、
// 届いた「返したよ」、家計簿の今月の支出と予算のあと。データはランチャーの中のすする帳簿のページが作る kashikari.json（widget.json と別）
// 押すとランチャーの中のすする帳簿を開く（「返したよ」が届いていれば、それを認める画面）

import SwiftUI
import WidgetKit

enum KK {
    static let danger = Color(red: 0xE0 / 255, green: 0x8A / 255, blue: 0x84 / 255)
    static func data(_ e: SusuruEntry) -> [String: Any]? { e.data["kashikari"] as? [String: Any] }
    static func num(_ d: [String: Any]?, _ k: String) -> Int64 { Int64((d?[k] as? NSNumber)?.doubleValue ?? 0) }
    static func yen(_ n: Int64) -> String {
        let f = NumberFormatter(); f.numberStyle = .decimal; f.locale = Locale(identifier: "ja_JP")
        return "¥" + (f.string(from: NSNumber(value: n)) ?? "\(n)")
    }
    static func url(_ claims: Int64) -> URL { URL(string: "susuruanki://open?app=kashikari" + (claims > 0 ? "&view=claims" : ""))! }
}

struct KashikariView: View {
    let e: SusuruEntry
    @Environment(\.widgetFamily) var family

    var body: some View {
        let d = KK.data(e)
        let signed = (d?["signedIn"] as? Bool) ?? false
        let claims = KK.num(d, "claims")
        let small = family == .systemSmall, large = family == .systemLarge
        VStack(alignment: .leading, spacing: small ? 4 : 6) {
            HStack {
                Text("💰 すする帳簿").font(.system(size: small ? 12 : 14, weight: .bold)).foregroundStyle(K.brass).lineLimit(1)
                Spacer(minLength: 0)
                if signed, !small, let at = (d?["at"] as? NSNumber)?.doubleValue, at > 0 {
                    Text(W.fmt(Date(timeIntervalSince1970: at / 1000), "M/d H:mm") + " 時点").font(.system(size: 9)).foregroundStyle(K.dim)
                }
            }
            if d == nil {
                Text("アプリですする帳簿を一度開くと、ここに出ます").font(.caption).foregroundStyle(K.sub)
            } else if !signed {
                Text("ログインすると、ここに貸し借りが出ます").font(.caption).foregroundStyle(K.sub)
            } else {
                sums(d, small: small)
                if claims > 0 {
                    Text(small ? "🔔 返したよ \(claims)件" : "🔔 「返したよ」が \(claims)件 届いています（タップして認める）")
                        .font(.system(size: small ? 10 : 11, weight: .semibold)).foregroundStyle(K.ink)
                        .padding(.horizontal, 6).padding(.vertical, 3)
                        .background(K.brass, in: RoundedRectangle(cornerRadius: 6))
                        .lineLimit(1)
                }
                if !small, let kb = d?["kb"] as? [String: Any] { month(kb) }
                if !small { lines(d, rows: large ? 8 : (claims > 0 || d?["kb"] is [String: Any] ? 1 : 2)) }
            }
            Spacer(minLength: 0)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .containerBackground(for: .widget) { K.bg }
        .widgetURL(KK.url(claims))
    }

    @ViewBuilder private func sums(_ d: [String: Any]?, small: Bool) -> some View {
        let inS = KK.num(d, "inSum"), outS = KK.num(d, "outSum")
        let layout = small ? AnyLayout(VStackLayout(alignment: .leading, spacing: 2)) : AnyLayout(HStackLayout(spacing: 16))
        layout {
            VStack(alignment: .leading, spacing: 0) {
                Text("返ってくる").font(.system(size: 10)).foregroundStyle(K.sub)
                Text(KK.yen(inS)).font(.system(size: small ? 17 : 20, weight: .bold, design: .rounded)).foregroundStyle(inS > 0 ? K.signal : K.text).minimumScaleFactor(0.6).lineLimit(1)
            }
            VStack(alignment: .leading, spacing: 0) {
                Text("返す").font(.system(size: 10)).foregroundStyle(K.sub)
                Text(KK.yen(outS)).font(.system(size: small ? 17 : 20, weight: .bold, design: .rounded)).foregroundStyle(outS > 0 ? KK.danger : K.text).minimumScaleFactor(0.6).lineLimit(1)
            }
        }
    }

    // 家計簿：今月の支出と、予算のあと
    private func month(_ kb: [String: Any]) -> some View {
        let exp = KK.num(kb, "exp"), budget = KK.num(kb, "budget"), left = budget - exp
        return HStack(spacing: 4) {
            Text("📒 \(KK.num(kb, "m"))月の支出").foregroundStyle(K.sub)
            Text(KK.yen(exp)).bold().foregroundStyle(K.text)
            if budget > 0 {
                Text(left >= 0 ? "予算あと" : "予算オーバー").foregroundStyle(K.sub)
                Text(KK.yen(abs(left))).bold().foregroundStyle(left >= 0 ? K.brass : KK.danger)
            }
        }
        .font(.system(size: 11)).lineLimit(1).minimumScaleFactor(0.7)
    }

    // 相手ごとの差し引き（大きい順）
    @ViewBuilder private func lines(_ d: [String: Any]?, rows: Int) -> some View {
        let list = (d?["lines"] as? [[String: Any]]) ?? []
        if list.isEmpty {
            Text("いま返していないお金はありません ✦").font(.system(size: 12)).foregroundStyle(K.sub)
        } else {
            VStack(alignment: .leading, spacing: 2) {
                ForEach(Array(list.prefix(rows).enumerated()), id: \.offset) { _, x in
                    let inc = W.str(x, "d") == "in", n = W.str(x, "n").isEmpty ? "だれか" : W.str(x, "n"), a = KK.yen(KK.num(x, "a"))
                    HStack(spacing: 4) {
                        if inc {
                            Text(n).foregroundStyle(K.text); Text("→ あなた").foregroundStyle(K.dim)
                        } else {
                            Text("あなた →").foregroundStyle(K.dim); Text(n).foregroundStyle(K.text)
                        }
                        Spacer(minLength: 4)
                        Text(a).bold().foregroundStyle(inc ? K.signal : KK.danger)
                    }
                    .font(.system(size: 12)).lineLimit(1)
                }
                if list.count > rows { Text("ほか \(list.count - rows)人").font(.system(size: 10)).foregroundStyle(K.dim) }
            }
        }
    }
}

struct KashikariWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "Kashikari", provider: SusuruProvider()) { KashikariView(e: $0) }
            .configurationDisplayName("すする帳簿").description("返ってくる・返すお金、相手ごとの差し引き、届いた「返したよ」、今月の支出")
            .supportedFamilies([.systemSmall, .systemMedium, .systemLarge])
    }
}
