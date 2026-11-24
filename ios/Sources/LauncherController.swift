// ★【0.04.50】ランチャー：すするanki と航海日誌（★【0.04.51】とすする帳簿）を、1つのアプリの中で別々のアプリとして使う
//  ・はじめはランチャーの画面（LauncherHome）。押したアプリを全画面で出す（設定で「前に開いていたアプリをすぐ出す」にもできる）
//  ・アプリを出しているときは、上に細いバー（AppBar。★【0.04.53】前の動かせる ▦ ボタンの代わり）：「ランチャー」で戻る・右のボタンでほかのアプリへ
//  ・アプリはどれも開いたまま裏に置いておく（切りかえてもそのまま。開いたときに、ほかのものも裏で読み込む＝ウィジェット・通知のデータが新しくなる）

import SwiftUI
import UIKit

final class LauncherController: UIViewController {
    private var webs: [MiniApp: WebViewController] = [:]
    private lazy var model = LauncherModel()
    private var home: UIHostingController<LauncherHome>!
    private let bar = AppBar()
    private let appArea = UIView() // アプリの画面を置くところ（バーの下）
    private(set) var current: MiniApp?
    private let lastKey = "launcher_last_app"

    override var preferredStatusBarStyle: UIStatusBarStyle { .lightContent }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = MiniApp.anki.bg

        // バーとその下のアプリの画面（ランチャーの画面はその上にかぶせる）
        appArea.backgroundColor = .clear
        bar.translatesAutoresizingMaskIntoConstraints = false
        appArea.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(appArea)
        view.addSubview(bar)
        NSLayoutConstraint.activate([
            bar.topAnchor.constraint(equalTo: view.topAnchor),
            bar.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            bar.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            bar.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor, constant: AppBar.height),
            appArea.topAnchor.constraint(equalTo: bar.bottomAnchor),
            appArea.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            appArea.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            appArea.bottomAnchor.constraint(equalTo: view.bottomAnchor),
        ])
        bar.onHome = { [weak self] in self?.show(nil) }
        bar.onPick = { [weak self] in self?.show($0) }
        bar.isHidden = true

        home = UIHostingController(rootView: LauncherHome(model: model, open: { [weak self] in self?.show($0) }))
        home.view.backgroundColor = .clear
        addChild(home)
        home.view.frame = view.bounds
        home.view.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        view.addSubview(home.view)
        home.didMove(toParent: self)

        // はじめの画面：ウィジェット・通知などから開いたなら、そのあと Router がそれを出す
        let last = UserDefaults.standard.string(forKey: lastKey).flatMap(MiniApp.init(rawValue:))
        show(Router.pending == nil && model.autoOpenLast ? last : nil, animated: false)
        Router.handler = { [weak self] in self?.handle($0) }

        // ほか（まだ開いていないもの）も、少ししてから裏で読み込んでおく
        DispatchQueue.main.asyncAfter(deadline: .now() + 2) { [weak self] in
            for a in MiniApp.allCases { _ = self?.web(a) }
        }
        NotificationCenter.default.addObserver(self, selector: #selector(becameActive), name: UIApplication.didBecomeActiveNotification, object: nil)
    }

    @objc private func becameActive() {
        KoukaiNotifier.shared.dataChanged() // 日付が変わっていたら、通知を入れ直す
        if current == nil { model.refresh() }
    }

    // そのアプリの画面（無ければ作って、いちばん下に置く。items はそのアプリで開く画面）
    @discardableResult
    private func web(_ a: MiniApp, route items: [URLQueryItem] = []) -> WebViewController {
        if let v = webs[a] { if !items.isEmpty { v.route(items) }; return v }
        let v = WebViewController(app: a)
        if !items.isEmpty { v.route(items) } // まだ読み込む前なので、はじめからその画面の URL で開く
        webs[a] = v
        addChild(v)
        v.view.translatesAutoresizingMaskIntoConstraints = false
        v.view.isHidden = current != a
        appArea.addSubview(v.view)
        NSLayoutConstraint.activate([
            v.view.topAnchor.constraint(equalTo: appArea.topAnchor),
            v.view.bottomAnchor.constraint(equalTo: appArea.bottomAnchor),
            v.view.leadingAnchor.constraint(equalTo: appArea.leadingAnchor),
            v.view.trailingAnchor.constraint(equalTo: appArea.trailingAnchor),
        ])
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
            self.bar.isHidden = a == nil
        }
        if let a { bar.configure(a) }
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

