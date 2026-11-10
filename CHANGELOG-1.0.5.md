# 1.0.5 梱包修正

## 修正内容

- `source/package.json` と `source/package-lock.json` のバージョンを `1.0.5` に更新しました。
- `npm run dist` は `electron-builder --publish never` に変更し、ローカルビルド時に GitHub 公開を試みないようにしました。
- GitHub へ公開する場合は、従来通り `npm run release` を使用します。
- README に `source` フォルダーへ移動してから npm コマンドを実行する手順を追記しました。

## 背景

前回の修正版はZIP名が `1.0.4` でしたが、`source/package.json` の `version` が `1.0.3` のままでした。そのため、Electron Builder が `メモ帳 Setup 1.0.3.exe` を生成し、さらに既存の GitHub release `v1.0.3` へ draft 公開しようとして失敗していました。

## 機能修正の内容

1.0.4で追加した次の修正は、この1.0.5にも含まれています。

- パスワード、メモ内検索、タグ、設定など本文以外の入力欄で、本文用ショートカットが横取りされないように修正。
- メモ内検索に「置換」「すべて置換」を追加。
- 長文コードのコピー用本文をHTML属性に重複保存しないようにして、長文表示時の負荷を軽減。

