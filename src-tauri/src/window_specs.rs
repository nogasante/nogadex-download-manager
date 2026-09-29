//! Standalone dialog window sizes, mirrored from electron/main.cjs
//! WINDOW_SPECS so both shells present identical geometry.

pub struct Spec {
    pub width: f64,
    pub height: f64,
    pub min_width: f64,
    pub min_height: f64,
    pub resizable: bool,
    pub always_on_top: bool,
}

const fn fixed(width: f64, height: f64) -> Spec {
    Spec { width, height, min_width: width, min_height: height, resizable: false, always_on_top: false }
}

pub fn get(window_type: &str) -> Spec {
    match window_type {
        // Tiny step-1 dialog: stays above the browser while the user copies
        // a link into it (clipboard auto-grab), so it must be non-modal and
        // always-on-top.
        "address-input" => Spec { always_on_top: true, ..fixed(560.0, 193.0) },
        "settings" => fixed(700.0, 660.0),
        "new-download" => fixed(580.0, 460.0),
        "batch" => fixed(660.0, 540.0),
        "site-grabber" => fixed(780.0, 660.0),
        "scheduler" => fixed(720.0, 600.0),
        "history" => fixed(560.0, 500.0),
        "diagnostics" => fixed(680.0, 560.0),
        "about" => fixed(500.0, 440.0),
        "properties" => fixed(620.0, 540.0),
        "download-status" => fixed(640.0, 560.0),
        "refresh-url" => fixed(520.0, 260.0),
        "advanced-settings" => fixed(520.0, 380.0),
        "help-center" => fixed(880.0, 660.0),
        _ => fixed(560.0, 460.0),
    }
}
