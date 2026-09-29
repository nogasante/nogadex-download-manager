//! System tray, taskbar progress, and download-state polling for the
//! Tauri shell — mirrors electron/main.cjs section 2.5.
//!
//! A 1 s poll of the engine's /api/downloads drives: tray tooltip + progress,
//! taskbar progress on the main window, first-active download status popups,
//! completion/failure balloons, and the per-download right-click menu.
#![allow(dead_code)]

use std::collections::HashSet;
use std::sync::Mutex;
use std::sync::OnceLock;

use serde::Deserialize;
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem, Submenu},
    tray::TrayIconBuilder,
    AppHandle, Manager,
};

#[derive(Deserialize)]
struct Dl {
    id: String,
    #[serde(default)]
    filename: String,
    status: String,
    #[serde(default)]
    downloaded_bytes: u64,
    #[serde(default)]
    total_bytes: u64,
    #[serde(default)]
    speed_bps: u64,
    #[serde(default)]
    error: Option<String>,
}

#[derive(Default)]
pub struct PollState {
    pub ever_active: HashSet<String>,
    pub active_ids: HashSet<String>,
}

static POLL_STATE: OnceLock<Mutex<PollState>> = OnceLock::new();
static ENGINE: OnceLock<Mutex<(u16, String)>> = OnceLock::new();

pub fn set_engine(port: u16, token: &str) {
    let _ = ENGINE.set(Mutex::new((port, token.to_string())));
}

fn poll_state() -> &'static Mutex<PollState> {
    POLL_STATE.get_or_init(|| Mutex::new(PollState::default()))
}

fn fetch_downloads() -> Option<Vec<Dl>> {
    let creds = ENGINE.get()?.lock().ok()?;
    let (port, token) = (creds.0, creds.1.clone());
    drop(creds);
    let url = format!("http://127.0.0.1:{port}/api/downloads");
    let client = reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(3))
        .build()
        .ok()?;
    let resp = client
        .get(&url)
        .header("X-NDM-Token", token)
        .send()
        .ok()?;
    if !resp.status().is_success() {
        return None;
    }
    let v: serde_json::Value = resp.json().ok()?;
    let list = if v.is_array() { v } else { v.get("downloads")?.clone() };
    serde_json::from_value(list).ok()
}

fn engine_post(path: &str) {
    if let Some(creds) = ENGINE.get() {
        if let Ok(creds) = creds.lock() {
            let url = format!("http://127.0.0.1:{}{path}", creds.0);
            let _ = reqwest::blocking::Client::new()
                .post(&url)
                .header("X-NDM-Token", creds.1.clone())
                .send();
        }
    }
}

fn fmt_short(bytes: u64) -> String {
    const UNITS: [&str; 4] = ["B", "KB", "MB", "GB"];
    let mut v = bytes as f64;
    let mut u = 0usize;
    while v >= 1024.0 && u < 3 {
        v /= 1024.0;
        u += 1;
    }
    if u == 0 {
        format!("{bytes} B")
    } else {
        format!("{v:.1} {}", UNITS[u])
    }
}

fn fmt_speed(bps: u64) -> String {
    if bps == 0 { String::new() } else { format!("{}/s", fmt_short(bps)) }
}

const ACTIVE: [&str; 3] = ["downloading", "probing", "connecting"];

pub fn start_polling(app: AppHandle) {
    std::thread::spawn(move || loop {
        poll_once(&app);
        std::thread::sleep(std::time::Duration::from_secs(1));
    });
}

