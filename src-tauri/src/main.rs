#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use base64::Engine;
use std::io::Write;
use std::process::{Command, Stdio};
#[cfg(windows)]
use std::os::windows::process::CommandExt;

// GUI apps may not see the user's PATH additions, so check the default Claude Code install location first.
fn claude_exe() -> String {
    if let Ok(home) = std::env::var("USERPROFILE") {
        let p = std::path::Path::new(&home).join(".local").join("bin").join("claude.exe");
        if p.exists() {
            return p.to_string_lossy().into_owned();
        }
    }
    "claude".into()
}

/// Runs `claude -p` (Claude Code, logged in with the user's subscription). Images are written to a temp folder
/// that Claude may read with its Read tool; nothing else is allowed.
#[tauri::command]
async fn ask_claude(prompt: String, images: Vec<String>) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let dir = std::env::temp_dir().join("opensim-claude");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        let mut full = prompt;
        for (i, b64) in images.iter().enumerate() {
            let bytes = base64::engine::general_purpose::STANDARD.decode(b64).map_err(|e| e.to_string())?;
            let p = dir.join(format!("image{i}.png"));
            std::fs::write(&p, bytes).map_err(|e| e.to_string())?;
            full.push_str(&format!("\nAttached image file: {}", p.display()));
        }
        let mut cmd = Command::new(claude_exe());
        cmd.args(["-p", "--no-session-persistence", "--output-format", "text", "--allowedTools", "Read"])
            .current_dir(&dir)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        #[cfg(windows)]
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
        let mut child = cmd
            .spawn()
            .map_err(|e| format!("Could not start Claude Code ({e}). Install it from claude.com/code and run `claude` once to log in."))?;
        child.stdin.take().unwrap().write_all(full.as_bytes()).map_err(|e| e.to_string())?;
        let out = child.wait_with_output().map_err(|e| e.to_string())?;
        let stdout = String::from_utf8_lossy(&out.stdout).into_owned();
        if out.status.success() {
            Ok(stdout)
        } else {
            Err(format!("{}{}", String::from_utf8_lossy(&out.stderr), stdout))
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
fn read_text(path: String) -> Result<String, String> {
    std::fs::read_to_string(path).map_err(|e| e.to_string())
}

#[tauri::command]
fn write_text(path: String, contents: String) -> Result<(), String> {
    std::fs::write(path, contents).map_err(|e| e.to_string())
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![ask_claude, read_text, write_text])
        .run(tauri::generate_context!())
        .expect("error while running OpenSim");
}
