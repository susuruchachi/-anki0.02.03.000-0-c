// ★【0.04.45】ウェブ版を表示する画面と、ページとのやり取り

import UIKit
import WebKit
import WidgetKit

final class WebViewController: UIViewController, WKScriptMessageHandler, WKNavigationDelegate, WKUIDelegate, WKDownloadDelegate {
    static let host = "susuruchachi.github.io"
    static let path = "/-anki0.02.03.000-0-c/"
    static var startURL: URL { URL(string: "https://\(host)\(path)?source=ios")! }

    private var web: WKWebView!
    private var downloadURL: URL?
    private let bg = UIColor(red: 8 / 255, green: 12 / 255, blue: 20 / 255, alpha: 1)

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = bg
        let conf = WKWebViewConfiguration()
        conf.allowsInlineMediaPlayback = true
        conf.mediaTypesRequiringUserActionForPlayback = []
        conf.websiteDataStore = .default()
        let ucc = WKUserContentController()
        ucc.add(WeakHandler(self), name: "susuru")
        ucc.addUserScript(WKUserScript(source: Self.bridgeJS, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        conf.userContentController = ucc
        conf.applicationNameForUserAgent = "Mobile/15E148 SusuruAnkiIOS/\(Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "")"

        web = WKWebView(frame: view.bounds, configuration: conf)
        web.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        web.isOpaque = false
        web.backgroundColor = bg
        web.scrollView.backgroundColor = bg
        web.scrollView.contentInsetAdjustmentBehavior = .never // ページが env(safe-area-inset-*) で合わせる
        web.navigationDelegate = self
        web.uiDelegate = self
        web.allowsBackForwardNavigationGestures = false
        if #available(iOS 16.4, *) { web.isInspectable = true }
        view.addSubview(web)
        web.load(URLRequest(url: Self.startURL))

        NotificationCenter.default.addObserver(self, selector: #selector(becameActive), name: UIApplication.didBecomeActiveNotification, object: nil)
        NotificationCenter.default.addObserver(self, selector: #selector(openFromWidget(_:)), name: .susuruOpenURL, object: nil)
    }

    // ★【0.04.47】ウィジェットを押したとき（susuruanki://open?page=…）：そのページを開く
    @objc private func openFromWidget(_ n: Notification) {
        guard let u = n.object as? URL, let c = URLComponents(url: u, resolvingAgainstBaseURL: false) else { return }
        // ★【0.04.49】航海日誌のウィジェット：Safari で航海日誌を開く
        if u.scheme == "https" { UIApplication.shared.open(u); return }
        let page = c.queryItems?.first(where: { $0.name == "page" })?.value ?? ""
        let safe = page.range(of: "^pg[A-Za-z]+$", options: .regularExpression) != nil ? page : ""
        if safe.isEmpty { return }
        if web.isLoading || web.url == nil {
            // まだ読み込み中（ウィジェットから開いたばかり）：そのページを開く URL で読み込み直す
            web.load(URLRequest(url: URL(string: "https://\(Self.host)\(Self.path)?source=ios&page=\(safe)")!))
        } else {
            web.evaluateJavaScript("try{ if (typeof openPage === 'function') openPage('\(safe)'); }catch(e){}", completionHandler: nil)
        }
    }

    override var preferredStatusBarStyle: UIStatusBarStyle { .lightContent }

    @objc private func becameActive() { Task { await sendStatus() } }

    // ページに入れる window.SusuruIOS（呼ぶと webkit.messageHandlers.susuru に届く）
    static let bridgeJS = """
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
        refreshStatus: function(){ post('status'); }
      };
      post('status');
    })();
    """

    // ---------------- ページから ----------------
    func userContentController(_ ucc: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let body = message.body as? [String: Any], let cmd = body["cmd"] as? String else { return }
        let data = body["data"] as? String ?? ""
        Task { @MainActor in
            switch cmd {
            case "setAlarms": await AlarmScheduler.shared.apply(json: data)
            case "setWidgetData": // ★【0.04.47】ウィジェットに渡す
                if SharedStore.write(data) { WidgetCenter.shared.reloadAllTimelines() }
                return
            case "requestAuth": _ = await AlarmScheduler.shared.requestAuth()
            case "testAlarm": await AlarmScheduler.shared.test(title: data)
            case "openSettings": if let u = URL(string: UIApplication.openSettingsURLString) { await UIApplication.shared.open(u) }
            default: break
            }
            await self.sendStatus()
        }
    }

    @MainActor private func sendStatus() async {
        var s = await AlarmScheduler.shared.status()
        s["widget"] = SharedStore.fileURL != nil
        guard let d = try? JSONSerialization.data(withJSONObject: s), let j = String(data: d, encoding: .utf8) else { return }
        _ = try? await web.evaluateJavaScript("window.__susuruIOSStatus && window.__susuruIOSStatus(\(j))")
    }

    // ---------------- ページの移動 ----------------
    private func isOwn(_ u: URL) -> Bool { u.host == Self.host && u.path.hasPrefix(Self.path) }

    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, preferences: WKWebpagePreferences) async -> (WKNavigationActionPolicy, WKWebpagePreferences) {
        if action.shouldPerformDownload { return (.download, preferences) }
        guard let u = action.request.url else { return (.allow, preferences) }
        let main = action.targetFrame?.isMainFrame ?? true
        // ほかのサイトへのリンクは Safari で開く（ログインや Firebase の裏の通信は、ページの中のまま）
        if main, ["http", "https"].contains(u.scheme ?? ""), !isOwn(u), action.navigationType == .linkActivated {
            await UIApplication.shared.open(u)
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
            if isOwn(u) { webView.load(action.request) } else if u.scheme == "http" || u.scheme == "https" { UIApplication.shared.open(u) }
        }
        return nil
    }

    // alert / confirm / prompt
    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo) async {
        await withCheckedContinuation { (c: CheckedContinuation<Void, Never>) in
            let a = UIAlertController(title: nil, message: message, preferredStyle: .alert)
            a.addAction(UIAlertAction(title: "OK", style: .default) { _ in c.resume() })
            present(a, animated: true)
        }
    }
    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo) async -> Bool {
        await withCheckedContinuation { (c: CheckedContinuation<Bool, Never>) in
            let a = UIAlertController(title: nil, message: message, preferredStyle: .alert)
            a.addAction(UIAlertAction(title: "キャンセル", style: .cancel) { _ in c.resume(returning: false) })
            a.addAction(UIAlertAction(title: "OK", style: .default) { _ in c.resume(returning: true) })
            present(a, animated: true)
        }
    }
    func webView(_ webView: WKWebView, runJavaScriptTextInputPanelWithPrompt prompt: String, defaultText: String?, initiatedByFrame frame: WKFrameInfo) async -> String? {
        await withCheckedContinuation { (c: CheckedContinuation<String?, Never>) in
            let a = UIAlertController(title: nil, message: prompt, preferredStyle: .alert)
            a.addTextField { $0.text = defaultText }
            a.addAction(UIAlertAction(title: "キャンセル", style: .cancel) { _ in c.resume(returning: nil) })
            a.addAction(UIAlertAction(title: "OK", style: .default) { _ in c.resume(returning: a.textFields?.first?.text ?? "") })
            present(a, animated: true)
        }
    }

