//! NDM shell: spawns the Node engine sidecar, injects the bridge token into
//! the UI, and implements the `window.electronAPI` shim surface so the
//! existing React app runs unmodified inside WebView2.
//!
//! The UI keeps talking plain HTTP/WebSocket to 127.0.0.1 — same contract as
//! under Electron. What changes is who plays "main process": this crate.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::collections::HashMap;
use std::sync::Mutex;
use std::sync::OnceLock;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, PhysicalSize, WebviewUrl, WebviewWindowBuilder};

mod icons;
mod tray;
mod updater;
mod window_specs;

/// The token the engine requires on every /api call. Generated once per run,
/// shared with the UI via the bridge, handed to the engine through env.
pub struct BridgeToken(pub String);

/// Handle to the spawned engine process so we can kill it on exit.
pub struct EngineChild(pub Mutex<Option<std::process::Child>>);

#[derive(Default)]
pub struct WindowState {
    /// open dialog windows keyed like Electron: "settings", "download-status:<id>"
    pub children: Mutex<HashMap<String, tauri::WebviewWindow>>,
}

static LAST_POSITION: OnceLock<Mutex<Option<(i32, i32)>>> = OnceLock::new();

fn last_position() -> &'static Mutex<Option<(i32, i32)>> {
    LAST_POSITION.get_or_init(|| Mutex::new(None))
}

#[derive(Serialize, Clone)]
struct EngineReady {
    port: u16,
    token: String,
}

fn pick_port() -> u16 {
    // 5088 is NDM's historical default; fall back deterministically if busy.
    use std::net::TcpListener;
    if TcpListener::bind(("127.0.0.1", 5088)).is_ok() {
        return 5088;
    }
    for p in 5089..5189 {
        if TcpListener::bind(("127.0.0.1", p)).is_ok() {
            return p;
        }
    }
    5088 // let the engine itself report the EADDRINUSE fatal if all busy
}

fn spawn_engine(app: &AppHandle) -> Result<(u16, String), Box<dyn std::error::Error>> {
    let port = pick_port();
    let token = format!("ndm_{}", uuid_simple());
    let data_dir = std::env::var("NDM_DATA_DIR")
        .unwrap_or_else(|_| {
            let home = std::env::var("USERPROFILE").unwrap_or_else(|_| ".".into());
            format!("{home}\\.ndm")
        });

    let sidecar = app
        .path()
        .resolve("sidecar/ndm-engine.exe", tauri::path::BaseDirectory::Resource)?;

    let child = std::process::Command::new(&sidecar)
        .env("PORT", port.to_string())
        .env("NDM_BRIDGE_TOKEN", &token)
        .env("NDM_DATA_DIR", &data_dir)
        .env("NDM_TAURI_SHELL", "1")
        .spawn()
        .map_err(|e| format!("failed to spawn engine sidecar {}: {e}", sidecar.display()))?;

    *app.state::<EngineChild>().0.lock().unwrap() = Some(child);
    Ok((port, token))
}

fn uuid_simple() -> String {
    use rand::Rng;
    let mut rng = rand::thread_rng();
    (0..32).map(|_| format!("{:x}", rng.gen_range(0..16))).collect()
}

/// Wait until the engine answers (bounded, ~15 s) before showing the window.
fn wait_for_engine(port: u16, token: &str) -> bool {
    let url = format!("http://127.0.0.1:{port}/api/app-config");
    let client = reqwest_blocking_client();
    for _ in 0..50 {
        if let Ok(resp) = client.get(&url).header("X-NDM-Token", token).send() {
            if resp.status().is_success() || resp.status().as_u16() == 403 {
                return true; // 403 proves the token guard (and thus the server) is live
            }
        }
        std::thread::sleep(std::time::Duration::from_millis(300));
    }
    false
}

fn reqwest_blocking_client() -> reqwest::blocking::Client {
    reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(3))
        .build()
        .expect("reqwest client")
}

