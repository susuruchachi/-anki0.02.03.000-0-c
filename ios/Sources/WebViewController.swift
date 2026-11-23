// ★【0.04.45】ウェブ版を表示する画面と、ページとのやり取り
// ★【0.04.50】ランチャーの中の1つのアプリ（MiniApp）として、すするanki・航海日誌・すする帳簿のどれにも使う
//  ・すするanki：ページに window.SusuruIOS を入れ、ページからは webkit.messageHandlers.susuru に送ってもらう（前と同じ）
//  ・航海日誌・すする帳簿：Android アプリと同じ window.KoukaiApp・window.KashikariApp（setWidgetData・saveFile・googleSignIn・takeLogin）
//    を入れる（ページは変えずにそのまま動く）。ページからは webkit.messageHandlers.koukai・kashikari に届く

import AuthenticationServices
import UIKit
import WebKit
import WidgetKit

final class WebViewController: UIViewController, WKScriptMessageHandler, WKNavigationDelegate, WKUIDelegate, WKDownloadDelegate, ASWebAuthenticationPresentationContextProviding {
    let app: MiniApp
    private var web: WKWebView!
    private var downloadURL: URL?
    private var pendingExtra: [URLQueryItem] = []
    private var lastLoginWarn = Date.distantPast
    private var authSession: ASWebAuthenticationSession?

    init(app: MiniApp) { self.app = app; super.init(nibName: nil, bundle: nil) }
    required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = app.bg
        let conf = WKWebViewConfiguration()
        conf.allowsInlineMediaPlayback = true
        conf.mediaTypesRequiringUserActionForPlayback = []
        conf.websiteDataStore = .default() // 前の版と同じところ（すするanki のこの端末のデータはそのまま）
        let ucc = WKUserContentController()
        ucc.add(WeakHandler(self), name: app.handlerName)
        ucc.addUserScript(WKUserScript(source: app == .anki ? Self.ankiBridgeJS : Self.appBridgeJS(app == .koukai ? "KoukaiApp" : "KashikariApp", app.handlerName), injectionTime: .atDocumentStart, forMainFrameOnly: true))
        conf.userContentController = ucc
        conf.applicationNameForUserAgent = "Mobile/15E148 \(app.uaTag)/\(Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "")"

        web = WKWebView(frame: view.bounds, configuration: conf)
        web.translatesAutoresizingMaskIntoConstraints = false
        web.isOpaque = false
        web.backgroundColor = app.bg
        web.scrollView.backgroundColor = app.bg
        web.scrollView.contentInsetAdjustmentBehavior = .never // すするanki はページが env(safe-area-inset-*) で合わせる
        web.navigationDelegate = self
        web.uiDelegate = self
        web.allowsBackForwardNavigationGestures = false
        if #available(iOS 16.4, *) { web.isInspectable = true }
        view.addSubview(web)
        // 航海日誌のページは安全な範囲に合わせないので、その内側に置く（上下のすきまは背景の色）
        let g = view.safeAreaLayoutGuide
        NSLayoutConstraint.activate([
            web.topAnchor.constraint(equalTo: app.fitsSafeArea ? view.topAnchor : g.topAnchor),
            web.bottomAnchor.constraint(equalTo: app.fitsSafeArea ? view.bottomAnchor : g.bottomAnchor),
            web.leadingAnchor.constraint(equalTo: app.fitsSafeArea ? view.leadingAnchor : g.leadingAnchor),
            web.trailingAnchor.constraint(equalTo: app.fitsSafeArea ? view.trailingAnchor : g.trailingAnchor),
        ])
        web.load(URLRequest(url: app.startURL(pendingExtra)))
        pendingExtra = []

        if app == .anki {
            NotificationCenter.default.addObserver(self, selector: #selector(becameActive), name: UIApplication.didBecomeActiveNotification, object: nil)
        }
    }

    override var preferredStatusBarStyle: UIStatusBarStyle { .lightContent }

    @objc private func becameActive() { Task { await sendStatus() } }