    // ページが落ちたら読み直す
    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) { webView.reload() }

    // ---------------- ファイルの保存（エクスポート） ----------------
    func webView(_ webView: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload) { download.delegate = self }
    func webView(_ webView: WKWebView, navigationResponse: WKNavigationResponse, didBecome download: WKDownload) { download.delegate = self }

    func download(_ download: WKDownload, decideDestinationUsing response: URLResponse, suggestedFilename: String) async -> URL? {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("dl-\(UUID().uuidString)", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let u = dir.appendingPathComponent(suggestedFilename.isEmpty ? "susuruanki" : suggestedFilename)
        downloadURL = u
        return u
    }
    func downloadDidFinish(_ download: WKDownload) {
        guard let u = downloadURL else { return }
        let vc = UIActivityViewController(activityItems: [u], applicationActivities: nil)
        if let p = vc.popoverPresentationController { p.sourceView = view; p.sourceRect = CGRect(x: view.bounds.midX, y: view.bounds.midY, width: 1, height: 1); p.permittedArrowDirections = [] }
        present(vc, animated: true)
    }
    func download(_ download: WKDownload, didFailWithError error: Error, resumeData: Data?) {
        let a = UIAlertController(title: nil, message: "保存できませんでした", preferredStyle: .alert)
        a.addAction(UIAlertAction(title: "OK", style: .default))
        present(a, animated: true)
    }
}

// WKUserContentController が強く持つので、間に挟んで循環しないようにする
final class WeakHandler: NSObject, WKScriptMessageHandler {
    weak var target: WKScriptMessageHandler?
    init(_ t: WKScriptMessageHandler) { target = t }
    func userContentController(_ ucc: WKUserContentController, didReceive message: WKScriptMessage) { target?.userContentController(ucc, didReceive: message) }
}

extension Notification.Name { static let susuruOpenURL = Notification.Name("susuruOpenURL") }