#[derive(Serialize, Clone)]
pub struct EngineInfo {
    pub port: u16,
    pub token: String,
}

#[tauri::command]
fn engine_info(info: tauri::State<'_, EngineInfo>) -> Result<EngineReady, String> {
    Ok(EngineReady { port: info.port, token: info.token.clone() })
}

#[tauri::command]
fn minimize(window: tauri::Window) { let _ = window.minimize(); }

#[tauri::command]
fn maximize(window: tauri::Window) {
    if window.is_maximized().unwrap_or(false) {
        let _ = window.unmaximize();
    } else {
        let _ = window.maximize();
    }
}

#[tauri::command]
fn close(window: tauri::Window) { let _ = window.close(); }

#[tauri::command]
fn resize_step(window: tauri::Window, dx: f64, dy: f64) {
    let scale = window.scale_factor().unwrap_or(1.0);
    let size = window.inner_size().unwrap_or(PhysicalSize::new(1100, 720));
    let new_w = (size.width as f64 + dx * scale).round().max(850.0 * scale) as u32;
    let new_h = (size.height as f64 + dy * scale).round().max(550.0 * scale) as u32;
    let _ = window.set_size(PhysicalSize::new(new_w, new_h));
}

#[tauri::command]
fn open_external(app: AppHandle, url: String) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    let lower = url.to_lowercase();
    let scheme_ok = lower.starts_with("http://") || lower.starts_with("https://") || lower.starts_with("mailto:");
    if !scheme_ok {
        return Err(format!("scheme not allowed: {url}"));
    }
    let _ = app.opener().open_url(&url, None::<&str>);
    Ok(())
}

#[tauri::command]
fn set_native_theme(window: tauri::Window, theme: String) -> Result<(), String> {
    match theme.as_str() {
        "light" => window.set_theme(Some(tauri::Theme::Light)),
        "dark" => window.set_theme(Some(tauri::Theme::Dark)),
        _ => window.set_theme(None),
    }
    .map_err(|e| e.to_string())
}

#[tauri::command]
fn beep() {
    #[cfg(target_os = "windows")]
    {
        // Rust's std has no beep; the simplest faithful equivalent is a plain
        // console bell through PowerShell's [console]::beep (no new deps).
        let _ = std::process::Command::new("powershell")
            .args(["-NoProfile", "-Command", "[console]::beep(800,180)"])
            .spawn();
    }
}

#[tauri::command]
fn flash_window(window: tauri::Window, active_count: Option<u32>) {
    // Taskbar progress / attention. WebView2 cannot set progress natively; we
    // flash the taskbar icon when downloads need attention (mirrors Electron
    // setProgressBar(0.9-1.0) attention behavior).
    let _ = active_count;
    #[cfg(target_os = "windows")]
    {
        use windows_sys::Win32::UI::WindowsAndMessaging::{FlashWindowEx, FLASHWINFO, FLASHW_ALL, FLASHW_TIMERNOFG};
        if let Ok(hwnd) = window.hwnd() {
            let mut info: FLASHWINFO = unsafe { std::mem::zeroed() };
            info.cbSize = std::mem::size_of::<FLASHWINFO>() as u32;
            info.hwnd = hwnd.0 as _;
            info.dwFlags = FLASHW_ALL | FLASHW_TIMERNOFG;
            unsafe { FlashWindowEx(&mut info) };
        }
    }
}

#[tauri::command]
async fn select_folder(app: AppHandle, current: Option<String>) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    let (tx, rx) = std::sync::mpsc::channel();
    app.dialog()
        .file()
        .set_parent(&app.get_webview_window("main").ok_or("no main window")?)
        .pick_folder(move |p| {
            let _ = tx.send(p.map(|f| f.to_string()));
        });
    rx.recv().map_err(|e| e.to_string()).map(|p| p.or(current))
}