    // ---------------- ランチャー・ウィジェット・通知から：その画面を開く ----------------
    // すするanki：page=pgXxx　航海日誌：view=today|diary|day（day は date=YYYY-MM-DD も）　すする帳簿：view=claims|personal
    func route(_ items: [URLQueryItem]) {
        let q = Dictionary(items.compactMap { i in i.value.map { (i.name, $0) } }, uniquingKeysWith: { a, _ in a })
        var extra: [URLQueryItem] = []
        var js = ""
        switch app {
        case .anki:
            let page = q["page"] ?? ""
            guard page.range(of: "^pg[A-Za-z]+$", options: .regularExpression) != nil else { return }
            extra = [URLQueryItem(name: "page", value: page)]
            js = "try{ if (typeof openPage === 'function') openPage('\(page)'); }catch(e){}"
        case .koukai:
            let view = q["view"] ?? ""
            guard ["today", "diary", "day"].contains(view) else { return }
            let date = (q["date"] ?? "").range(of: "^\\d{4}-\\d{2}-\\d{2}$", options: .regularExpression) != nil ? q["date"]! : ""
            extra = [URLQueryItem(name: "view", value: view)] + (date.isEmpty ? [] : [URLQueryItem(name: "date", value: date)])
            js = "try{ if (typeof window.__koukaiOpen === 'function') window.__koukaiOpen('\(view)', '\(date)'); }catch(e){}"
        case .kashikari:
            let view = q["view"] ?? ""
            guard ["claims", "personal"].contains(view) else { return }
            extra = [URLQueryItem(name: "view", value: view)]
            js = "try{ if (typeof window.__kashikariOpen === 'function') window.__kashikariOpen('\(view)'); }catch(e){}"
        }
        guard isViewLoaded, let web else { pendingExtra = extra; return } // viewDidLoad で、この URL で開く
        if web.isLoading || web.url == nil {
            // まだ読み込み中（開いたばかり）：その画面を開く URL で読み込み直す
            web.load(URLRequest(url: app.startURL(extra)))
        } else {
            web.evaluateJavaScript(js, completionHandler: nil)
        }
    }

    // ---------------- ページに入れるもの ----------------
    // すするanki：window.SusuruIOS（呼ぶと webkit.messageHandlers.susuru に届く）
    static let ankiBridgeJS = """
    (function(){
      if (window.SusuruIOS) return;
      var post = function(cmd, data){ try { window.webkit.messageHandlers.susuru.postMessage({ cmd: cmd, data: data == null ? '' : String(data) }); } catch (e) {} };
      var st = {};
      window.__susuruIOSStatus = function(s){ st = s || {}; try { if (typeof window.onSusuruIOSStatus === 'function') window.onSusuruIOSStatus(st); } catch (e) {} };
      window.SusuruIOS = {
        setAlarms: function(j){ post('setAlarms', j); },
        setWidgetData: function(j){ post('setWidgetData', j); },
        alarmStatus: function(){ return JSON.stringify(st); },
        requestAlarmAuth: function(){ post('requestAuth'); },
        testAlarm: function(t){ post('testAlarm', t || ''); },
        openSettings: function(){ post('openSettings'); },
        refreshStatus: function(){ post('status'); },
        openApp: function(a){ post('openApp', a || ''); }
      };
      post('status');
    })();
    """

    // 航海日誌・すする帳簿：Android アプリと同じ window.KoukaiApp・window.KashikariApp（app-bridge.js・store.js・sync.js が使う）
    //  setWidgetData：ウィジェットに渡す　saveFile：.ics・CSV の書き出し（共有シート）
    //  googleSignIn・googleSignInBrowser：iOS のログインの画面で Google にログイン。結果は takeLogin で受け取る（ページの takeNativeLogin）
    // APK の更新（versionCode・apkPrepare）は入れない
    static func appBridgeJS(_ obj: String, _ handler: String) -> String { """
    (function(){
      if (window.\(obj)) return;
      var post = function(cmd, data){ try { window.webkit.messageHandlers.\(handler).postMessage({ cmd: cmd, data: data == null ? '' : String(data) }); } catch (e) {} };
      window.\(obj) = {
        setWidgetData: function(j){ post('setWidgetData', j); },
        saveFile: function(name, mime, b64){ post('saveFile', JSON.stringify({ name: String(name || ''), mime: String(mime || ''), b64: String(b64 || '') })); return true; },
        googleSignIn: function(){ post('googleSignIn'); },
        googleSignInBrowser: function(){ post('googleSignIn'); },
        takeLogin: function(){ var t = window.__iosLogin || null; window.__iosLogin = null; return t; },
        signOutGoogle: function(){}
      };
      window.SusuruLauncher = { openApp: function(a){ post('openApp', a || ''); } };
    })();
    """ }

