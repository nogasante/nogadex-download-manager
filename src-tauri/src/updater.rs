//! NDM updater for the Tauri shell.
//!
//! Same contract as the Electron shell: check the project's GitHub Releases
//! feed (latest.yml published by electron-builder / our release pipeline),
//! expose state { status, updateInfo, progress, error, policy } to the UI,
//! download the setup exe through the engine's own HTTP machinery (reuse:
//! plain reqwest here, since update downloads are one big file), then hand
//! off to the installer and exit.
//!
//! The feed format is the electron-builder `latest.yml`: version, path, sha512.
#![allow(dead_code)]

use std::sync::Mutex;
use std::sync::OnceLock;

use serde::{Deserialize, Serialize};

#[derive(Serialize, Clone)]
pub struct UpdaterState {
    pub status: &'static str, // idle|checking|available|not-available|downloading|downloaded|error
    pub update_info: Option<UpdateInfo>,
    pub progress: Option<Progress>,
    pub error: Option<String>,
    pub policy: Policy,
}

#[derive(Serialize, Clone, Deserialize)]
pub struct UpdateInfo {
    pub version: String,
    #[serde(rename = "releaseDate")]
    pub release_date: Option<String>,
    #[serde(rename = "releaseNotes")]
    pub release_notes: Option<String>,
}

#[derive(Serialize, Clone)]
pub struct Progress {
    pub percent: f64,
    #[serde(rename = "bytesPerSecond")]
    pub bytes_per_second: u64,
    pub transferred: u64,
    pub total: u64,
}

#[derive(Serialize, Clone, Deserialize)]
pub struct Policy {
    #[serde(rename = "checkAutomatically")]
    pub check_automatically: bool,
    #[serde(rename = "notifyWhenReady")]
    pub notify_when_ready: bool,
    #[serde(rename = "installAutomatically")]
    pub install_automatically: bool,
}

impl Default for Policy {
    fn default() -> Self {
        Self { check_automatically: true, notify_when_ready: true, install_automatically: false }
    }
}

pub struct SharedState(pub Mutex<UpdaterState>);

static POLICY_PATH: OnceLock<std::path::PathBuf> = OnceLock::new();

fn policy_path() -> &'static std::path::PathBuf {
    POLICY_PATH.get_or_init(|| {
        let home = dirs::home_dir().unwrap_or_else(|| std::path::PathBuf::from("."));
        home.join(".ndm").join("updater-policy.json")
    })
}

pub fn load_policy() -> Policy {
    let mut p = Policy::default();
    if let Ok(txt) = std::fs::read_to_string(policy_path()) {
        if let Ok(parsed) = serde_json::from_str::<Policy>(&txt) {
            p = parsed;
        }
    }
    p
}

pub fn save_policy(policy: &Policy) {
    if let Some(dir) = policy_path().parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    if let Ok(json) = serde_json::to_string_pretty(policy) {
        let _ = std::fs::write(policy_path(), json);
    }
}

#[derive(Deserialize)]
struct LatestYml {
    version: String,
    path: String,
    #[serde(default)]
    releaseDate: Option<String>,
    #[serde(default)]
    body: Option<String>,
}

fn repo_coords() -> (String, String) {
    // Mirrors site/app-config.json defaults; the engine serves remote config,
    // but for the shell the baked coordinates are fine (same repo).
    ("nogasante".into(), "nogadex-download-manager".into())
}