#[tauri::command]
async fn select_file(
    app: AppHandle,
    filters: Option<Vec<String>>,
) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    let (tx, rx) = std::sync::mpsc::channel();
    let mut builder = app.dialog().file();
    if let Some(exts) = filters {
        let refs: Vec<&str> = exts.iter().map(|s| s.as_str()).collect();
        builder = builder.add_filter("Files", &refs);
    }
    builder.pick_file(move |p| {
        let _ = tx.send(p.map(|f| f.to_string()));
    });
    rx.recv().map_err(|e| e.to_string())
}

#[tauri::command]
fn get_downloads_path() -> String {
    dirs::download_dir()
        .or_else(dirs::home_dir)
        .map(|p| p.to_string_lossy().into_owned())
        .unwrap_or_else(|| "C:\\".into())
}

/// ndm:// handoff: parse the deep link and forward the URL to the UI, like
/// Electron's handleIncomingUrl (ndm://download?url=<encoded> also accepted).
fn handle_incoming_url(app: &AppHandle, raw: &str) {
    let mut target = raw.to_string();
    if raw.starts_with("ndm://") {
        // ndm://download?url=<encoded> — parse the query without a url crate
        if let Some(q) = raw.split_once('?').map(|(_, q)| q) {
            for pair in q.split('&') {
                if let Some((k, v)) = pair.split_once('=') {
                    if k == "url" {
                        target = urlencoding::decode(v)
                            .map(|c| c.into_owned())
                            .unwrap_or_else(|_| v.to_string());
                        break;
                    }
                }
            }
        }
    }
    let _ = app.emit("open-new-download", serde_json::json!({ "url": target }));
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
}

#[tauri::command]
fn check_folder_exists(path: String) -> bool {
    std::path::Path::new(&path).is_dir()
}

#[tauri::command]
fn create_folder(path: String) -> Result<bool, String> {
    std::fs::create_dir_all(&path).map(|_| true).map_err(|e| e.to_string())
}

#[tauri::command]
fn open_file(app: AppHandle, target: String) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    app.opener()
        .open_path(target, None::<&str>)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn open_folder(app: AppHandle, target: String) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    // reveal parent folder like Electron's showItemInFolder
    let p = std::path::Path::new(&target);
    let dir = if p.is_dir() { p } else { p.parent().unwrap_or(p) };
    app.opener()
        .open_path(dir.to_string_lossy(), None::<&str>)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn get_file_icon(file_path: String, filename: String) -> Result<String, String> {
    Ok(icons::extract_data_url(&file_path, &filename))
}

#[tauri::command]
fn show_native_message_box(
    app: AppHandle,
    title: String,
    message: String,
    kind: Option<String>,
) -> Result<String, String> {
    use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};
    let (tx, rx) = std::sync::mpsc::channel();
    let kind = match kind.as_deref() {
        Some("error") => MessageDialogKind::Error,
        Some("warning") => MessageDialogKind::Warning,
        _ => MessageDialogKind::Info,
    };
    app.dialog()
        .message(message)
        .title(title)
        .kind(kind)
        .buttons(MessageDialogButtons::OkCancelCustom("OK".into(), "Cancel".into()))
        .show(move |ok| {
            let _ = tx.send(if ok { "ok" } else { "cancel" }.to_string());
        });
    rx.recv().map_err(|e| e.to_string())
}

