# メモ帳 Tauri完全移植 作業報告書

Nov 10, 2026 · 対象: 「メモ帳 Tauri完全移植計画書」(以下、計画書)に基づく P0〜P7

## 1. 結論

計画書の P0〜P7 のうち、Linux の作業環境で実施できる範囲はすべて実施し、合格条件を満たしました。具体的には、渡し口25本、通知5種、窓の振る舞いを Rust と橋渡し層へ移し、自動試験を合計89件(画面側34、橋渡し層11、Rust 44)にしました。全件合格しています。加えて、実際に起動したアプリを操作する端から端までの試験(13項目)も合格しています。

一方、Windows 実機でしか確かめられない項目は未確認のまま残っています。PDF 出力(WebView2 の PrintToPdf)、Windows 向けのコンパイル、導入プログラム、容量の実測、日本語入力、実プリンターです(第6節)。この作業環境では Windows 用 Rust 標準ライブラリの取得が通信制限で拒否されたため、Windows 専用のコード(pdf.rs の約60行)はコンパイルもできていません。同梱の GitHub Actions(ci.yml)を最初に Windows で動かすと、この点を確認できます。

## 2. 受入基準ごとの状況

| 番号 | 基準 | 状況 | 根拠 |
| --- | --- | --- | --- |
| 1 | 機能同等 | この環境では合格。実機は未確認 | 渡し口25本と通知5種の名前・引数・返り値の形を橋渡し層試験で確認した。終了時の保存確認(失敗時は開いたまま、成功時は閉じる)は、実際の閉じる要求を送る端から端までの試験で確認した |
| 2 | データ無損失 | 合格 | 現行版のコードで作った notes.json(未知の項目、ロック済みメモ、2^53超の整数、1e+21 を含む)を読込→保存→再読込すると、1バイトも変わらなかった。ロック済みメモの復号、設定、バックアップの復元も確認した |
| 3 | 試験 | 合格 | 画面側34件は改造せずに合格。メイン側39件の内容は Rust 試験44件へ移した(印刷の取消判定の1件は、仕様差のため橋渡し層試験へ置き換えた)。固定データ試験と実データ互換試験も新設した |
| 4 | PDF | 未確認(実機待ち) | HTML の生成、一時ファイルの削除、失敗時の扱いは試験で確認した。PrintToPdf の呼び出しは Windows 実機での確認が必要 |
| 5 | 容量 | 見込みのみ | Linux 版の実行ファイルは 8.8 MB(gzip 圧縮で 4.0 MB)。Windows でも同程度と推測すると、インストーラーは 15 MB 以下、導入後は 50 MB 以下に収まる見込み(推測)。実測は ci.yml が記録する |
| 6 | 実機 | 未確認 | 第6節のチェックリストのとおり |

## 3. 工程ごとの実施内容

- **P0 準備**: 添付zipから現行版のソースを取り出し、現行の試験73件が合格することを確認した。現行の main.js をそのまま動かし、乱数だけを固定して基準データを作った(`legacy-electron/tools/make-fixtures.js`)。作ったのは、暗号ベクトル6種(日本語、絵文字、空文字、空パスワード、長文を含む)、notes.json、settings.json、バックアップである。
  - KaTeX: 今回のzipには `src/vendor/katex`(本体とフォント20個)が揃っていた。計画書 P0 の「欠けている」という記述は、今回の添付には当てはまらない。
  - アイコン: 原画が無いため、仮のアイコンを作った(`app-icon.png`)。差し替えるときは `npx tauri icon <原画>` を実行する。
- **P1 骨格**: Tauri 2.12.5 の構成、CSP、`withGlobalTauri`、橋渡し層(`src/js/00-bridge.js`)を作った。画面側の変更は index.html の2か所だけである(CSP の meta を削除し、橋渡し層の読込を追加)。
- **P2 暗号**: scrypt(log_n=14, r=8, p=1, 32バイト)と AES-256-GCM(認証タグを分けて扱う方式)で実装した。6種すべてで、同じパスワード・salt・iv から現行版と1バイトも違わない暗号文になった。誤パスワードと改ざんは拒否する。
- **P3 PDF**: 非表示の副窓と PrintToPdf で実装した。A4、余白1 cm、背景あり、ヘッダー・フッターなしを明示している(第4節 l)。
- **P4 保存系**: storage / notes / settings / backup、終了処理、二重起動の防止、保存先の固定、移行前バックアップを実装した。
- **P5 入出力**: txt、Markdown 一括書き出し、取込、印刷、外部リンク、ダイアログを実装した。
- **P6 更新・配布**: 更新部品、NSIS の設定(日本語、利用者単位の導入、WebView2 起動補助の組込)、旧版を削除する導入時処理、GitHub Actions(ci.yml と release.yml)、署名鍵の手順書を用意した。
- **P7 総合試験**: Linux(WebKitGTK)上で、端から端までの試験を開発版と配布版の両方で実施し、合格した。