fn poll_once(app: &AppHandle) {
    let Some(downloads) = fetch_downloads() else { return };

    let active: Vec<&Dl> = downloads.iter().filter(|d| ACTIVE.contains(&d.status.as_str())).collect();

    let mut st = poll_state().lock().unwrap();
    let previous_active: HashSet<String> = st.active_ids.clone();
    st.active_ids.clear();
    let mut sum_bytes = 0u64;
    let mut sum_total = 0u64;
    for d in &active {
        st.active_ids.insert(d.id.clone());
        sum_bytes += d.downloaded_bytes;
        sum_total += d.total_bytes;
    }

    // First-time-active downloads pop their status dialog (Electron parity).
    let main_visible = app
        .get_webview_window("main")
        .map(|w| w.is_visible().unwrap_or(false))
        .unwrap_or(false);
    if main_visible {
        for d in &active {
            if !st.ever_active.contains(&d.id) {
                st.ever_active.insert(d.id.clone());
                let id = d.id.clone();
                let h = app.clone();
                std::thread::spawn(move || {
                    let _ = h.try_state::<crate::WindowState>();
                    let _ = crate::open_window_cmd(&h, "download-status".into(),
                        Some(std::collections::HashMap::from([("id".to_string(), id)])));
                });
            }
        }
    }
    drop(st);

    // Taskbar progress on the main window (progress 0..100).
    use tauri::window::{ProgressBarState, ProgressBarStatus};
    if let Some(win) = app.get_webview_window("main") {
        if sum_total > 0 && !active.is_empty() {
            let pct = ((sum_bytes as f64 / sum_total as f64) * 100.0).min(100.0) as u64;
            let _ = win.set_progress_bar(ProgressBarState {
                status: Some(ProgressBarStatus::Normal),
                progress: Some(pct),
            });
        } else {
            let _ = win.set_progress_bar(ProgressBarState {
                status: Some(ProgressBarStatus::None),
                progress: None,
            });
        }
    }

    // Tray tooltip + progress.
    if let Some(tray) = app.tray_by_id("ndm-tray") {
        let (count, pct) = (active.len(), if sum_total > 0 { (sum_bytes as f64 / sum_total as f64).min(1.0) } else { -1.0 });
        let tip = if count == 0 {
            "NDM - Nogadex Download Manager".to_string()
        } else {
            format!("NDM - {count} download{} in progress ({:.0}%)", if count == 1 { "" } else { "s" }, pct * 100.0)
        };
        let _ = tray.set_tooltip(Some(&tip));
    }

    // Completion / failure balloons.
    for id in previous_active {
        if poll_state().lock().unwrap().active_ids.contains(&id) {
            continue;
        }
        if let Some(f) = downloads.iter().find(|d| d.id == id) {
            let focused = app
                .get_webview_window("main")
                .map(|w| w.is_focused().unwrap_or(false))
                .unwrap_or(false);
            if focused {
                continue;
            }
            use tauri_plugin_notification::NotificationExt;
            match f.status.as_str() {
                "completed" => {
                    let _ = app.notification().builder()
                        .title("Download complete")
                        .body(format!("{} finished downloading.", f.filename))
                        .show();
                }
                "error" => {
                    let _ = app.notification().builder()
                        .title("Download failed")
                        .body(format!("{} — {}", f.filename, f.error.clone().unwrap_or_else(|| "error".into())))
                        .show();
                }
                _ => {}
            }
        }
    }

    // Keep the latest snapshot for the right-click menu.
    let snapshot: Vec<Dl> = active.iter().map(|d| (*d).clone()).collect();
    LAST_ACTIVE.set(Mutex::new(snapshot)).ok();
}

static LAST_ACTIVE: OnceLock<Mutex<Vec<Dl>>> = OnceLock::new();
fn last_active() -> &'static Mutex<Vec<Dl>> {
    LAST_ACTIVE.get_or_init(|| Mutex::new(Vec::new()))
}

