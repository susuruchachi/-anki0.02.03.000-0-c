// ★【0.04.45】すするanki の iOS・iPadOS アプリ
// ★【0.04.50】ランチャーにした：すするanki と航海日誌を、1つのアプリの中で別々のアプリとして使う（LauncherController）。
// 無料の Apple ID（iloader・SideStore）で7日ごとに入れ直すのが1つで済む。バンドル ID は前と同じなので、上から入れればすするanki のデータはそのまま
// 中身はどちらもウェブ版を WKWebView で表示する。アプリならではのもの：
//  ・⏰ アラーム（AlarmKit）：すするanki の連続記録・予定の前
//  ・🔔 通知：航海日誌の予定の前・終日の予定・できた事日記（KoukaiNotifier）
//  ・🧩 ウィジェット：すするanki（連続記録・カレンダー・大事な予定・ランキング）・航海日誌（カレンダー・できた事日記）
//  ・ファイルの保存（エクスポート）：共有シートで「ファイルに保存」など
//  ・ホーム画面のアイコンの長押し：すするanki・航海日誌・ランチャーをすぐ開く

import SwiftUI
import UIKit
import UserNotifications

@main
struct SusuruAnkiApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) var appDelegate
    var body: some Scene {
        WindowGroup {
            RootScreen()
                .ignoresSafeArea()
                .background(Color(red: 8 / 255, green: 12 / 255, blue: 20 / 255))
                .preferredColorScheme(.dark)
                .onOpenURL { Router.open($0) } // ウィジェットから（susuruanki://open?app=…）
        }
    }
}

struct RootScreen: UIViewControllerRepresentable {
    func makeUIViewController(context: Context) -> LauncherController { LauncherController() }
    func updateUIViewController(_ vc: LauncherController, context: Context) {}
}

// ウィジェット・通知・アイコンの長押し・ページから来た「開いて」を、ランチャーに渡す（ランチャーがまだできていなければ、できてから）
@MainActor
enum Router {
    static var pending: URL?
    static var handler: ((URL) -> Void)? {
        didSet { if let h = handler, let p = pending { pending = nil; h(p) } }
    }
    static func open(_ u: URL) { if let h = handler { h(u) } else { pending = u } }
    static func shortcut(_ item: UIApplicationShortcutItem) {
        let s = MiniApp(rawValue: item.type).map { "susuruanki://open?app=\($0.rawValue)" } ?? "susuruanki://launcher"
        if let u = URL(string: s) { open(u) }
    }
}

final class AppDelegate: NSObject, UIApplicationDelegate {
    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
        UNUserNotificationCenter.current().delegate = NotificationHandler.shared // 通知を押して開いたとき（閉じていても）に受け取れるよう、はじめに
        return true
    }

    // アイコンの長押しのメニュー（閉じていたとき）
    func application(_ application: UIApplication, configurationForConnecting session: UISceneSession, options: UIScene.ConnectionOptions) -> UISceneConfiguration {
        if let item = options.shortcutItem { Router.shortcut(item) }
        let c = UISceneConfiguration(name: nil, sessionRole: session.role)
        c.delegateClass = SceneDelegate.self
        return c
    }
}

final class NotificationHandler: NSObject, UNUserNotificationCenterDelegate {
    static let shared = NotificationHandler()
    // アプリを開いているときも通知を出す
    func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification, withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void) {
        completionHandler([.banner, .list, .sound])
    }
    // 通知を押したとき：その画面を開く
    func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse, withCompletionHandler completionHandler: @escaping () -> Void) {
        if let s = response.notification.request.content.userInfo["open"] as? String, let u = URL(string: s) {
            Task { @MainActor in Router.open(u) }
        }
        completionHandler()
    }
}

final class SceneDelegate: NSObject, UIWindowSceneDelegate {
    // アイコンの長押しのメニュー（開いていたとき）
    func windowScene(_ windowScene: UIWindowScene, performActionFor shortcutItem: UIApplicationShortcutItem, completionHandler: @escaping (Bool) -> Void) {
        Router.shortcut(shortcutItem)
        completionHandler(true)
    }
}