fn fetch_latest() -> Result<(LatestYml, String), String> {
    let (owner, repo) = repo_coords();
    let url = format!("https://github.com/{owner}/{repo}/releases/latest/download/latest.yml");
    let client = reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(20))
        .build()
        .map_err(|e| e.to_string())?;
    let yml = client
        .get(&url)
        .send()
        .map_err(|e| format!("network: {e}"))?
        .error_for_status()
        .map_err(|e| format!("feed: {e}"))?
        .text()
        .map_err(|e| e.to_string())?;

    // Minimal parse of the electron-builder latest.yml (avoid a yaml dep):
    // the first `version:`, `path:` and `releaseDate:` lines, body = notes block.
    let mut version = None;
    let mut path_ = None;
    let mut release_date = None;
    for line in yml.lines() {
        if version.is_none() && line.starts_with("version:") {
            version = Some(line.trim_start_matches("version:").trim().to_string());
        } else if path_.is_none() && line.starts_with("path:") {
            path_ = Some(line.trim_start_matches("path:").trim().to_string());
        } else if release_date.is_none() && line.starts_with("releaseDate:") {
            release_date = Some(line.trim_start_matches("releaseDate:").trim().trim_matches('\'').to_string());
        }
    }
    let version = version.ok_or("feed missing version")?;
    let path_ = path_.ok_or("feed missing path")?;
    Ok((
        LatestYml { version, path: path_, releaseDate: release_date, body: None },
        yml,
    ))
}

fn download_url(asset_path: &str) -> String {
    let (owner, repo) = repo_coords();
    format!("https://github.com/{owner}/{repo}/releases/latest/download/{}",
        urlencoding::encode(asset_path))
}

const UPDATE_DIR: &str = "ndm-update";

fn update_dir() -> std::path::PathBuf {
    let base = dirs::download_dir()
        .or_else(dirs::home_dir)
        .unwrap_or_else(|| std::path::PathBuf::from("."));
    let dir = base.join(UPDATE_DIR);
    let _ = std::fs::create_dir_all(&dir);
    dir
}

fn already_downloaded(version: &str) -> Option<std::path::PathBuf> {
    let dir = update_dir();
    let entries = std::fs::read_dir(&dir).ok()?;
    for e in entries.flatten() {
        let name = e.file_name().to_string_lossy().into_owned();
        if name.contains(version) && name.to_lowercase().ends_with(".exe") {
            return Some(e.path());
        }
    }
    None
}

/// Spawn the background check. Emits `updater-state-changed` through `emit`.
pub fn check_for_updates<F: Fn(UpdaterState) + Send + 'static>(
    emit: F,
    current_version: &'static str,
) {
    std::thread::spawn(move || {
        let set = |mut st: UpdaterState, emit: &F| {
            st.policy = load_policy();
            emit(st.clone());
            st
        };

        let st = set(UpdaterState {
            status: "checking",
            update_info: None, progress: None, error: None,
            policy: load_policy(),
        }, &emit);

        match fetch_latest() {
            Ok((latest, _raw)) => {
                let cmp = compare_versions(&latest.version, current_version);
                if cmp > 0 {
                    let info = UpdateInfo {
                        version: latest.version.clone(),
                        release_date: latest.releaseDate.clone(),
                        release_notes: latest.body.clone(),
                    };
                    let _ = set(UpdaterState {
                        status: "available",
                        update_info: Some(info),
                        progress: None, error: None,
                        policy: load_policy(),
                    }, &emit);
                    // installAutomatically = fully silent download
                    if load_policy().install_automatically {
                        download_update(emit);
                    }
                } else {
                    let _ = set(UpdaterState {
                        status: "not-available",
                        update_info: Some(UpdateInfo {
                            version: current_version.into(),
                            release_date: latest.releaseDate,
                            release_notes: latest.body,
                        }),
                        progress: None, error: None,
                        policy: load_policy(),
                    }, &emit);
                }
            }
            Err(e) => {
                let _ = set(UpdaterState {
                    status: "error",
                    update_info: None, progress: None,
                    error: Some(e),
                    policy: load_policy(),
                }, &emit);
            }
        }
    });
}

