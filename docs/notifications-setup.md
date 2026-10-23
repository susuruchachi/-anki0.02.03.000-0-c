# 通知・Android アプリの設定（管理者向け）

すするanki v0.03.14 から、アプリ化（ホーム画面に追加）と通知に対応しました。
**アプリを閉じていても届く通知（プッシュ通知）**を使うには、以下の設定が一度だけ必要です。
設定しなくても、アプリを開いている間や、対応している Android の Chrome のバックグラウンド確認では通知が届きます。

---

## 1. Firestore のルールを入れる

アプリ全体のルールを `docs/firestore.rules` にまとめてあります。Firebase コンソール →「Firestore Database」→「ルール」で、**今のルールを全部消して、このファイルの中身をそのまま貼り付けて**「公開」してください。

> 一部だけを貼り足すと、`match` の `{ }` の中に入ってしまい、別の場所のルールになって効かないことがあります（全部まとめて貼り替えるのが確実です）。

## 2. 送信用の鍵（サービスアカウント）を GitHub に登録する

1. Firebase コンソール → ⚙️「プロジェクトの設定」→「サービス アカウント」→「新しい秘密鍵を生成」→ JSON ファイルがダウンロードされます
2. GitHub のこのリポジトリ → **Settings → Secrets and variables → Actions → New repository secret**
   - Name: `FIREBASE_SERVICE_ACCOUNT`
   - Secret: ダウンロードした JSON ファイルの中身をそのまま貼り付け
3. JSON ファイルは他の人に渡さないでください（このリポジトリにも入れないでください）

## 3. Cloud Messaging が有効か確認する

Firebase コンソール → ⚙️「プロジェクトの設定」→「Cloud Messaging」で、**Firebase Cloud Messaging API (V1)** が「有効」になっていることを確認します。
（Google Cloud のコンソールで API キーに制限をかけている場合は、「Firebase Installations API」と「FCM Registration API」も許可してください）

## 4. main ブランチに入れて動かす

- 送信は GitHub Actions の `push-notifications`（`.github/workflows/push-notifications.yml`）が **15分ごと** に行います
  - 定期実行は **main ブランチ** にこのファイルがあるときだけ動きます
  - 試しに動かすには：Actions →「push-notifications」→「Run workflow」
  - 鍵が登録されていないときは「送りません」と表示して何もしません
- 学習の催促：各ユーザーが決めた時刻を過ぎて、その日まだ学習していなければ1日1回送ります
- アップデートのお知らせ：`version-info.js` のバージョンが上がって main に入ったとき、全員に1回送ります（お知らせのタイトルは `release-notes.js` から）
- GitHub は、リポジトリに60日間何も変更が無いと定期実行を止めることがあります。止まったら Actions の画面から有効にし直してください

アプリの「⚙️ 設定 → 📲 アプリ・通知」に「📡 プッシュ通知：有効（アプリを閉じていても届きます）」と出ていれば設定完了です。

---

## Android アプリ（APK）

- `apk/susuruanki.apk` がアプリです。サイトの「⚙️ 設定 → 📲 アプリ・通知 → 🤖 Android アプリ（APK）」からダウンロードできます
  - 直接のURL：https://susuruchachi.github.io/-anki0.02.03.000-0-c/apk/susuruanki.apk
  - インストール時に「提供元不明のアプリ」の許可を求められたら許可してください
- 中身はウェブ版をそのまま Chrome で全画面表示するもの（Trusted Web Activity）です。**ウェブ版を更新すればアプリも自動で新しくなります**（APK を入れ直す必要はありません）。学習データも Chrome のウェブ版と共通です
- 通知はアプリの通知として届きます（Android 13 以降は、初回に通知の許可を聞かれます）

### 上のアドレスバーを消す（任意）

最初は画面の上に細いアドレスバーが出ます。消すには、このアプリとサイトが同じ持ち主だと証明するファイルを置きます。

1. GitHub で **`susuruchachi.github.io`** という名前のリポジトリを新しく作る（公開）
2. そのリポジトリに次の2つのファイルを追加する
   - `.nojekyll`（中身は空でOK）
   - `.well-known/assetlinks.json`（中身は、このリポジトリの `android/assetlinks.json` をそのままコピー）
3. そのリポジトリの Settings → Pages で、main ブランチから公開する
4. https://susuruchachi.github.io/.well-known/assetlinks.json が開ければOK。アプリを一度閉じて開き直すと、アドレスバーが消えます

### APK を作り直す（アイコンや名前を変えたいときだけ）

- Android アプリの元は `android/` にあります
- GitHub Actions の「android-apk」→「Run workflow」で APK を作れます（できた APK は実行結果の Artifacts からダウンロード）
- 同じアプリとして上書きインストールするには、同じ署名鍵が必要です。最初の APK の署名鍵（`susuruanki-release.jks` とパスワード）を、次の Secrets に入れておきます
  - `ANDROID_KEYSTORE_BASE64`：`base64 -w0 susuruanki-release.jks` の結果
  - `ANDROID_KEYSTORE_PASSWORD`：パスワード
- 署名鍵を無くすと、同じアプリとして更新できなくなります（アンインストールして入れ直せば使えます。学習データは Chrome 側にあるので消えません）
