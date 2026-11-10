; メモ帳 2.0.0(Tauri版)の導入プログラムに差し込む処理。
; 旧版(Electron版 1.x、electron-builder製)が入っていれば、利用者データ(%APPDATA%\memo-app)を残したまま削除する。
; 旧版と新版が同時に入り、同じ notes.json へ同時に書く状態を作らないため。
;
; 旧版の登録キー名は、electron-builder が appId「com.dayuotya.memo」から作る GUID(UUID v5、名前空間
; 50e065bc-3134-11e6-9bab-38c9862bdaf3)である。値は app-builder-lib 24.13.3 の NsisTarget.js と
; builder-util-runtime の uuid.js の読解に基づいて計算した。実機の登録情報での確認は残っている(移植計画書 第8節 13)。
; 旧版の導入プログラムは同じキーに QuietUninstallString('"<削除プログラム>" /currentuser /S' など)を書く。
!define OLD_ELECTRON_GUID "6e4c0cc6-dcf6-56c8-a3a8-84b4f6b0e558"
!define OLD_UNINSTALL_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\${OLD_ELECTRON_GUID}"

!macro NSIS_HOOK_PREINSTALL
  ReadRegStr $R0 HKCU "${OLD_UNINSTALL_KEY}" "QuietUninstallString"
  ${If} $R0 == ""
    SetRegView 64
    ReadRegStr $R0 HKLM "${OLD_UNINSTALL_KEY}" "QuietUninstallString"
    SetRegView lastused
  ${EndIf}
  ${If} $R0 != ""
    DetailPrint "旧版(1.x)を削除しています。メモのデータは残ります。"
    ExecWait '$R0' $R1
    DetailPrint "旧版の削除処理の終了コード: $R1"
  ${EndIf}
!macroend