    // ---------------- ページから ----------------
    func userContentController(_ ucc: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let body = message.body as? [String: Any], let cmd = body["cmd"] as? String else { return }
        let data = body["data"] as? String ?? ""
        Task { @MainActor in
            if cmd == "openApp" {
                let target = MiniApp(rawValue: data)
                if let u = URL(string: target.map { "susuruanki://open?app=\($0.rawValue)" } ?? "susuruanki://launcher") { Router.open(u) }
                return
            }
            switch app {
            case .anki:
                switch cmd {
                case "setAlarms": await AlarmScheduler.shared.apply(json: data)
                case "setWidgetData": // ★【0.04.47】ウィジェットに渡す
                    if SharedStore.write(data) { WidgetCenter.shared.reloadAllTimelines() }
                    KoukaiNotifier.shared.dataChanged() // 航海日誌の分（koukai）も入っている
                    return
                case "requestAuth": _ = await AlarmScheduler.shared.requestAuth()
                case "testAlarm": await AlarmScheduler.shared.test(title: data)
                case "openSettings": if let u = URL(string: UIApplication.openSettingsURLString) { await UIApplication.shared.open(u) }
                default: break
                }
                await self.sendStatus()
            case .koukai, .kashikari:
                switch cmd {
                case "setWidgetData":
                    if app == .koukai { // ★【0.04.50】航海日誌のページが作ったウィジェットのデータ（koukai.json）
                        if SharedStore.writeKoukai(data) {
                            WidgetCenter.shared.reloadTimelines(ofKind: "KoukaiCalendar")
                            WidgetCenter.shared.reloadTimelines(ofKind: "KoukaiDiary")
                        }
                        KoukaiNotifier.shared.dataChanged()
                    } else if SharedStore.writeKashikari(data) { // ★【0.04.51】すする帳簿（kashikari.json）
                        WidgetCenter.shared.reloadTimelines(ofKind: "Kashikari")
                    }
                case "saveFile": saveFile(json: data)
                case "googleSignIn": startGoogleLogin()
                default: break
                }
            }
        }
    }

    @MainActor private func sendStatus() async {
        guard app == .anki, isViewLoaded, let web else { return }
        var s = await AlarmScheduler.shared.status()
        s["widget"] = SharedStore.fileURL != nil
        guard let d = try? JSONSerialization.data(withJSONObject: s), let j = String(data: d, encoding: .utf8) else { return }
        _ = try? await web.evaluateJavaScript("window.__susuruIOSStatus && window.__susuruIOSStatus(\(j))")
    }

    // ---------------- Google のログイン（★【0.04.51】） ----------------
    // WKWebView の中では Google がログインを許さないので、iOS のログインの画面（Safari と同じもの）で app-login.html を開く。
    // ページが Google にログインしたら susuruanki://auth?state=…&id=…&at=… に移るので、それを受け取ってページに渡す
    private func startGoogleLogin() {
        guard let page = app.loginPage, authSession == nil else { return }
        let chars = Array("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789")
        let state = String((0..<32).map { _ in chars.randomElement()! })
        var c = URLComponents(url: page, resolvingAgainstBaseURL: false)
        c?.fragment = "state=\(state)&ios=1"
        guard let u = c?.url else { return }
        let s = ASWebAuthenticationSession(url: u, callback: .customScheme("susuruanki")) { [weak self] cb, err in
            Task { @MainActor in self?.finishGoogleLogin(cb, err, state) }
        }
        s.presentationContextProvider = self
        s.prefersEphemeralWebBrowserSession = false // Safari でログインしている Google のアカウントを使える
        authSession = s
        if !s.start() { authSession = nil; deliverLogin(["kind": "error", "error": "ログインの画面を開けませんでした"]) }
    }