/// Open (or focus) a standalone dialog window, mirroring Electron's
/// openChildWindow: same routes, same sizes, one instance per key.
#[tauri::command]
fn open_window(
    app: AppHandle,
    window_type: String,
    params: Option<HashMap<String, String>>,
) -> Result<(), String> {
    let spec = window_specs::get(&window_type);
    let query = params.unwrap_or_default();
    let key = match query.get("id") {
        Some(id) => format!("{window_type}:{id}"),
        None => window_type.clone(),
    };
    let query_str: String = query
        .iter()
        .map(|(k, v)| format!("{k}={}", urlencoding::encode(v)))
        .collect::<Vec<_>>()
        .join("&");

    let state = app.state::<WindowState>();
    let mut children = state.children.lock().unwrap();
    if let Some(existing) = children.get(&key) {
        let w = existing.clone();
        {
            let route = if query_str.is_empty() {
                format!("/window/{window_type}")
            } else {
                format!("/window/{window_type}?{query_str}")
            };
            let _ = w.eval(&format!("window.location.hash = '#{}';", route));
            let _ = w.set_focus();
            return Ok(());
        }
    }

    let label = format!("dlg-{key}");
    // Dialogs use the same hash routes Electron used:
    // index.html#/window/<type>?<params>
    let route = if query_str.is_empty() {
        format!("/index.html#/window/{window_type}")
    } else {
        format!("/index.html#/window/{window_type}?{query_str}")
    };
    let mut builder = WebviewWindowBuilder::new(
        &app,
        &label,
        WebviewUrl::App(route.into()),
    )
    .title(&window_type)
    .inner_size(spec.width, spec.height)
    .min_inner_size(spec.min_width, spec.min_height)
    .resizable(spec.resizable)
    .decorations(false)
    .visible(false);

    if spec.always_on_top {
        builder = builder.always_on_top(true);
    }

    let win = builder.build().map_err(|e| e.to_string())?;
    win.center().map_err(|e| e.to_string())?;
    let _ = win.show();
    children.insert(key, win);
    Ok(())
}

#[tauri::command]
fn close_window(window: tauri::Window) {
    // dialog windows close themselves via this command (their UI close buttons)
    let _ = window.close();
}

#[tauri::command]
fn open_download_window(app: AppHandle, id: String) -> Result<(), String> {
    open_window(app, "download-status".into(), Some(HashMap::from([("id".into(), id)])))
}

/// Notify (toast) — wraps the notification plugin.
#[tauri::command]
fn notify(app: AppHandle, title: String, body: String) -> Result<(), String> {
    use tauri_plugin_notification::NotificationExt;
    app.notification()
        .builder()
        .title(title)
        .body(body)
        .show()
        .map_err(|e| e.to_string())
}

/* ============================ updater commands ============================ */

fn updater_emit(app: &AppHandle) -> impl Fn(updater::UpdaterState) + Send + 'static {
    let h = app.clone();
    move |state| {
        // Serialize to the exact camelCase shape Electron's preload sent.
        let _ = h.emit("updater-state-changed", serde_json::json!({
            "status": state.status,
            "updateInfo": state.update_info,
            "progress": state.progress,
            "error": state.error,
            "policy": state.policy,
        }));
    }
}

#[tauri::command]
fn check_for_updates(app: AppHandle) -> Result<(), String> {
    let ver: &'static str = Box::leak(env!("CARGO_PKG_VERSION").to_string().into_boxed_str());
    updater::check_for_updates(updater_emit(&app), ver);
    Ok(())
}

#[tauri::command]
fn download_update(app: AppHandle) -> Result<(), String> {
    updater::download_update(updater_emit(&app));
    Ok(())
}

#[tauri::command]
fn install_update() -> Result<u32, String> {
    updater::install_downloaded()?;
    Ok(0) // active downloads count; UI already gated before calling
}

#[tauri::command]
fn quit_and_install(app: AppHandle) -> Result<(), String> {
    updater::install_downloaded()?;
    app.exit(0);
    #[allow(unreachable_code)]
    Ok(())
}

#[tauri::command]
fn get_update_state() -> updater::UpdaterState {
    updater::UpdaterState {
        status: "idle",
        update_info: None,
        progress: None,
        error: None,
        policy: updater::load_policy(),
    }
}

#[tauri::command]
fn set_update_channel(_channel: String) {}

#[tauri::command]
fn set_update_policy(check_automatically: Option<bool>, notify_when_ready: Option<bool>, install_automatically: Option<bool>) -> Result<(), String> {
    let mut p = updater::load_policy();
    if let Some(v) = check_automatically { p.check_automatically = v; }
    if let Some(v) = notify_when_ready { p.notify_when_ready = v; }
    if let Some(v) = install_automatically { p.install_automatically = v; }
    updater::save_policy(&p);
    Ok(())
}

