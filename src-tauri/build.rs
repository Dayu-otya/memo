fn main() {
    // アプリ自身の命令にも権限を付け、能力設定(capabilities)で許した窓だけが呼べるようにする。
    const COMMANDS: &[&str] = &[
        "notes_load",
        "notes_save",
        "notes_status",
        "notes_autosave",
        "notes_check_autosave",
        "notes_discard_autosave",
        "settings_load",
        "settings_save",
        "backup_checkpoint",
        "backup_manual",
        "backup_list_auto",
        "backup_restore_auto",
        "backup_restore_from_file",
        "notes_export",
        "notes_export_all_markdown",
        "notes_import_markdown",
        "shell_open_external",
        "crypto_encrypt",
        "crypto_decrypt",
        "crypto_hash_password",
        "crypto_verify_password",
        "update_check_now",
        "update_install_now",
        "app_version",
        "app_close_after_flush",
    ];
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(tauri_build::AppManifest::new().commands(COMMANDS)))
        .expect("tauri-build に失敗しました");
}