    private func finishGoogleLogin(_ cb: URL?, _ err: Error?, _ state: String) {
        authSession = nil
        if let cb, let c = URLComponents(url: cb, resolvingAgainstBaseURL: false), c.host == "auth" {
            let q = Dictionary((c.queryItems ?? []).compactMap { i in i.value.map { (i.name, $0) } }, uniquingKeysWith: { a, _ in a })
            if q["state"] == state, let id = q["id"], !id.isEmpty {
                var t = ["idToken": id]
                if let at = q["at"], !at.isEmpty { t["accessToken"] = at }
                deliverLogin(t)
            } else {
                deliverLogin(["kind": "error", "error": "ログインの結果を確かめられませんでした"])
            }
            return
        }
        if let e = err as? ASWebAuthenticationSessionError, e.code == .canceledLogin {
            deliverLogin(["kind": "cancel", "error": "ログインの画面が閉じられました"])
        } else {
            deliverLogin(["kind": "error", "error": err?.localizedDescription ?? "わからないエラー"])
        }
    }

    // ページの takeLogin が返すもの（JSON の文字）を置いて、ページに「届いた」と知らせる
    private func deliverLogin(_ t: [String: String]) {
        guard isViewLoaded, let web, let d = try? JSONSerialization.data(withJSONObject: t), let j = String(data: d, encoding: .utf8) else { return }
        let fn = app.loginArrived
        Task { _ = try? await web.callAsyncJavaScript("window.__iosLogin = t; if (typeof window[fn] === 'function') window[fn]();", arguments: ["t": j, "fn": fn], in: nil, contentWorld: .page) }
    }

