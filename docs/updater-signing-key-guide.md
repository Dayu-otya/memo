# 更新用署名鍵の手順(公開前に1回だけ行う)

Tauri版の自動更新は、配布する導入プログラムに付けた署名を、アプリに埋め込んだ公開鍵で確かめる方式です。
秘密鍵を失うと既存の利用者へ更新を配れなくなり、漏れると第三者が偽の更新を配れるようになります(推測ではなく、公開鍵がアプリに固定される仕組みからの帰結です)。

## 1. 鍵を作る(自分のPCで)

```
npx tauri signer generate -w %USERPROFILE%\.tauri\memo-updater.key
```

- パスワードを聞かれたら設定します。
- `memo-updater.key`(秘密鍵)と `memo-updater.key.pub`(公開鍵)ができます。

## 2. 公開鍵をアプリの設定に入れる

`src-tauri/tauri.conf.json` の `plugins.updater.pubkey` にある `REPLACE_WITH_UPDATER_PUBLIC_KEY` を、`memo-updater.key.pub` の中身(1行)に置き換えます。
この値は最初に公開する版(2.0.0)に埋め込まれ、以後は変えられません(変えると既存の利用者が更新を受け取れなくなります)。

## 3. 秘密鍵を GitHub に登録する

リポジトリの Settings → Secrets and variables → Actions に次の2つを登録します。

| 名前 | 値 |
| --- | --- |
| `TAURI_SIGNING_PRIVATE_KEY` | `memo-updater.key` の中身 |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | 1で決めたパスワード |

## 4. 秘密鍵の控えを残す

- 秘密鍵ファイルとパスワードを、PC以外の場所(パスワード管理ソフト、暗号化したUSBメモリなど)に2か所以上で保管します。
- リポジトリ(公開・非公開とも)には入れません。

## 5. 公開の流れ

1. `git tag v2.0.0 && git push --tags`
2. GitHub Actions の release が、導入プログラム(`memo-app_2.0.0_x64-setup.exe` の形の名前)、署名(`.sig`)、更新情報(`latest.json`)を下書きのリリースに置きます。
3. 下書きの `latest.json` の URL が実際のファイル名と一致していることを確かめます(ファイル名の指定 `releaseAssetNamePattern` の置換結果は未確認のため)。
4. 実機で確認してから、下書きを公開します。
