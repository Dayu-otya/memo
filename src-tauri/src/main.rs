// リリース版ではWindowsのコンソール窓を出さない
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    memo_app_lib::run()
}