    nonisolated func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        MainActor.assumeIsolated { self.view.window ?? ASPresentationAnchor() }
    }

    // ---------------- ページの移動 ----------------
    // Google のログイン（Google がアプリの中の画面でのログインを許さない）：開かずに、ほかのログインの仕方を案内する
    private func isGoogleLogin(_ u: URL) -> Bool {
        let h = u.host ?? ""
        return h == "accounts.google.com" || (h.hasSuffix(".firebaseapp.com") && u.path.hasPrefix("/__/auth/handler"))
    }
    private func warnGoogleLogin() {
        if Date().timeIntervalSince(lastLoginWarn) < 3 { return }
        lastLoginWarn = Date()
        let msg = app == .anki
            ? "アプリの中では Google でログインできません。「📧 メールアドレスでログイン」から入ってください。"
            : "この画面の中では Google でログインできません。もう一度「Google でログイン」を押すと、iOS のログインの画面が開きます（うまくいかないときはメールでログインしてください）。"
        let a = UIAlertController(title: nil, message: msg, preferredStyle: .alert)
        a.addAction(UIAlertAction(title: "OK", style: .default))
        presentSafely(a) {}
    }

    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, preferences: WKWebpagePreferences) async -> (WKNavigationActionPolicy, WKWebpagePreferences) {
        if action.shouldPerformDownload { return (.download, preferences) }
        guard let u = action.request.url else { return (.allow, preferences) }
        let main = action.targetFrame?.isMainFrame ?? true
        if main, isGoogleLogin(u) { warnGoogleLogin(); return (.cancel, preferences) }
        // ほかのサイトへのリンクは Safari で開く（ログインや Firebase の裏の通信は、ページの中のまま）
        if main, ["http", "https"].contains(u.scheme ?? ""), !app.owns(u), action.navigationType == .linkActivated {
            if let other = MiniApp.allCases.first(where: { $0 != app && $0.owns(u) }) {
                // もう1つのアプリへのリンク（すするanki ⇄ 航海日誌）：ランチャーの中で切りかえる
                if let u = URL(string: "susuruanki://open?app=\(other.rawValue)") { Router.open(u) }
            } else {
                await UIApplication.shared.open(u)
            }
            return (.cancel, preferences)
        }
        if !["http", "https", "about", "blob", "data"].contains(u.scheme ?? "") {
            await UIApplication.shared.open(u)
            return (.cancel, preferences)
        }
        return (.allow, preferences)
    }

    func webView(_ webView: WKWebView, decidePolicyFor response: WKNavigationResponse) async -> WKNavigationResponsePolicy {
        response.canShowMIMEType ? .allow : .download
    }

    // window.open・target="_blank"：自分のページなら同じ画面で、ほかは Safari で
    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if let u = action.request.url {
            if isGoogleLogin(u) { warnGoogleLogin() }
            else if app.owns(u) { webView.load(action.request) }
            else if u.scheme == "http" || u.scheme == "https" { UIApplication.shared.open(u) }
        }
        return nil
    }

    // 見えていない・ほかの画面を出しているときは出さない（出せないと、ページが待ったままになるので）
    private func presentSafely(_ vc: UIViewController, onFail: () -> Void) {
        guard viewIfLoaded?.window != nil, presentedViewController == nil else { onFail(); return }
        present(vc, animated: true)
    }

    // alert / confirm / prompt
    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo) async {
        await withCheckedContinuation { (c: CheckedContinuation<Void, Never>) in
            let a = UIAlertController(title: nil, message: message, preferredStyle: .alert)
            a.addAction(UIAlertAction(title: "OK", style: .default) { _ in c.resume() })
            presentSafely(a) { c.resume() }
        }
    }
    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo) async -> Bool {
        await withCheckedContinuation { (c: CheckedContinuation<Bool, Never>) in
            let a = UIAlertController(title: nil, message: message, preferredStyle: .alert)
            a.addAction(UIAlertAction(title: "キャンセル", style: .cancel) { _ in c.resume(returning: false) })
            a.addAction(UIAlertAction(title: "OK", style: .default) { _ in c.resume(returning: true) })
            presentSafely(a) { c.resume(returning: false) }
        }
    }
    func webView(_ webView: WKWebView, runJavaScriptTextInputPanelWithPrompt prompt: String, defaultText: String?, initiatedByFrame frame: WKFrameInfo) async -> String? {
        await withCheckedContinuation { (c: CheckedContinuation<String?, Never>) in
            let a = UIAlertController(title: nil, message: prompt, preferredStyle: .alert)
            a.addTextField { $0.text = defaultText }
            a.addAction(UIAlertAction(title: "キャンセル", style: .cancel) { _ in c.resume(returning: nil) })
            a.addAction(UIAlertAction(title: "OK", style: .default) { _ in c.resume(returning: a.textFields?.first?.text ?? "") })
            presentSafely(a) { c.resume(returning: nil) }
        }
    }

    // ページが落ちたら読み直す
    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) { webView.reload() }

    // ---------------- ファイルの保存（エクスポート） ----------------
    func webView(_ webView: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload) { download.delegate = self }
    func webView(_ webView: WKWebView, navigationResponse: WKNavigationResponse, didBecome download: WKDownload) { download.delegate = self }

    private func tempFileURL(_ name: String) -> URL {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("dl-\(UUID().uuidString)", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let safe = name.replacingOccurrences(of: "/", with: "_").trimmingCharacters(in: .whitespaces)
        return dir.appendingPathComponent(safe.isEmpty ? app.rawValue : safe)
    }

    func download(_ download: WKDownload, decideDestinationUsing response: URLResponse, suggestedFilename: String) async -> URL? {
        let u = tempFileURL(suggestedFilename)
        downloadURL = u
        return u
    }
    func downloadDidFinish(_ download: WKDownload) { if let u = downloadURL { share(u) } }
    func download(_ download: WKDownload, didFailWithError error: Error, resumeData: Data?) { saveFailed() }

    // 航海日誌の KoukaiApp.saveFile（.ics の書き出しなど）：共有シートで「ファイルに保存」など
    private func saveFile(json: String) {
        guard let d = json.data(using: .utf8),
              let o = (try? JSONSerialization.jsonObject(with: d)) as? [String: Any],
              let b64 = o["b64"] as? String, let bytes = Data(base64Encoded: b64) else { saveFailed(); return }
        let u = tempFileURL(o["name"] as? String ?? "")
        do { try bytes.write(to: u, options: .atomic); share(u) } catch { saveFailed() }
    }

    private func share(_ u: URL) {
        let vc = UIActivityViewController(activityItems: [u], applicationActivities: nil)
        if let p = vc.popoverPresentationController { p.sourceView = view; p.sourceRect = CGRect(x: view.bounds.midX, y: view.bounds.midY, width: 1, height: 1); p.permittedArrowDirections = [] }
        presentSafely(vc) {}
    }
    private func saveFailed() {
        let a = UIAlertController(title: nil, message: "保存できませんでした", preferredStyle: .alert)
        a.addAction(UIAlertAction(title: "OK", style: .default))
        presentSafely(a) {}
    }
}

// WKUserContentController が強く持つので、間に挟んで循環しないようにする
final class WeakHandler: NSObject, WKScriptMessageHandler {
    weak var target: WKScriptMessageHandler?
    init(_ t: WKScriptMessageHandler) { target = t }
    func userContentController(_ ucc: WKUserContentController, didReceive message: WKScriptMessage) { target?.userContentController(ucc, didReceive: message) }
}
