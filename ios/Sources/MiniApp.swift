// ★【0.04.50】ランチャーの中に入れるアプリ（すするanki・航海日誌。★【0.04.51】すする帳簿＝貸し借り帳・家計簿も）
// どれもウェブ版を WKWebView で開く。iOS では1つのアプリにまとめる（無料の Apple ID で7日ごとに入れ直すのが1つで済む）。
// ランチャーの中ではそれぞれ別の画面（別の WKWebView・別のサイト）なので、データも別々のまま

import SwiftUI
import UIKit

enum MiniApp: String, CaseIterable, Identifiable {
    case anki, koukai, kashikari
    var id: String { rawValue }

    var title: String {
        switch self { case .anki: return "すするanki"; case .koukai: return "航海日誌"; case .kashikari: return "すする帳簿" }
    }
    var subtitle: String {
        switch self { case .anki: return "暗記・連続記録・週間プラン"; case .koukai: return "予定・できた事日記"; case .kashikari: return "貸し借り帳・家計簿" }
    }
    var emoji: String {
        switch self { case .anki: return "📚"; case .koukai: return "⚓"; case .kashikari: return "💰" }
    }
    var host: String { self == .koukai ? "koukai-nisshi-calendar.vercel.app" : "susuruchachi.github.io" }
    var path: String {
        switch self { case .anki: return "/-anki0.02.03.000-0-c/"; case .koukai: return "/"; case .kashikari: return "/susuru-obenri-tools/kashikari/" }
    }
    // ページとのやり取りの名前（webkit.messageHandlers.<これ>）
    var handlerName: String { self == .anki ? "susuru" : rawValue }
    // UA の最後に付ける（ページが「iOS アプリの中」と分かるように。すするanki は前から SusuruAnkiIOS/版）
    var uaTag: String {
        switch self { case .anki: return "SusuruAnkiIOS"; case .koukai: return "KoukaiIOS"; case .kashikari: return "KashikariIOS" }
    }
    // ★【0.04.51】Google のログイン：Android アプリと同じ app-login.html を、iOS のログインの画面（ASWebAuthenticationSession）で開く。
    // ログインできたら susuruanki://auth?state=…&id=…&at=… で戻ってくるので、ページの takeLogin・<loginArrived>() に渡す
    var loginPage: URL? { self == .anki ? nil : URL(string: "https://\(host)\(path)app-login.html") }
    var loginArrived: String { self == .koukai ? "__koukaiLoginArrived" : "__kashikariLoginArrived" }
    // ★【0.04.61】航海日誌の Googleカレンダー（gcal.js）：Google の Web client と、許可のあと戻ってくるところ（ブラウザと同じ。登録してある）
    var gcal: (clientID: String, redirect: String)? {
        self == .koukai ? ("926791749187-pq139a7m09tnp8pupfineqp8ibruhu9v.apps.googleusercontent.com", "https://koukai-nisshi-calendar.vercel.app/") : nil
    }

    var bg: UIColor {
        self == .anki ? UIColor(red: 8 / 255, green: 12 / 255, blue: 20 / 255, alpha: 1)
                      : UIColor(red: 0x13 / 255, green: 0x1E / 255, blue: 0x29 / 255, alpha: 1)
    }
    var tint: Color {
        switch self {
        case .anki: return Color(red: 1.0, green: 0.69, blue: 0.13)
        case .koukai: return Color(red: 0xE3 / 255, green: 0xC3 / 255, blue: 0x84 / 255)
        case .kashikari: return Color(red: 0x7F / 255, green: 0xB6 / 255, blue: 0x9E / 255)
        }
    }
    var tileBG: Color {
        switch self {
        case .anki: return Color(red: 0.11, green: 0.15, blue: 0.24)
        case .koukai: return Color(red: 0x1D / 255, green: 0x2E / 255, blue: 0x3D / 255)
        case .kashikari: return Color(red: 0x22 / 255, green: 0x2C / 255, blue: 0x2A / 255)
        }
    }
    // 航海日誌のページは安全な範囲（ノッチ・ホームバー）に合わせないので、アプリ側でその内側に置く（すするanki・帳簿はページが合わせる）
    var fitsSafeArea: Bool { self != .koukai }

    // 開くときの URL（extra は ?source=ios に足すもの。例：page=pgStats、view=diary）
    func startURL(_ extra: [URLQueryItem] = []) -> URL {
        var c = URLComponents()
        c.scheme = "https"; c.host = host; c.path = path
        c.queryItems = [URLQueryItem(name: "source", value: "ios")] + extra
        return c.url!
    }

    func owns(_ u: URL) -> Bool { u.host == host && u.path.hasPrefix(path) }
}