## 4. 計画書から変えた点・新たに分かった点

a. **HTML のドラッグ&ドロップ**: 画面側は、メモをフォルダーへ移す操作に HTML のドラッグ&ドロップを使っている(07-render-ui.js)。Tauri の既定のファイル投下処理が有効だと、この操作が効かなくなるおそれがあるため(私の知識による推測)、主窓では無効にした(`disable_drag_drop_handler`)。計画書には無かった対応である。

b. **CSP**: index.html の meta にあった `connect-src 'none'` は、アプリ設定の CSP と重なると呼び出しを止めてしまう。そこで meta を削除し、CSP を tauri.conf.json に一本化した。Tauri は HTML に `<style>` 要素があると style-src に nonce を足し、その場合 `'unsafe-inline'` が無効になる。現行の index.html は `<style>` 要素を持たず、style 属性(20か所)だけなので nonce は付かない。実際にメニューが閉じた状態で表示されることを端から端までの試験で確認した(Tauri Contributors, n.d.-c)。

c. **印刷**: 計画書は「Tauri は window.print を印刷命令に置き換える」としていたが、置き換えは macOS と iOS だけで、Windows と Linux では標準の window.print がそのまま使われる(Tauri Contributors, n.d.-a)。そこで printAPI.print は標準の印刷画面を開き、常に成功を返す。取消は失敗として表示しない(計画書の方針どおり)。また WebView2 の印刷画面は背景を印刷しない設定が既定と見られるため(推測)、印刷時に限り背景色を保つ指定(`print-color-adjust: exact`)を橋渡し層で加えた。

d. **終了処理**: v2 にも閉じる要求を止める仕組み(`CloseRequested` と `prevent_close`)があることを、実際に動かして確認した(第8節8)。保存の結果は、要求ごとの番号を付けて返す方式にした。画面側が60秒応答しない場合は、終了を中止した旨を表示して、次の閉じる要求を受け付けられる状態に戻す。

e. **対にならないサロゲート**: 現行版はファイルへ書くとき、対にならないサロゲート(壊れた絵文字の片割れ)を U+FFFD に置き換えていた(Node.js の UTF-8 変換)。一方、Rust 側の JSON 解析はこれを受け付けない。そこで、送る前に橋渡し層で同じ置き換えをし、さらに既存ファイルにある `\ud83d` のような表記も読めるようにした。

f. **JSON の書式**: 保存し直したときの書式差を見込んでいたが、実測では 1e+21 の表記まで含めて差は無かった。

g. **命令の実行場所**: 同期型の命令は UI スレッドで動くと理解しているため(私の知識)、すべての命令を非同期にし、重い処理(暗号、ファイル、ダイアログ)は別スレッドで行うようにした。

h. **アプリ自身の命令の権限**: 計画書の「権限の設定誤り」対策として、アプリ自身の命令26本(渡し口25本と、終了前の保存結果を返す1本)にも権限を付けた。主窓だけが呼べる。ファイル操作、外部起動、更新の権限は画面側に与えていない。

i. **移行前バックアップ**: notes.json に加えて settings.json も複製するようにした。複製に失敗した場合は、データを書き換える前に起動を止める。

j. **旧版の削除**: 導入時の処理(installer-hooks.nsh)で、旧版の削除プログラムを静かに実行する。旧版の登録キーは electron-builder 24.13.3 の作り方から計算した(6e4c0cc6-dcf6-56c8-a3a8-84b4f6b0e558)。electron-builder は appId から名前ベースの UUID v5 を作る(electron-builder, n.d.)。

k. **配布ファイル名**: 製品名「メモ帳」は日本語のため、GitHub 上のファイル名は英数字(`memo-app_...`)にする設定にした(tauri-apps, n.d.)。現行版も GitHub 上は `memo-app-setup-1.0.6.exe` だった(添付 dist/latest.yml)。

l. **PDF の体裁**: 現行版の HTML は style.css と KaTeX の CSS を file: で参照していた。Tauri 版では画面側の資源がプログラムに埋め込まれるため、同じ CSS を `<style>` に塗り込み、KaTeX のフォントは data: URI にした。現行版の printToPDF の余白は既定値の1 cm で(Electron, n.d.-b)、WebView2 の既定値も1 cm である(Microsoft, n.d.)。用紙は、WebView2 の既定が 8.5×11 インチ(レター)なので A4 を明示した。背景の印刷は WebView2 の既定が無効なので、有効を明示した(Microsoft, n.d.)。

