// ★【0.04.50】ランチャー：すするanki と航海日誌を、1つのアプリの中で別々のアプリとして使う
//  ・はじめはランチャーの画面（LauncherHome）。押したアプリを全画面で出す（設定で「前に開いていたアプリをすぐ出す」にもできる）
//  ・アプリを出しているときは、画面のはしに小さな ▦ ボタン（SwitcherButton）：押すとランチャー、長押しでもう1つのアプリへ、ドラッグで動かせる
//  ・2つのアプリはどちらも開いたまま裏に置いておく（切りかえてもそのまま。開いたときに、もう1つも裏で読み込む＝ウィジェット・通知のデータが新しくなる）

import SwiftUI
import UIKit

final class LauncherController: UIViewController {
    private var webs: [MiniApp: WebViewController] = [:]
    private lazy var model = LauncherModel()
    private var home: UIHostingController<LauncherHome>!
    private lazy var switcher = SwitcherButton()
    private(set) var current: MiniApp?
    private let lastKey = "launcher_last_app"

    override var preferredStatusBarStyle: UIStatusBarStyle { .lightContent }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = MiniApp.anki.bg

        home = UIHostingController(rootView: LauncherHome(model: model, open: { [weak self] in self?.show($0) }))
        home.view.backgroundColor = .clear
        addChild(home)
        home.view.frame = view.bounds
        home.view.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        view.addSubview(home.view)
        home.didMove(toParent: self)

        switcher.onHome = { [weak self] in self?.show(nil) }
        switcher.onPick = { [weak self] in self?.show($0) }
        switcher.isHidden = true
        view.addSubview(switcher)

        // はじめの画面：ウィジェット・通知などから開いたなら、そのあと Router がそれを出す
        let last = UserDefaults.standard.string(forKey: lastKey).flatMap(MiniApp.init(rawValue:))
        show(Router.pending == nil && model.autoOpenLast ? last : nil, animated: false)
        Router.handler = { [weak self] in self?.handle($0) }

        // もう1つ（まだ開いていないもの）も、少ししてから裏で読み込んでおく
        DispatchQueue.main.asyncAfter(deadline: .now() + 2) { [weak self] in
            for a in MiniApp.allCases { _ = self?.web(a) }
        }
        NotificationCenter.default.addObserver(self, selector: #selector(becameActive), name: UIApplication.didBecomeActiveNotification, object: nil)
    }

    @objc private func becameActive() {
        KoukaiNotifier.shared.dataChanged() // 日付が変わっていたら、通知を入れ直す
        if current == nil { model.refresh() }
    }

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        switcher.place(in: view)
    }

    // そのアプリの画面（無ければ作って、いちばん下に置く。items はそのアプリで開く画面）
    @discardableResult
    private func web(_ a: MiniApp, route items: [URLQueryItem] = []) -> WebViewController {
        if let v = webs[a] { if !items.isEmpty { v.route(items) }; return v }
        let v = WebViewController(app: a)
        if !items.isEmpty { v.route(items) } // まだ読み込む前なので、はじめからその画面の URL で開く
        webs[a] = v
        addChild(v)
        v.view.frame = view.bounds
        v.view.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        v.view.isHidden = current != a
        view.insertSubview(v.view, at: 0)
        v.didMove(toParent: self)
        return v
    }

    // a が nil ならランチャーの画面
    func show(_ a: MiniApp?, animated: Bool = true) {
        if let a { web(a) }
        if a != current { view.endEditing(true) }
        current = a
        if let a { UserDefaults.standard.set(a.rawValue, forKey: lastKey) } else { model.refresh() }
        let apply = {
            for (k, v) in self.webs { v.view.isHidden = k != a }
            self.home.view.isHidden = a != nil
            self.switcher.isHidden = a == nil
        }
        switcher.current = a
        view.bringSubviewToFront(switcher)
        if animated, view.window != nil {
            UIView.transition(with: view, duration: 0.22, options: [.transitionCrossDissolve, .allowUserInteraction], animations: apply)
        } else {
            apply()
        }
        setNeedsStatusBarAppearanceUpdate()
    }

    // susuruanki://open?app=anki&page=pgXxx ・ susuruanki://open?app=koukai&view=diary ・ susuruanki://launcher
    // 前の版のウィジェット：susuruanki://open?page=…（すするanki）・https://koukai-nisshi-calendar.vercel.app/?view=…（航海日誌）
    private func handle(_ u: URL) {
        guard let c = URLComponents(url: u, resolvingAgainstBaseURL: false) else { return }
        let items = (c.queryItems ?? []).filter { $0.name != "app" }
        if u.scheme == "https" || u.scheme == "http" {
            if let a = MiniApp.allCases.first(where: { $0.owns(u) }) { web(a, route: items); show(a) } else { UIApplication.shared.open(u) }
            return
        }
        guard u.scheme == "susuruanki" else { return }
        if c.host == "launcher" { show(nil); return }
        let name = c.queryItems?.first(where: { $0.name == "app" })?.value ?? MiniApp.anki.rawValue
        guard let a = MiniApp(rawValue: name) else { return }
        web(a, route: items)
        show(a)
    }
}

