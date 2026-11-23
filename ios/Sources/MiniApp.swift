// ★【0.04.50】ランチャーの中に入れるアプリ（すするanki・航海日誌）
// どちらもウェブ版を WKWebView で開く。iOS では1つのアプリにまとめる（無料の Apple ID で7日ごとに入れ直すのが1つで済む）。
// ランチャーの中ではそれぞれ別の画面（別の WKWebView・別のサイト）なので、データも別々のまま

import SwiftUI
import UIKit

enum MiniApp: String, CaseIterable, Identifiable {
    case anki, koukai
    var id: String { rawValue }

    var title: String { self == .anki ? "すするanki" : "航海日誌" }
    var subtitle: String { self == .anki ? "暗記・連続記録・週間プラン" : "予定・できた事日記" }
    var emoji: String { self == .anki ? "📚" : "⚓" }
    var host: String { self == .anki ? "susuruchachi.github.io" : "koukai-nisshi-calendar.vercel.app" }
    var path: String { self == .anki ? "/-anki0.02.03.000-0-c/" : "/" }
    // ページとのやり取りの名前（webkit.messageHandlers.<これ>）
    var handlerName: String { self == .anki ? "susuru" : "koukai" }
    // UA の最後に付ける（ページが「iOS アプリの中」と分かるように。すするanki は前から SusuruAnkiIOS/版）
    var uaTag: String { self == .anki ? "SusuruAnkiIOS" : "KoukaiIOS" }

    var bg: UIColor {
        self == .anki ? UIColor(red: 8 / 255, green: 12 / 255, blue: 20 / 255, alpha: 1)
                      : UIColor(red: 0x13 / 255, green: 0x1E / 255, blue: 0x29 / 255, alpha: 1)
    }
    var tint: Color {
        self == .anki ? Color(red: 1.0, green: 0.69, blue: 0.13) : Color(red: 0xE3 / 255, green: 0xC3 / 255, blue: 0x84 / 255)
    }
    var tileBG: Color {
        self == .anki ? Color(red: 0.11, green: 0.15, blue: 0.24) : Color(red: 0x1D / 255, green: 0x2E / 255, blue: 0x3D / 255)
    }
    // 航海日誌のページは安全な範囲（ノッチ・ホームバー）に合わせないので、アプリ側でその内側に置く
    var fitsSafeArea: Bool { self == .anki }

    // 開くときの URL（extra は ?source=ios に足すもの。例：page=pgStats、view=diary）
    func startURL(_ extra: [URLQueryItem] = []) -> URL {
        var c = URLComponents()
        c.scheme = "https"; c.host = host; c.path = path
        c.queryItems = [URLQueryItem(name: "source", value: "ios")] + extra
        return c.url!
    }

    func owns(_ u: URL) -> Bool { u.host == host && u.path.hasPrefix(path) }
}