// ---------------- 上の細いバー（★【0.04.53】） ----------------
// 左：「ランチャー」（押すとランチャーの画面）　右：ほかのアプリ（押すとすぐ切りかえ）
// 前は画面のはしに動かせる ▦ ボタンだったが、ページにかぶって邪魔なので、ページの上に固定したバーにした（ページはバーの下に出る）
final class AppBar: UIView {
    static let height: CGFloat = 38
    var onHome: (() -> Void)?
    var onPick: ((MiniApp) -> Void)?
    private let stack = UIStackView()
    private let line = UIView()

    override init(frame: CGRect) {
        super.init(frame: frame)
        stack.axis = .horizontal
        stack.alignment = .center
        stack.spacing = 6
        stack.translatesAutoresizingMaskIntoConstraints = false
        addSubview(stack)
        line.translatesAutoresizingMaskIntoConstraints = false
        line.backgroundColor = UIColor(white: 1, alpha: 0.08)
        addSubview(line)
        let g = safeAreaLayoutGuide
        NSLayoutConstraint.activate([
            stack.leadingAnchor.constraint(equalTo: g.leadingAnchor, constant: 8),
            stack.trailingAnchor.constraint(equalTo: g.trailingAnchor, constant: -8),
            stack.bottomAnchor.constraint(equalTo: bottomAnchor),
            stack.heightAnchor.constraint(equalToConstant: AppBar.height),
            line.leadingAnchor.constraint(equalTo: leadingAnchor),
            line.trailingAnchor.constraint(equalTo: trailingAnchor),
            line.bottomAnchor.constraint(equalTo: bottomAnchor),
            line.heightAnchor.constraint(equalToConstant: 1 / UIScreen.main.scale),
        ])
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    private func button(_ title: String, symbol: String?, color: UIColor, bold: Bool, filled: Bool, action: @escaping () -> Void) -> UIButton {
        var c = filled ? UIButton.Configuration.filled() : UIButton.Configuration.plain()
        c.title = title
        if let symbol { c.image = UIImage(systemName: symbol, withConfiguration: UIImage.SymbolConfiguration(pointSize: 13, weight: .semibold)); c.imagePadding = 5 }
        c.baseForegroundColor = color
        if filled { c.baseBackgroundColor = UIColor(white: 1, alpha: 0.08) }
        c.cornerStyle = .capsule
        c.contentInsets = NSDirectionalEdgeInsets(top: 5, leading: 10, bottom: 5, trailing: 10)
        c.titleTextAttributesTransformer = UIConfigurationTextAttributesTransformer { a in
            var a = a; a.font = UIFont.systemFont(ofSize: 13, weight: bold ? .semibold : .regular); return a
        }
        let b = UIButton(configuration: c, primaryAction: UIAction { _ in action() })
        b.setContentCompressionResistancePriority(.required, for: .horizontal)
        return b
    }

    // 出しているアプリに合わせて、色とボタンを作り直す
    func configure(_ current: MiniApp) {
        backgroundColor = current.bg
        stack.arrangedSubviews.forEach { $0.removeFromSuperview() }
        let gold = UIColor(red: 0xE3 / 255, green: 0xC3 / 255, blue: 0x84 / 255, alpha: 1)
        let home = button("ランチャー", symbol: "square.grid.2x2.fill", color: gold, bold: true, filled: false) { [weak self] in self?.onHome?() }
        home.accessibilityHint = "ランチャーの画面に戻ります"
        stack.addArrangedSubview(home)
        let spacer = UIView()
        spacer.setContentHuggingPriority(.defaultLow, for: .horizontal)
        stack.addArrangedSubview(spacer)
        for a in MiniApp.allCases where a != current {
            stack.addArrangedSubview(button("\(a.emoji) \(a.title)", symbol: nil, color: UIColor(white: 0.92, alpha: 1), bold: false, filled: true) { [weak self] in self?.onPick?(a) })
        }
    }
}