// ---------------- 画面のはしの ▦ ボタン ----------------
final class SwitcherButton: UIButton {
    var onHome: (() -> Void)?
    var onPick: ((MiniApp) -> Void)?
    var current: MiniApp? { didSet { updateMenu() } }
    private let side: CGFloat = 42
    private let posKey = "launcher_switcher_pos" // [右なら1・左なら0, 上からの割合]
    private var dragging = false
    private let idleAlpha: CGFloat = 0.45

    init() {
        super.init(frame: CGRect(x: 0, y: 0, width: 42, height: 42))
        var cfg = UIButton.Configuration.filled()
        cfg.image = UIImage(systemName: "square.grid.2x2.fill", withConfiguration: UIImage.SymbolConfiguration(pointSize: 16, weight: .semibold))
        cfg.baseBackgroundColor = UIColor(white: 0.12, alpha: 0.9)
        cfg.baseForegroundColor = .white
        cfg.cornerStyle = .capsule
        configuration = cfg
        alpha = idleAlpha
        layer.shadowColor = UIColor.black.cgColor
        layer.shadowOpacity = 0.35
        layer.shadowRadius = 4
        layer.shadowOffset = CGSize(width: 0, height: 2)
        accessibilityLabel = "ランチャー"
        accessibilityHint = "長押しで、ほかのアプリに切りかえます"
        addAction(UIAction { [weak self] _ in self?.onHome?() }, for: .primaryActionTriggered)
        showsMenuAsPrimaryAction = false // 押す：ランチャー　長押し：メニュー
        addGestureRecognizer(UIPanGestureRecognizer(target: self, action: #selector(drag(_:))))
        updateMenu()
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    override var isHighlighted: Bool { didSet { if !dragging { alpha = isHighlighted ? 1 : idleAlpha } } }

    private func updateMenu() {
        var items: [UIMenuElement] = MiniApp.allCases.filter { $0 != current }.map { a in
            UIAction(title: "\(a.emoji) \(a.title)") { [weak self] _ in self?.onPick?(a) }
        }
        items.append(UIAction(title: "ランチャー", image: UIImage(systemName: "square.grid.2x2")) { [weak self] _ in self?.onHome?() })
        menu = UIMenu(children: items)
    }

    private var saved: (right: Bool, y: CGFloat) {
        let a = UserDefaults.standard.array(forKey: posKey) as? [Double] ?? []
        return a.count == 2 ? (a[0] > 0.5, CGFloat(a[1])) : (true, 0.68)
    }

    func place(in container: UIView) {
        guard !dragging else { return }
        let s = saved
        let r = container.bounds.inset(by: container.safeAreaInsets).insetBy(dx: 4, dy: 8)
        let x = s.right ? r.maxX - side : r.minX
        let y = r.minY + min(max(s.y, 0), 1) * max(0, r.height - side)
        frame = CGRect(x: x, y: y, width: side, height: side)
    }

    @objc private func drag(_ g: UIPanGestureRecognizer) {
        guard let sv = superview else { return }
        switch g.state {
        case .began:
            dragging = true; alpha = 1
        case .changed:
            let t = g.translation(in: sv)
            center = CGPoint(x: center.x + t.x, y: center.y + t.y)
            g.setTranslation(.zero, in: sv)
        default:
            let r = sv.bounds.inset(by: sv.safeAreaInsets).insetBy(dx: 4, dy: 8)
            let right = center.x > sv.bounds.midX
            let y = r.height > side ? (frame.minY - r.minY) / (r.height - side) : 0
            UserDefaults.standard.set([right ? 1.0 : 0.0, Double(min(max(y, 0), 1))], forKey: posKey)
            dragging = false
            UIView.animate(withDuration: 0.2) { self.place(in: sv); self.alpha = self.idleAlpha }
        }
    }
}