/// Download the new installer, emitting progress. On success -> status downloaded.
pub fn download_update<F: Fn(UpdaterState) + Send + 'static>(emit: F) {
    std::thread::spawn(move || {
        let latest = match fetch_latest() {
            Ok((l, _)) => l,
            Err(e) => {
                let _ = emit(UpdaterState {
                    status: "error",
                    update_info: None, progress: None, error: Some(e),
                    policy: load_policy(),
                });
                return;
            }
        };
        if let Some(existing) = already_downloaded(&latest.version) {
            let _ = emit(UpdaterState {
                status: "downloaded",
                update_info: Some(UpdateInfo {
                    version: latest.version.clone(),
                    release_date: latest.releaseDate,
                    release_notes: None,
                }),
                progress: None, error: None,
                policy: load_policy(),
            });
            let _ = existing; // install step re-resolves it
            return;
        }

        let url = download_url(&latest.path);
        let dest = update_dir().join(latest.path.clone());
        let client = reqwest::blocking::Client::builder()
            .timeout(std::time::Duration::from_secs(60 * 30))
            .build()
            .unwrap();
        let mut resp = match client.get(&url).send() {
            Ok(r) => r,
            Err(e) => {
                let _ = emit(UpdaterState {
                    status: "error", update_info: None, progress: None,
                    error: Some(format!("download: {e}")), policy: load_policy(),
                });
                return;
            }
        };
        let total = resp.content_length().unwrap_or(0);
        let mut file = match std::fs::File::create(&dest) {
            Ok(f) => f,
            Err(e) => {
                let _ = emit(UpdaterState {
                    status: "error", update_info: None, progress: None,
                    error: Some(format!("write: {e}")), policy: load_policy(),
                });
                return;
            }
        };
        let mut transferred: u64 = 0;
        let mut last_emit = std::time::Instant::now();
        use std::io::{Read, Write};
        let mut buf = [0u8; 65536];
        loop {
            match resp.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => {
                    if file.write_all(&buf[..n]).is_err() {
                        break;
                    }
                    transferred += n as u64;
                    if last_emit.elapsed().as_millis() > 250 {
                        last_emit = std::time::Instant::now();
                        let _ = emit(UpdaterState {
                            status: "downloading",
                            update_info: None,
                            progress: Some(Progress {
                                percent: if total > 0 { (transferred as f64 / total as f64) * 100.0 } else { 0.0 },
                                bytes_per_second: 0,
                                transferred,
                                total,
                            }),
                            error: None,
                            policy: load_policy(),
                        });
                    }
                }
                Err(_) => break,
            }
        }
        let _ = emit(UpdaterState {
            status: "downloaded",
            update_info: Some(UpdateInfo {
                version: latest.version.clone(),
                release_date: latest.releaseDate,
                release_notes: None,
            }),
            progress: None, error: None,
            policy: load_policy(),
        });
    });
}

/// Launch the downloaded installer and return the active downloads count the
/// UI may want for its safety prompt (the shell does not know; engine-side
/// count is fetched by the UI before calling install).
pub fn install_downloaded() -> Result<(), String> {
    let (_, raw) = fetch_latest()?;
    let version = raw
        .lines()
        .find_map(|l| l.strip_prefix("version:").map(|v| v.trim().to_string()))
        .ok_or("feed missing version")?;
    let path = already_downloaded(&version).ok_or("installer not downloaded yet")?;
    // NSIS supports /S for silent; we run interactive to match Electron flow.
    std::process::Command::new(path)
        .spawn()
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// electron-builder-style semver compare: >0 when a > b.
pub fn compare_versions(a: &str, b: &str) -> i32 {
    let parse = |s: &str| -> Vec<u64> {
        s.trim_start_matches('v')
            .split(|c| c == '.' || c == '-')
            .filter_map(|p| p.parse::<u64>().ok())
            .collect()
    };
    let (va, vb) = (parse(a), parse(b));
    for i in 0..3 {
        let x = va.get(i).copied().unwrap_or(0);
        let y = vb.get(i).copied().unwrap_or(0);
        if x != y {
            return if x > y { 1 } else { -1 };
        }
    }
    0
}
