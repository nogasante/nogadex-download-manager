//! File-type icon extraction for the download table.
//!
//! Electron used `app.getFileIcon()` (native shell icons). WebView2/Tauri has
//! no equivalent IPC, so we map by extension to a crisp inline SVG data URL,
//! colored by file family. Zero disk I/O, instant, consistent across machines.

fn family(filename: &str) -> &'static str {
    let ext = filename.rsplit('.').next().unwrap_or("").to_lowercase();
    match ext.as_str() {
        "zip" | "rar" | "7z" | "tar" | "gz" | "bz2" | "xz" | "iso" => "archive",
        "mp3" | "wav" | "flac" | "ogg" | "m4a" | "aac" | "wma" => "audio",
        "mp4" | "mkv" | "avi" | "mov" | "webm" | "flv" | "wmv" | "m4v" | "mpg" | "mpeg" => "video",
        "jpg" | "jpeg" | "png" | "gif" | "webp" | "bmp" | "svg" | "ico" | "tif" | "tiff" => "image",
        "pdf" => "pdf",
        "doc" | "docx" | "odt" | "rtf" | "txt" | "md" => "doc",
        "xls" | "xlsx" | "ods" | "csv" => "sheet",
        "ppt" | "pptx" | "odp" => "slides",
        "exe" | "msi" | "bat" | "cmd" | "appx" => "app",
        "torrent" => "torrent",
        _ => "file",
    }
}

const COLORS: &[(&str, &str)] = &[
    ("archive", "#b0885a"),
    ("audio", "#7a5ab5"),
    ("video", "#d05a8f"),
    ("image", "#2f9e6e"),
    ("pdf", "#d05a5a"),
    ("doc", "#4a7ad0"),
    ("sheet", "#3f9e57"),
    ("slides", "#c77f3f"),
    ("app", "#5a6a7a"),
    ("torrent", "#3f8fb0"),
    ("file", "#8a94a0"),
];

const LABELS: &[(&str, &str)] = &[
    ("archive", "ZIP"),
    ("audio", "MP3"),
    ("video", "MP4"),
    ("image", "IMG"),
    ("pdf", "PDF"),
    ("doc", "DOC"),
    ("sheet", "XLS"),
    ("slides", "PPT"),
    ("app", "EXE"),
    ("torrent", "TOR"),
    ("file", "FILE"),
];

/// A small data URL the existing FileIcon component renders directly.
pub fn extract_data_url(_file_path: &str, filename: &str) -> String {
    let fam = family(filename);
    let color = COLORS.iter().find(|(k, _)| *k == fam).map(|(_, v)| *v).unwrap_or("#8a94a0");
    let label = LABELS.iter().find(|(k, _)| *k == fam).map(|(_, v)| *v).unwrap_or("FILE");
    let svg = format!(
        "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'>\
<rect x='5' y='2' width='22' height='28' rx='3' fill='#ffffff' stroke='{color}' stroke-width='1.5'/>\
<rect x='5' y='18' width='22' height='12' rx='3' fill='{color}'/>\
<text x='16' y='27' font-family='Segoe UI, sans-serif' font-size='7.5' font-weight='700' fill='#ffffff' text-anchor='middle'>{label}</text>\
</svg>"
    );
    format!("data:image/svg+xml;utf8,{}", urlencode(&svg))
}

fn urlencode(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' | b'\'' | b'(' | b')' | b'*' => out.push(b as char),
            other => out.push_str(&format!("%{other:02X}")),
        }
    }
    out
}