m. **保存先**: Electron の userData は「%APPDATA% + アプリ名」で、アプリ名は package.json の productName、無ければ name で決まる(Electron, n.d.-a)。app.asar 内の package.json は、最上位に productName が無く(build 内にだけある)、name は memo-app だった。したがって保存先は %APPDATA%\memo-app と推定した。実機での確認は残っている。

## 5. 計画書 第8節の確認事項の更新

| 番号 | 事項 | 結果 |
| --- | --- | --- |
| 1 | 保存先 | 推定を強めた(第4節 m)。実機での確認が必要 |
| 2 | KaTeX・アイコン | KaTeX は揃っていた。アイコンは仮のものを作った |
| 3 | CSP の最終形 | 確定した。動作も確認した(第4節 b) |
| 4 | キー順の保持 | serde_json の `preserve_order` で保持できることを、実データ互換試験で確認した |
| 5 | 暗号文の完全一致 | 確認した(6種) |
| 6・7 | 非表示窓での PrintToPdf、最低版 | 未確認。PrintToPdf を持たない古い WebView2 では、更新を促す文言を返すようにした |
| 8 | 閉じる要求を止める v2 の方法 | 確認した |
| 9 | 画面遷移と新規窓の禁止 | `on_navigation` と `on_new_window` で実装し、許可する URL の判定を試験した |
| 10 | 印刷の成功と取消の区別 | Windows ではできない(第4節 c) |
| 11 | 更新の取得と導入を分けられるか | 分けられる(download と install が別関数)(Tauri Contributors, n.d.-b)。現行と同じ流れで実装した |
| 12 | NSIS の日本語、導入先、日本語名 | 設定の形式は `tauri build` が受け付けた。実物は未確認 |
| 13 | 旧版からの乗り換え | 導入時に旧版を削除する処理を入れた。実機での確認が必要 |
| 14 | 版の組合せ | Tauri 2.12.5、wry 0.57.1、webview2-com 0.39.1 で固定した(Cargo.lock) |

## 6. 実機で確認すること(公開前)

1. ci.yml を Windows で通す。Windows 専用コードがコンパイルされ、試験が通り、導入プログラムの大きさが記録される。
2. 保存先: 現行版のフォルダー %APPDATA%\memo-app があり、2.0.0 がそれを読むこと。
3. PDF: 基準メモ群(fixtures/userdata)で、現行版と新版の出力を比べる(ページ数、文字、余白の差が2 mm以内、数式、コード、背景)。非表示窓で出力できない場合は、窓を画面外に置いて表示する方式へ切り替える。
4. 印刷: 実プリンター、取消、背景色。
5. 日本語入力: 本文、検索欄、パスワード欄での変換・確定・Enter。
6. ドラッグ&ドロップ: メモをフォルダーへ移す操作。
7. 導入・更新・削除: 旧版が入った状態から導入して旧版が消えること、データが残ること、署名鍵を設定したうえで 2.0.0→2.0.1 の更新ができること、削除後もデータが残ること。
8. 二重起動、高DPI、最小寸法。

## 7. 出典

本文の(著者, n.d.-文字)は、下の同じ記号の資料を指す。docs.rs のソースは、作業環境に取得した同じ版のクレートの中身を読んだ。

- Electron. (n.d.-a). *app*. Electron Documentation. https://www.electronjs.org/docs/latest/api/app
- Electron. (n.d.-b). *webContents*. Electron Documentation. https://www.electronjs.org/docs/latest/api/web-contents
- electron-builder. (n.d.). *NSIS*. electron-builder. https://www.electron.build/docs/nsis
- Microsoft. (n.d.). *ICoreWebView2PrintSettings*. Microsoft Learn. https://learn.microsoft.com/en-us/microsoft-edge/webview2/reference/win32/icorewebview2printsettings
- tauri-apps. (n.d.). *tauri-action*. GitHub. https://github.com/tauri-apps/tauri-action
- Tauri Contributors. (n.d.-a). *tauri 2.12.5: webview/plugin.rs*. docs.rs. https://docs.rs/crate/tauri/2.12.5/source/src/webview/plugin.rs
- Tauri Contributors. (n.d.-b). *tauri-plugin-updater 2.14.1: updater.rs*. docs.rs. https://docs.rs/crate/tauri-plugin-updater/2.14.1/source/src/updater.rs
- Tauri Contributors. (n.d.-c). *tauri 2.12.5: manager/mod.rs*. docs.rs. https://docs.rs/crate/tauri/2.12.5/source/src/manager/mod.rs

**出典のない記述**: 試験の件数と結果、容量の数値、画面側の使い方は、この作業環境で実行・計測・読解した結果です。ウェブ上のソースはありません。「推測」「私の知識」と書いた箇所も、ソースはありません。
