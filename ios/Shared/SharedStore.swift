// ★【0.04.47】アプリとウィジェットで分け合うデータ（App Group の中の widget.json）
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

    static var fileURL: URL? {
        guard let g = groupID, let c = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: g) else { return nil }
        return c.appendingPathComponent("widget.json")
    }

    @discardableResult
    static func write(_ json: String) -> Bool {
        guard let u = fileURL, let d = json.data(using: .utf8) else { return false }
        do { try d.write(to: u, options: .atomic); return true } catch { return false }
    }

    static func read() -> [String: Any]? {
        guard let u = fileURL, let d = try? Data(contentsOf: u) else { return nil }
        return (try? JSONSerialization.jsonObject(with: d)) as? [String: Any]
    }
}
