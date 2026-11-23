// ★【0.04.47】アプリとウィジェットで分け合うデータ（App Group の中の widget.json。★【0.04.50】航海日誌の koukai.json も）
// データの形は Android のウィジェットと同じ（app-bridge.js の appWidgetSync が作る）。
// 自分で入れたアプリ（iloader・SideStore）は App Group の名前が書きかえられることがあるので、
// 入れたときの証明書（embedded.mobileprovision）に書いてある App Group を先に探す

import Foundation

enum SharedStore {
    static let defaultGroup = "group.io.github.susuruchachi.susuruanki"

    // 証明書（embedded.mobileprovision）に書いてある App Group
    static func provisionedGroups() -> [String] {
        guard let p = Bundle.main.path(forResource: "embedded", ofType: "mobileprovision"),
              let raw = FileManager.default.contents(atPath: p),
              let s = String(data: raw, encoding: .isoLatin1),
              let a = s.range(of: "<?xml"), let b = s.range(of: "</plist>", range: a.lowerBound..<s.endIndex),
              let xml = String(s[a.lowerBound..<b.upperBound]).data(using: .isoLatin1),
              let pl = try? PropertyListSerialization.propertyList(from: xml, format: nil) as? [String: Any],
              let ent = pl["Entitlements"] as? [String: Any] else { return [] }
        return ent["com.apple.security.application-groups"] as? [String] ?? []
    }

    static let groupID: String? = {
        var cands = provisionedGroups()
        cands += (Bundle.main.object(forInfoDictionaryKey: "ALTAppGroups") as? [String]) ?? []
        cands.append(defaultGroup)
        // 書きかえられた名前は、もとの名前を含んでいることが多いので先に
        let sorted = cands.filter { $0.contains("susuruanki") } + cands.filter { !$0.contains("susuruanki") }
        for g in sorted where FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: g) != nil { return g }
        return nil
    }()

    static func url(_ name: String) -> URL? {
        guard let g = groupID, let c = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: g) else { return nil }
        return c.appendingPathComponent(name)
    }
    static var fileURL: URL? { url("widget.json") }

    @discardableResult
    private static func write(_ json: String, to name: String) -> Bool {
        guard let u = url(name), let d = json.data(using: .utf8) else { return false }
        do { try d.write(to: u, options: .atomic); return true } catch { return false }
    }
    private static func read(_ name: String) -> [String: Any]? {
        guard let u = url(name), let d = try? Data(contentsOf: u) else { return nil }
        return (try? JSONSerialization.jsonObject(with: d)) as? [String: Any]
    }

    // すするanki のページ（appWidgetSync）が作るもの
    @discardableResult
    static func write(_ json: String) -> Bool { write(json, to: "widget.json") }
    static func read() -> [String: Any]? { read("widget.json") }

    // ★【0.04.50】航海日誌のページ（app-bridge.js の koukaiBuildWidgetData）が作るもの：{ today, days, diary, stars, at }
    @discardableResult
    static func writeKoukai(_ json: String) -> Bool { write(json, to: "koukai.json") }
    static func readKoukai() -> [String: Any]? { read("koukai.json") }

    // 航海日誌のウィジェット・通知に使うもの：航海日誌のページが作ったもの（航海日誌の予定・すするanki の見るだけの予定・日記）。
    // まだ無ければ、すするanki のページが作った分（widget.json の koukai：すするanki のカレンダー＝航海日誌と同期していればその予定も）
    static func koukaiData(anki: [String: Any]? = nil) -> [String: Any] {
        if let k = readKoukai(), k["days"] != nil { return k }
        return ((anki ?? read())?["koukai"] as? [String: Any]) ?? [:]
    }
}