pub fn create_tray(app: &AppHandle) -> tauri::Result<()> {
    let show = MenuItem::with_id(app, "show", "Show NDM", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit NDM", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &PredefinedMenuItem::separator(app)?, &quit])?;

    let mut builder = TrayIconBuilder::with_id("ndm-tray")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .tooltip("NDM - Nogadex Download Manager")
        .on_menu_event(|app, event| match event.id().as_ref() {
            "show" => {
                if let Some(w) = app.get_webview_window("main") {
                    let _ = w.show();
                    let _ = w.set_focus();
                }
            }
            "quit" => {
                app.exit(0);
            }
            _ => {
                // per-download actions are encoded as "pause:<id>" / "resume:<id>" / "open:<id>"
                let id_str = event.id().as_ref();
                if let Some((action, id)) = id_str.split_once(':') {
                    match action {
                        "pause" => engine_post(&format!("/api/downloads/{id}/pause")),
                        "resume" => engine_post(&format!("/api/downloads/{id}/resume")),
                        "open" => {
                            let h = app.clone();
                            let id = id.to_string();
                            std::thread::spawn(move || {
                                let _ = crate::open_window_cmd(&h, "download-status".into(),
                                    Some(std::collections::HashMap::from([("id".to_string(), id)])));
                            });
                        }
                        _ => {}
                    }
                }
            }
        })
        .on_tray_icon_event(|tray, event| {
            if let tauri::tray::TrayIconEvent::Click { button: tauri::tray::MouseButton::Left, button_state: tauri::tray::MouseButtonState::Up, .. } = event {
                let app = tray.app_handle();
                if let Some(w) = app.get_webview_window("main") {
                    if w.is_minimized().unwrap_or(false) || !w.is_visible().unwrap_or(false) {
                        let _ = w.show();
                        let _ = w.unminimize();
                        let _ = w.set_focus();
                    } else {
                        let _ = w.minimize();
                    }
                }
            }
        });

    if let Some(icon) = app.default_window_icon().cloned() {
        builder = builder.icon(icon);
    }

    builder.build(app)?;
    Ok(())
}

/// Rebuild the dynamic per-download menu on right-click. Called from the
/// 1 s poll loop hooking into the tray's menu-open event is not available,
/// so instead we rebuild the menu every poll while downloads are active
/// (cheap: a handful of items).
pub fn refresh_menu(app: &AppHandle) {
    let Some(tray) = app.tray_by_id("ndm-tray") else { return };
    let Ok(active) = last_active().lock() else { return };
    let mut items: Vec<Box<dyn tauri::menu::IsMenuItem<_>>> = Vec::new();

    if active.is_empty() {
        if let Ok(item) = MenuItem::with_id(app, "none", "No active downloads", false, None::<&str>) {
            items.push(Box::new(item));
        }
    } else {
        let count = active.len();
        if let Ok(item) = MenuItem::with_id(app, "hdr", format!("{count} download{} in progress", if count == 1 { "" } else { "s" }), false, None::<&str>) {
            items.push(Box::new(item));
        }
        if let Ok(sep) = PredefinedMenuItem::separator(app) {
            items.push(Box::new(sep));
        }
        for d in active.iter() {
            let pct = if d.total_bytes > 0 {
                ((d.downloaded_bytes as f64 / d.total_bytes as f64) * 100.0).floor() as i64
            } else {
                0
            };
            let speed = fmt_speed(d.speed_bps);
            let size = if d.total_bytes > 0 {
                format!("{} / {}", fmt_short(d.downloaded_bytes), fmt_short(d.total_bytes))
            } else {
                fmt_short(d.downloaded_bytes)
            };
            let name = {
                let n = &d.filename;
                if n.chars().count() > 40 {
                    let t: String = n.chars().take(37).collect();
                    format!("{t}...")
                } else {
                    n.clone()
                }
            };
            let label = format!("{name} - {pct}%  ({size}{})", if speed.is_empty() { String::new() } else { format!(", {speed}") });
            if let Ok(item) = MenuItem::with_id(app, format!("open:{}", d.id), label, true, None::<&str>) {
                items.push(Box::new(item));
            }
            if let Ok(sep) = PredefinedMenuItem::separator(app) {
                items.push(Box::new(sep));
            }
            if d.status == "downloading" {
                if let Ok(p) = MenuItem::with_id(app, format!("pause:{}", d.id), "    Pause", true, None::<&str>) {
                    items.push(Box::new(p));
                }
            } else {
                if let Ok(r) = MenuItem::with_id(app, format!("resume:{}", d.id), "    Resume", true, None::<&str>) {
                    items.push(Box::new(r));
                }
            }
        }
    }

    // Static entries.
    if let Ok(sep) = PredefinedMenuItem::separator(app) {
        items.push(Box::new(sep));
    }
    if let Ok(show) = MenuItem::with_id(app, "show", "Show NDM", true, None::<&str>) {
        items.push(Box::new(show));
    }
    if let Ok(quit) = MenuItem::with_id(app, "quit", "Quit NDM", true, None::<&str>) {
        items.push(Box::new(quit));
    }

    if let Ok(menu) = Menu::with_items(app, &items.iter().map(|b| b.as_ref()).collect::<Vec<_>>()) {
        let _ = tray.set_menu(Some(menu));
    }
}

// serde-friendly clone for snapshotting
impl Clone for Dl {
    fn clone(&self) -> Self {
        Dl {
            id: self.id.clone(),
            filename: self.filename.clone(),
            status: self.status.clone(),
            downloaded_bytes: self.downloaded_bytes,
            total_bytes: self.total_bytes,
            speed_bps: self.speed_bps,
            error: self.error.clone(),
        }
    }
}
