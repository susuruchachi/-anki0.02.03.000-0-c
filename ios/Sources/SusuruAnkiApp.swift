// ★【0.04.45】すするanki の iOS・iPadOS アプリ
// 中身はウェブ版（GitHub Pages）を WKWebView で表示する。アプリならではのもの：
//  ・⏰ アラーム（AlarmKit）：連続記録（今日まだ解いていなければ、解くまで何度も）・予定の前
//  ・ファイルの保存（エクスポート）：共有シートで「ファイルに保存」など
// ウェブ版とのやり取り：ページに window.SusuruIOS を入れ、ページからは webkit.messageHandlers.susuru に送ってもらう

import SwiftUI
import UIKit

@main
struct SusuruAnkiApp: App {
    var body: some Scene {
        WindowGroup {
            WebScreen()
                .ignoresSafeArea()
                .background(Color(red: 8 / 255, green: 12 / 255, blue: 20 / 255))
                .preferredColorScheme(.dark)
                .onOpenURL { NotificationCenter.default.post(name: .susuruOpenURL, object: $0) } // ★【0.04.47】ウィジェットから
        }
    }
}

struct WebScreen: UIViewControllerRepresentable {
    func makeUIViewController(context: Context) -> WebViewController { WebViewController() }
    func updateUIViewController(_ vc: WebViewController, context: Context) {}
}
