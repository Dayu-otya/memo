メモ帳 2.0.1(Tauri版)

Electron製「メモ帳」1.0.6 を、機能を変えずに Tauri 2 へ載せ替えた版です。
画面(src/)は現行のまま使い、Electron のメイン処理(main.js・storage.js)を Rust(src-tauri/src)へ一対一で移しました。
画面との間は src/js/00-bridge.js が、現行 preload.js と同じ名前・同じ形の窓口を提供します。

フォルダーの構成
  src/                 画面(現行のまま)+ js/00-bridge.js(新設)
  src-tauri/           Rust 側(保存・暗号・バックアップ・書き出し・PDF・窓・更新)と Tauri の設定
  tests/               画面側の試験(現行のまま)と橋渡し層の試験
  src-tauri/tests/     固定データ試験・実データ互換試験
  fixtures/            現行版のコードで作った固定データ(暗号ベクトル、メモ、設定、バックアップ)
  e2e/                 端から端までの試験(Linux)
  legacy-electron/     現行版の main.js・preload.js・storage.js と、その試験(固定データの出どころ)
  docs/                migration-report.md(移植作業報告書)、updater-signing-key-guide.md(更新用署名鍵の手順)

必要なもの(Windows)
  Node.js 22、Rust(1.77.2 以上)、Microsoft C++ Build Tools、WebView2(Windows 11 は標準搭載)

開発・試験・ビルド
  1. npm ci
  2. npm test              画面側と橋渡し層の試験(45件)
  3. npm run test:rust     Rust 側の試験(44件。現行のメイン側試験39件の内容を含む)
  4. npm run test:legacy   現行版の試験(39件)
  5. npm start             開発用に起動
  6. npm run dist          導入プログラムを作る(src-tauri/target/release/bundle/nsis/)
     ※ 更新用の署名鍵を設定するまでは、次のように更新用の成果物を作らずにビルドします。
        npx tauri build --config src-tauri/tauri.ci.conf.json

保存先
  現行版と同じ %APPDATA%\memo-app を使います。データの移動はしません。
  初回起動時に notes.json と settings.json を、同じフォルダーの
  notes.before-tauri-2.0.0.json / settings.before-tauri-2.0.0.json へ複製します(上書きしません)。

公開前に必要なこと
  docs/updater-signing-key-guide.md と docs/migration-report.md の「実機で確認すること」を参照してください。