/// Public wrapper so tray.rs can open dialog windows through the same path.
pub fn open_window_cmd(
    app: &AppHandle,
    window_type: String,
    params: Option<HashMap<String, String>>,
) -> Result<(), String> {
    open_window(app.clone(), window_type, params)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            // Second launch: focus the existing window and relay deep links.
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.show();
                let _ = w.unminimize();
                let _ = w.set_focus();
            }
            if let Some(url) = argv.iter().skip(1).find(|a| {
                a.starts_with("http://") || a.starts_with("https://") || a.starts_with("ndm://")
            }) {
                handle_incoming_url(app, url);
            }
        }))
        .plugin(tauri_plugin_deep_link::init())
        .manage(WindowState::default())
        .manage(EngineChild(Mutex::new(None)))
        .setup(|app| {
            let handle = app.handle().clone();

            // ndm:// registration + launch-time deep link capture.
            {
                use tauri_plugin_deep_link::DeepLinkExt;
                let _ = handle.deep_link().register("ndm");
            }

            // Tray + polling lifecycle (module owns its own threads).
            if let Err(e) = tray::create_tray(&handle) {
                log::warn!("tray init failed: {e}");
            }
            tray::start_polling(handle.clone());

            // Startup update check (6 s delay, gated by policy) — Electron parity.
            let h = handle.clone();
            std::thread::spawn(move || {
                std::thread::sleep(std::time::Duration::from_secs(6));
                if updater::load_policy().check_automatically {
                    let ver: &'static str = Box::leak(env!("CARGO_PKG_VERSION").to_string().into_boxed_str());
                    updater::check_for_updates(updater_emit(&h), ver);
                }
            });

            std::thread::spawn(move || {
                match spawn_engine(&handle) {
                    Ok((port, token)) => {
                        if !wait_for_engine(port, &token) {
                            log::error!("engine did not become ready on port {port}");
                        }
                        tray::set_engine(port, &token);
                        handle.manage(EngineInfo { port, token: token.clone() });
                        // The UI asks for credentials via engine_info; also
                        // push them as an event in case it loads early.
                        let _ = handle.emit("engine-ready", EngineReady { port, token });
                        if let Some(w) = handle.get_webview_window("main") {
                            let _ = w.show();
                            let _ = w.set_focus();
                        }
                    }
                    Err(e) => {
                        log::error!("engine spawn failed: {e}");
                        if let Some(w) = handle.get_webview_window("main") {
                            let _ = w.show();
                        }
                    }
                }
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            engine_info,
            minimize,
            maximize,
            close,
            resize_step,
            open_external,
            set_native_theme,
            beep,
            flash_window,
            select_folder,
            select_file,
            get_downloads_path,
            check_folder_exists,
            create_folder,
            open_file,
            open_folder,
            get_file_icon,
            show_native_message_box,
            open_window,
            close_window,
            open_download_window,
            notify,
            check_for_updates,
            download_update,
            install_update,
            quit_and_install,
            get_update_state,
            set_update_channel,
            set_update_policy,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| {
            // Keep the tray menu current while active; relay pending deep links.
            if let tauri::RunEvent::MainEventsCleared = event {
                if let Some(url) = pending_url().lock().unwrap().take() {
                    handle_incoming_url(app_handle, &url);
                }
                tray::refresh_menu(app_handle);
            }
            // Kill the engine when the app exits.
            if let tauri::RunEvent::ExitRequested { .. } = event {
                if let Some(child) = app_handle.state::<EngineChild>().0.lock().unwrap().take() {
                    let mut child = child;
                    let _ = child.kill();
                }
            }
        });
}

static PENDING_URL: OnceLock<Mutex<Option<String>>> = OnceLock::new();
fn pending_url() -> &'static Mutex<Option<String>> {
    PENDING_URL.get_or_init(|| Mutex::new(None))
}
