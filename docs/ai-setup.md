# AI 機能の設定（管理者向け）

すするanki v0.03.15 から、Google AI Studio（Gemini）と OpenRouter の無料枠で、次の AI 機能が使えます。

- 意味で採点（記述式）
- AIヒント・間違えたときの解説
- PDF・写真の読み取り

## 1. Firestore のルールを追加する（必ず先に）

API キーは Firestore に保存します。ルールが「誰でも読める」状態だとキーが漏れるので、次のルールを入れてください。既存のルールの `match /databases/{database}/documents { ... }` の中に入れます。

```
// 自分の AI キー（本人だけ）
match /susuru_anki_ai/{uid} {
  allow read, write: if request.auth != null && request.auth.uid == uid;
}
// 家族に共有するキー（持ち主と、持ち主が登録した家族だけ読める。書けるのは持ち主だけ）
match /susuru_anki_ai_family/{owner} {
  allow read: if request.auth != null && (request.auth.uid == owner || request.auth.uid in resource.data.members);
  allow write: if request.auth != null && request.auth.uid == owner;
}
```

> ⚠️ Firestore を「テストモード」（`allow read, write: if true;` や、期限つきで全部許可するルール）のまま使っていると、キーを誰でも読めてしまいます。その場合は、ルール全体を「ログインした本人だけ」の形に直してからキーを保存してください。

## 2. API キーを作る（無料）

- **Google AI Studio（Gemini）**：https://aistudio.google.com/apikey →「API キーを作成」
  - PDF の読み取りはこちらのキーで使えます。無料枠の回数も多めです
- **OpenRouter**：https://openrouter.ai/keys →「Create Key」
  - 名前の最後に `:free` が付いた無料モデルを自動で選んで使います
  - クレジットを買っていないアカウントは、1日に使える回数がかなり少なめです

## 3. アプリに入れる

1. 「⚙️ 設定 → 🤖 AI」の「🔑 自分のAPIキー」に貼り付けて「💾 保存」→「🔌 接続テスト」
2. **家族に使ってもらう**：「👨‍👩‍👧 家族に自分のキーを使ってもらう」に家族の UID を入れて保存
   - UID は、家族の端末の「⚙️ 設定 → あなたのUID」で確認できます。フレンドなら一覧から選べます
   - 家族はログインするだけで、キーを入力しなくても AI を使えます
   - 無料枠の回数は家族で共有になります

### キーの安全について

- キーはサイト（GitHub）には載りません。保存先は次の2つです
  - その端末
  - ログインしていれば Firestore の「本人だけ／登録した家族だけが読める場所」
- 家族として登録した人の端末にはキーが届きます。そのため、技術的には家族の端末からキーを見ることはできます。家族の間で使う前提の仕組みです
- 心配なときは、AI Studio・OpenRouter の画面でいつでもキーを削除・作り直しできます。作り直したら、アプリにも入れ直して保存してください（家族の分も自動で新しくなります）

---

## Firebase の apiKey（config.js）について

`config.js` に `apiKey: "AIza..."` が書いてありますが、これは Firebase の「ウェブ用の設定」です。**秘密の鍵ではありません**。

- ウェブアプリが「どの Firebase プロジェクトにつなぐか」を示すもので、サイトを開けば誰でも見られる前提の値です（Firebase 公式の説明でも、公開してよいとされています）
- データを守っているのは、apiKey ではなく **Firestore のルール** です。ルールで「ログインした本人だけ」にしていれば、apiKey を知られてもほかの人のデータは読めません

**本当に秘密にすべきもの**（どれもリポジトリには入っていません）
- 通知用のサービスアカウントの JSON（GitHub の Secrets に保存）
- Android の署名鍵（.jks）
- AI の API キー

念のため、もう一段守りたい場合は、次の制限をかけておくと安心です。
- Google Cloud コンソール →「API とサービス」→「認証情報」→ その API キー
  - **アプリケーションの制限**：「ウェブサイト」→ `https://susuruchachi.github.io/*` を追加
  - **API の制限**：Firebase で使うもの（Identity Toolkit API、Token Service API、Cloud Firestore API、Firebase Installations API、FCM Registration API）だけを許可
- 制限をかけたあとにログインや同期ができなくなったら、許可する API が足りていません
