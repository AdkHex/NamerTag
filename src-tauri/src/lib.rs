use regex::Regex;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::menu::{MenuBuilder, MenuItemBuilder, PredefinedMenuItem, SubmenuBuilder};
use tauri::{AppHandle, Emitter, Manager};

fn command_no_window(program: &str) -> Command {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        let mut cmd = Command::new(program);
        cmd.creation_flags(CREATE_NO_WINDOW);
        cmd
    }
    #[cfg(not(target_os = "windows"))]
    {
        let mut cmd = Command::new(program);
        // GUI launches (Finder/Dock) inherit a minimal PATH that omits Homebrew dirs, so
        // ffprobe/ffmpeg/mkvpropedit installed via Homebrew aren't found. Augment PATH.
        let current = std::env::var("PATH").unwrap_or_default();
        let mut parts = vec!["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin"];
        if !current.is_empty() {
            parts.push(current.as_str());
        }
        cmd.env("PATH", parts.join(":"));
        cmd
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
enum LocalPathKind {
    File,
    Folder,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct ClassifiedPath {
    path: String,
    kind: LocalPathKind,
}

// Validation functions
fn validate_filename(filename: &str) -> Result<(), String> {
    // Regex pattern: only alphanumeric, dash, underscore, dot
    let filename_pattern = Regex::new(r"^[a-zA-Z0-9_-]+(\.[a-zA-Z0-9]+)?$")
        .map_err(|e| format!("Regex compilation error: {e}"))?;

    if filename.is_empty() {
        return Err("Filename cannot be empty".to_string());
    }

    if filename.len() > 100 {
        return Err("Filename too long (max 100 characters)".to_string());
    }

    if !filename_pattern.is_match(filename) {
        return Err(
            "Invalid filename: only alphanumeric characters, dashes, underscores, and dots allowed"
                .to_string(),
        );
    }

    Ok(())
}

fn validate_string_input(input: &str, max_len: usize, field_name: &str) -> Result<(), String> {
    if input.len() > max_len {
        return Err(format!("{field_name} too long (max {max_len} characters)"));
    }
    Ok(())
}

fn validate_theme(theme: &str) -> Result<(), String> {
    match theme {
        "light" | "dark" | "system" | "gruvbox-dark" | "gruvbox-light" => Ok(()),
        _ => Err(
            "Invalid theme: must be 'light', 'dark', 'system', 'gruvbox-dark', or 'gruvbox-light'"
                .to_string(),
        ),
    }
}

// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn greet(name: &str) -> String {
    // Input validation
    if let Err(e) = validate_string_input(name, 100, "Name") {
        log::warn!("Invalid greet input: {e}");
        return format!("Error: {e}");
    }

    log::info!("Greeting user: {name}");
    format!("Hello, {name}! You've been greeted from Rust!")
}

// Preferences data structure
// Only contains settings that should be persisted to disk
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(default)]
pub struct AppPreferences {
    pub theme: String,
    #[serde(default = "default_auto_check_updates")]
    pub auto_check_updates: bool,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub selected_tag: String,
    #[serde(default)]
    pub filename_tag: String,
    #[serde(default = "default_video_track_template")]
    pub video_track_template: String,
    #[serde(default = "default_audio_track_template")]
    pub audio_track_template: String,
    #[serde(default = "default_subtitle_track_template")]
    pub subtitle_track_template: String,
    #[serde(default = "default_video_title_template")]
    pub video_title_template: String,
    #[serde(default = "default_bluray_filename_template")]
    pub bluray_filename_template: String,
    #[serde(default = "default_web_filename_template")]
    pub web_filename_template: String,
    #[serde(default)]
    pub encoder_name: String,
    #[serde(default)]
    pub print_type_override: String,
    #[serde(default = "default_naming_mode")]
    pub naming_mode: String,
    #[serde(default = "default_ionic_suffix")]
    pub ionic_suffix: String,
    #[serde(default)]
    pub remove_year: bool,
    #[serde(default = "default_language_priority")]
    pub language_priority: Vec<String>,
    #[serde(default)]
    pub legacy_container_title: bool,
    #[serde(default)]
    pub video_codec_overrides: std::collections::HashMap<String, String>,
    #[serde(default)]
    pub audio_codec_overrides: std::collections::HashMap<String, String>,
    #[serde(default)]
    pub language_overrides: std::collections::HashMap<String, String>,
    #[serde(default)]
    pub general_metadata: GeneralMetadata,
}

/// Shared "Extra Actions" metadata values written into a file's general/segment info. Persisted
/// so the user's branding (release website, encoder, Telegram handle) is remembered and editable.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
#[serde(default)]
pub struct GeneralMetadata {
    pub writing_application: String,
    pub muxing_application: String,
    pub website: String,
    pub encoded_by: String,
    pub telegram: String,
}

impl Default for AppPreferences {
    fn default() -> Self {
        Self {
            theme: "dark".to_string(),
            auto_check_updates: true,
            tags: Vec::new(),
            selected_tag: String::new(),
            filename_tag: String::new(),
            video_track_template: default_video_track_template(),
            audio_track_template: default_audio_track_template(),
            subtitle_track_template: default_subtitle_track_template(),
            video_title_template: default_video_title_template(),
            bluray_filename_template: default_bluray_filename_template(),
            web_filename_template: default_web_filename_template(),
            encoder_name: String::new(),
            print_type_override: String::new(),
            naming_mode: default_naming_mode(),
            ionic_suffix: default_ionic_suffix(),
            remove_year: false,
            language_priority: default_language_priority(),
            legacy_container_title: false,
            video_codec_overrides: std::collections::HashMap::new(),
            audio_codec_overrides: std::collections::HashMap::new(),
            language_overrides: std::collections::HashMap::new(),
            general_metadata: GeneralMetadata::default(),
        }
    }
}

fn default_naming_mode() -> String {
    "auto".to_string()
}

fn default_ionic_suffix() -> String {
    "Ionicboy".to_string()
}

fn default_language_priority() -> Vec<String> {
    vec!["hin".to_string(), "eng".to_string()]
}

fn default_video_track_template() -> String {
    "{resolution} / {source} / {hdr} / {remux} / {videoBitDepth} / {videoCodec} / {trackTag}"
        .to_string()
}

fn default_audio_track_template() -> String {
    "{language} / {audioCodec} {audioChannels} / {bitrate} / {sampleRate} / {audioBitDepth} / {trackTag}"
        .to_string()
}

fn default_subtitle_track_template() -> String {
    "{language} / {subtitleFlags} / {trackTag}".to_string()
}

fn default_video_title_template() -> String {
    "{title} ({year}) {seasonEpisode} - Downloaded from {filenameTag}".to_string()
}

fn default_bluray_filename_template() -> String {
    "{title} ({year}) {seasonEpisode} {resolution} {source} {remux} {bitDepth} {hdr} {videoCodec} [{audioList}] {codecSuffix} ({encoderName} - {filenameTag})".to_string()
}

fn default_web_filename_template() -> String {
    "{title} ({year}) {seasonEpisode} {resolution} {provider} {webType} {bitDepth} {hdr} {videoCodec} [{audioList}] {codecSuffix} ({encoderName} - {filenameTag})".to_string()
}

fn default_auto_check_updates() -> bool {
    true
}

fn get_preferences_path(app: &AppHandle) -> Result<PathBuf, String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data directory: {e}"))?;

    // Ensure the directory exists
    std::fs::create_dir_all(&app_data_dir)
        .map_err(|e| format!("Failed to create app data directory: {e}"))?;

    Ok(app_data_dir.join("preferences.json"))
}

#[tauri::command]
async fn load_preferences(app: AppHandle) -> Result<AppPreferences, String> {
    log::debug!("Loading preferences from disk");
    let prefs_path = get_preferences_path(&app)?;

    if !prefs_path.exists() {
        log::info!("Preferences file not found, using defaults");
        return Ok(AppPreferences::default());
    }

    let contents = std::fs::read_to_string(&prefs_path).map_err(|e| {
        log::error!("Failed to read preferences file: {e}");
        format!("Failed to read preferences file: {e}")
    })?;

    let preferences: AppPreferences = serde_json::from_str(&contents).map_err(|e| {
        log::error!("Failed to parse preferences JSON: {e}");
        format!("Failed to parse preferences: {e}")
    })?;

    log::info!("Successfully loaded preferences");
    Ok(preferences)
}

#[tauri::command]
async fn save_preferences(app: AppHandle, preferences: AppPreferences) -> Result<(), String> {
    // Validate theme value
    validate_theme(&preferences.theme)?;

    log::debug!("Saving preferences to disk: {preferences:?}");
    let prefs_path = get_preferences_path(&app)?;

    let json_content = serde_json::to_string_pretty(&preferences).map_err(|e| {
        log::error!("Failed to serialize preferences: {e}");
        format!("Failed to serialize preferences: {e}")
    })?;

    // Write to a temporary file first, then rename (atomic operation)
    let temp_path = prefs_path.with_extension("tmp");

    std::fs::write(&temp_path, json_content).map_err(|e| {
        log::error!("Failed to write preferences file: {e}");
        format!("Failed to write preferences file: {e}")
    })?;

    std::fs::rename(&temp_path, &prefs_path).map_err(|e| {
        log::error!("Failed to finalize preferences file: {e}");
        format!("Failed to finalize preferences file: {e}")
    })?;

    log::info!("Successfully saved preferences to {prefs_path:?}");
    Ok(())
}

#[tauri::command]
async fn send_native_notification(
    app: AppHandle,
    title: String,
    body: Option<String>,
) -> Result<(), String> {
    log::info!("Sending native notification: {title}");

    #[cfg(not(mobile))]
    {
        use tauri_plugin_notification::NotificationExt;

        let mut notification = app.notification().builder().title(title);

        if let Some(body_text) = body {
            notification = notification.body(body_text);
        }

        match notification.show() {
            Ok(_) => {
                log::info!("Native notification sent successfully");
                Ok(())
            }
            Err(e) => {
                log::error!("Failed to send native notification: {e}");
                Err(format!("Failed to send notification: {e}"))
            }
        }
    }

    #[cfg(mobile)]
    {
        log::warn!("Native notifications not supported on mobile");
        Err("Native notifications not supported on mobile".to_string())
    }
}

// Recovery functions - simple pattern for saving JSON data to disk
fn get_recovery_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data directory: {e}"))?;

    let recovery_dir = app_data_dir.join("recovery");

    // Ensure the recovery directory exists
    std::fs::create_dir_all(&recovery_dir)
        .map_err(|e| format!("Failed to create recovery directory: {e}"))?;

    Ok(recovery_dir)
}

#[tauri::command]
async fn save_emergency_data(app: AppHandle, filename: String, data: Value) -> Result<(), String> {
    log::info!("Saving emergency data to file: {filename}");

    // Validate filename with proper security checks
    validate_filename(&filename)?;

    // Validate data size (10MB limit)
    let data_str = serde_json::to_string(&data)
        .map_err(|e| format!("Failed to serialize data for size check: {e}"))?;
    if data_str.len() > 10_485_760 {
        return Err("Data too large (max 10MB)".to_string());
    }

    let recovery_dir = get_recovery_dir(&app)?;
    let file_path = recovery_dir.join(format!("{filename}.json"));

    let json_content = serde_json::to_string_pretty(&data).map_err(|e| {
        log::error!("Failed to serialize emergency data: {e}");
        format!("Failed to serialize data: {e}")
    })?;

    // Write to a temporary file first, then rename (atomic operation)
    let temp_path = file_path.with_extension("tmp");

    std::fs::write(&temp_path, json_content).map_err(|e| {
        log::error!("Failed to write emergency data file: {e}");
        format!("Failed to write data file: {e}")
    })?;

    std::fs::rename(&temp_path, &file_path).map_err(|e| {
        log::error!("Failed to finalize emergency data file: {e}");
        format!("Failed to finalize data file: {e}")
    })?;

    log::info!("Successfully saved emergency data to {file_path:?}");
    Ok(())
}

#[tauri::command]
async fn load_emergency_data(app: AppHandle, filename: String) -> Result<Value, String> {
    log::info!("Loading emergency data from file: {filename}");

    // Validate filename with proper security checks
    validate_filename(&filename)?;

    let recovery_dir = get_recovery_dir(&app)?;
    let file_path = recovery_dir.join(format!("{filename}.json"));

    if !file_path.exists() {
        log::info!("Recovery file not found: {file_path:?}");
        return Err("File not found".to_string());
    }

    let contents = std::fs::read_to_string(&file_path).map_err(|e| {
        log::error!("Failed to read recovery file: {e}");
        format!("Failed to read file: {e}")
    })?;

    let data: Value = serde_json::from_str(&contents).map_err(|e| {
        log::error!("Failed to parse recovery JSON: {e}");
        format!("Failed to parse data: {e}")
    })?;

    log::info!("Successfully loaded emergency data");
    Ok(data)
}

#[tauri::command]
async fn cleanup_old_recovery_files(app: AppHandle) -> Result<u32, String> {
    log::info!("Cleaning up old recovery files");

    let recovery_dir = get_recovery_dir(&app)?;
    let mut removed_count = 0;

    // Calculate cutoff time (7 days ago)
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|e| format!("Failed to get current time: {e}"))?
        .as_secs();
    let seven_days_ago = now.saturating_sub(7 * 24 * 60 * 60);

    // Read directory and check each file
    let entries = std::fs::read_dir(&recovery_dir).map_err(|e| {
        log::error!("Failed to read recovery directory: {e}");
        format!("Failed to read directory: {e}")
    })?;

    for entry in entries {
        let entry = match entry {
            Ok(e) => e,
            Err(e) => {
                log::warn!("Failed to read directory entry: {e}");
                continue;
            }
        };

        let path = entry.path();

        // Only process JSON files
        if path.extension().is_none_or(|ext| ext != "json") {
            continue;
        }

        // Check file modification time
        let metadata = match std::fs::metadata(&path) {
            Ok(m) => m,
            Err(e) => {
                log::warn!("Failed to get file metadata: {e}");
                continue;
            }
        };

        let modified = match metadata.modified() {
            Ok(m) => m,
            Err(e) => {
                log::warn!("Failed to get file modification time: {e}");
                continue;
            }
        };

        let modified_secs = match modified.duration_since(UNIX_EPOCH) {
            Ok(d) => d.as_secs(),
            Err(e) => {
                log::warn!("Failed to convert modification time: {e}");
                continue;
            }
        };

        // Remove if older than 7 days
        if modified_secs < seven_days_ago {
            match std::fs::remove_file(&path) {
                Ok(_) => {
                    log::info!("Removed old recovery file: {path:?}");
                    removed_count += 1;
                }
                Err(e) => {
                    log::warn!("Failed to remove old recovery file: {e}");
                }
            }
        }
    }

    log::info!("Cleanup complete. Removed {removed_count} old recovery files");
    Ok(removed_count)
}

/// A leftover RsKv working file is either a temp output (`*.rskv.tmp*`) or a backup copy
/// (`*.rskv.*.backup*`), matching the conventions in `build_temp_output_path` /
/// `build_backup_output_path`.
fn is_stale_artifact_name(name: &str) -> bool {
    name.contains(".rskv.tmp") || (name.contains(".rskv.") && name.contains(".backup"))
}

/// Reclaim orphaned `.rskv.tmp` / `.rskv.*.backup` files left next to the source media by a
/// crashed retag/remux. Best-effort: logs and continues on any error. Only removes files
/// older than `STALE_ARTIFACT_MAX_AGE_SECS` so an in-flight write in another process is not
/// clobbered.
fn cleanup_stale_artifacts(parent: &Path) {
    const STALE_ARTIFACT_MAX_AGE_SECS: u64 = 60 * 60; // 1 hour

    if parent.as_os_str().is_empty() {
        return;
    }
    let now = match SystemTime::now().duration_since(UNIX_EPOCH) {
        Ok(d) => d.as_secs(),
        Err(e) => {
            log::warn!("cleanup_stale_artifacts: failed to read clock: {e}");
            return;
        }
    };
    let cutoff = now.saturating_sub(STALE_ARTIFACT_MAX_AGE_SECS);

    let entries = match std::fs::read_dir(parent) {
        Ok(e) => e,
        Err(e) => {
            log::warn!("cleanup_stale_artifacts: failed to read {parent:?}: {e}");
            return;
        }
    };

    for entry in entries.flatten() {
        let path = entry.path();
        let name = match path.file_name().and_then(|n| n.to_str()) {
            Some(n) if is_stale_artifact_name(n) => n.to_string(),
            _ => continue,
        };
        let modified_secs = std::fs::metadata(&path)
            .and_then(|m| m.modified())
            .ok()
            .and_then(|m| m.duration_since(UNIX_EPOCH).ok())
            .map(|d| d.as_secs());
        match modified_secs {
            Some(secs) if secs < cutoff => match std::fs::remove_file(&path) {
                Ok(_) => log::info!("Removed stale artifact: {name}"),
                Err(e) => log::warn!("Failed to remove stale artifact {name}: {e}"),
            },
            _ => {}
        }
    }
}

/// Sweep the unique parent directories of the given media paths for stale RsKv artifacts.
fn cleanup_stale_artifacts_for_paths<'a>(paths: impl IntoIterator<Item = &'a str>) {
    let mut seen: std::collections::HashSet<PathBuf> = std::collections::HashSet::new();
    for path in paths {
        if let Some(parent) = Path::new(path).parent() {
            if seen.insert(parent.to_path_buf()) {
                cleanup_stale_artifacts(parent);
            }
        }
    }
}

#[tauri::command]
async fn classify_paths(paths: Vec<String>) -> Vec<ClassifiedPath> {
    paths
        .into_iter()
        .map(|path| {
            let kind = match std::fs::metadata(&path) {
                Ok(metadata) if metadata.is_dir() => LocalPathKind::Folder,
                Ok(_) => LocalPathKind::File,
                Err(e) => {
                    log::warn!("Failed to classify path {path:?}: {e}");
                    LocalPathKind::File
                }
            };

            ClassifiedPath { path, kind }
        })
        .collect()
}

#[derive(Serialize)]
struct MediaAnalysis {
    general: GeneralInfo,
    video: Vec<VideoStream>,
    audio: Vec<AudioStream>,
    subtitles: Vec<SubtitleStream>,
}

#[derive(Serialize)]
struct GeneralInfo {
    container: GeneralContainer,
    file: GeneralFile,
    derived: GeneralDerived,
}

#[derive(Serialize)]
struct GeneralContainer {
    format_name: Option<String>,
    duration_seconds: Option<f64>,
    size_bytes: Option<u64>,
    overall_bitrate: Option<u64>,
}

#[derive(Serialize)]
struct GeneralFile {
    path: Option<String>,
    filename: Option<String>,
    extension: Option<String>,
}

#[derive(Serialize)]
struct GeneralDerived {
    title: Option<String>,
    year: Option<u16>,
    source: Option<String>,
    release_type: Option<String>,
    resolution_tag: Option<String>,
    codec_tag: Option<String>,
    bit_depth_tag: Option<String>,
    hdr_tag: Option<String>,
    release_group: Option<String>,
}

#[derive(Serialize)]
struct VideoStream {
    stream_index: i64,
    codec: VideoCodec,
    dimensions: VideoDimensions,
    bitrate: VideoBitrate,
    frame_rate: VideoFrameRate,
    pixel: VideoPixel,
    color: VideoColor,
    hdr: VideoHdr,
    derived: VideoDerived,
}

#[derive(Serialize)]
struct VideoCodec {
    name: Option<String>,
    long_name: Option<String>,
    profile: Option<String>,
    level: Option<i64>,
}

#[derive(Serialize)]
struct VideoDimensions {
    width: Option<i64>,
    height: Option<i64>,
    resolution_tag: Option<String>,
}

#[derive(Serialize)]
struct VideoBitrate {
    bitrate: Option<u64>,
    max_bitrate: Option<u64>,
}

#[derive(Serialize)]
struct VideoFrameRate {
    avg: Option<String>,
    real: Option<f64>,
}

#[derive(Serialize)]
struct VideoPixel {
    pixel_format: Option<String>,
    bit_depth: Option<i64>,
}

#[derive(Serialize)]
struct VideoColor {
    primaries: Option<String>,
    transfer: Option<String>,
    matrix: Option<String>,
}

#[derive(Serialize)]
struct VideoHdr {
    #[serde(rename = "type")]
    hdr_type: Option<String>,
    is_hdr: bool,
    is_dolby_vision: bool,
    dolby_vision: DolbyVisionInfo,
    hdr10: Hdr10Info,
}

#[derive(Serialize)]
struct DolbyVisionInfo {
    profile: Option<String>,
    level: Option<String>,
}

#[derive(Serialize)]
struct Hdr10Info {
    mastering_display: bool,
    max_cll: Option<String>,
}

#[derive(Serialize)]
struct VideoDerived {
    source_type: Option<String>,
    encode_type: Option<String>,
}

#[derive(Serialize)]
struct AudioStream {
    stream_index: i64,
    /// Existing embedded track title, passed through verbatim so the renderer can keep
    /// distinguishing text (e.g. which commentary a track is) that a generated title
    /// cannot reproduce.
    title: Option<String>,
    codec: AudioCodec,
    channels: AudioChannels,
    bitrate: Option<u64>,
    sample_rate: Option<u64>,
    bit_depth: Option<i64>,
    language: LanguageInfo,
    flags: AudioFlags,
    derived: AudioDerived,
}

#[derive(Serialize)]
struct AudioCodec {
    name: Option<String>,
    long_name: Option<String>,
    profile: Option<String>,
}

#[derive(Serialize)]
struct AudioChannels {
    count: Option<i64>,
    layout: Option<String>,
}

#[derive(Serialize)]
struct LanguageInfo {
    code: Option<String>,
    name: Option<String>,
}

#[derive(Serialize)]
struct AudioFlags {
    atmos: bool,
    lossless: bool,
    /// Director's commentary / audio-description track. Excluded from the filename's audio
    /// block so it never reads as a second main language track.
    commentary: bool,
}

#[derive(Serialize)]
struct AudioDerived {
    display_name: Option<String>,
}

#[derive(Serialize)]
struct SubtitleStream {
    stream_index: i64,
    codec: Option<String>,
    title: Option<String>,
    language: LanguageInfo,
    flags: SubtitleFlags,
}

#[derive(Serialize)]
struct SubtitleFlags {
    forced: bool,
    default: bool,
    hearing_impaired: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RetagRequest {
    path: String,
    container_title: Option<String>,
    video_titles: Vec<String>,
    audio_titles: Vec<String>,
    subtitle_titles: Vec<String>,
    /// ffprobe `stream_index` for each entry in the corresponding `*_titles` vec. The
    /// analyzer drops cover-art streams, so positional `track:v1/a1/s1` selectors do NOT
    /// line up with the tracks in the file — a poster muxed ahead of the video would take
    /// the video's title. These let the writer address tracks by their real stream index.
    /// Optional so an older cached payload still retags (falling back to positional).
    #[serde(default)]
    video_stream_indexes: Vec<i64>,
    #[serde(default)]
    audio_stream_indexes: Vec<i64>,
    #[serde(default)]
    subtitle_stream_indexes: Vec<i64>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct RetagResult {
    path: String,
    success: bool,
    error: Option<String>,
}

fn parse_u64(value: &Value) -> Option<u64> {
    value
        .as_str()
        .and_then(|s| s.parse::<u64>().ok())
        .or_else(|| value.as_u64())
}

fn parse_f64(value: &Value) -> Option<f64> {
    value
        .as_str()
        .and_then(|s| s.parse::<f64>().ok())
        .or_else(|| value.as_f64())
}

fn parse_rational(value: &str) -> Option<f64> {
    let parts: Vec<&str> = value.split('/').collect();
    if parts.len() == 2 {
        let num = parts[0].parse::<f64>().ok()?;
        let den = parts[1].parse::<f64>().ok()?;
        if den == 0.0 {
            return None;
        }
        return Some(num / den);
    }
    value.parse::<f64>().ok()
}

fn get_language_name(code: &str) -> Option<String> {
    let normalized = code.to_lowercase();
    let base = normalized.split('-').next().unwrap_or(normalized.as_str());
    let name = match base {
        "eng" | "en" => "English",
        "hin" | "hi" => "Hindi",
        "tam" | "ta" => "Tamil",
        "tel" | "te" => "Telugu",
        "mal" | "ml" => "Malayalam",
        "kan" | "kn" => "Kannada",
        "jpn" | "ja" => "Japanese",
        "kor" | "ko" => "Korean",
        "spa" | "es" => "Spanish",
        "fre" | "fra" | "fr" => "French",
        "chi" | "zho" | "zh" => "Chinese",
        "rom" | "ron" | "rum" | "ro" => "Romanian",
        "urd" | "ur" => "Urdu",
        "ben" | "bn" => "Bengali",
        "mar" | "mr" => "Marathi",
        "guj" | "gu" => "Gujarati",
        "pan" | "pa" => "Punjabi",
        "ara" | "ar" => "Arabic",
        "deu" | "ger" | "de" => "German",
        "ita" | "it" => "Italian",
        "por" | "pt" => "Portuguese",
        "rus" | "ru" => "Russian",
        "vie" | "vi" => "Vietnamese",
        "tha" | "th" => "Thai",
        "ind" | "id" => "Indonesian",
        "msa" | "may" | "ms" => "Malay",
        "tur" | "tr" => "Turkish",
        "ukr" | "uk" => "Ukrainian",
        "pol" | "pl" => "Polish",
        "nld" | "dut" | "nl" => "Dutch",
        "swe" | "sv" => "Swedish",
        "nor" | "no" => "Norwegian",
        "dan" | "da" => "Danish",
        "fin" | "fi" => "Finnish",
        "heb" | "he" => "Hebrew",
        "ell" | "gre" | "el" => "Greek",
        "ces" | "cze" | "cs" => "Czech",
        "hun" | "hu" => "Hungarian",
        "bul" | "bg" => "Bulgarian",
        "srp" | "sr" => "Serbian",
        "hrv" | "hr" => "Croatian",
        "slv" | "sl" => "Slovenian",
        _ => return None,
    };
    Some(name.to_string())
}

fn get_audio_codec_tag(codec: &Option<String>, profile: &Option<String>) -> Option<String> {
    let codec = codec.as_ref()?.to_lowercase();
    let hint = profile
        .as_ref()
        .map(|p| p.to_lowercase())
        .unwrap_or_default();
    // PCM/LPCM family: ffprobe reports pcm_s16le, pcm_s24le, pcm_bluray, ...
    if codec.starts_with("pcm") {
        return Some("PCM".to_string());
    }
    if codec == "dts" {
        // Whole-word matching only. A plain `contains` misfires badly: "DTS Express"
        // contains "es" (-> DTS-ES) and "DTS-HD Master Audio" contains "ma" anywhere.
        // Mirrors naming-engine.ts:mapAudioCodec.
        let has_word = |needle: &str| {
            hint.split(|c: char| !c.is_alphanumeric())
                .any(|word| word == needle)
        };
        // "dts:x" / "dts-x" split into ["dts","x"], so match that adjacency directly.
        let words: Vec<&str> = hint
            .split(|c: char| !c.is_alphanumeric())
            .filter(|w| !w.is_empty())
            .collect();
        let has_dts_x = has_word("dtsx")
            || words
                .windows(2)
                .any(|pair| pair[0] == "dts" && pair[1] == "x");
        let tag = if has_dts_x {
            "DTS:X"
        } else if has_word("ma") || has_word("master") {
            "DTS-HD MA"
        } else if has_word("hra") || hint.contains("high res") {
            "DTS-HD HRA"
        } else if has_word("es") {
            "DTS-ES"
        } else if has_word("express") {
            "DTS Express"
        } else {
            "DTS"
        };
        return Some(tag.to_string());
    }
    let tag = match codec.as_str() {
        "eac3" => "DDP",
        "ac3" => "DD",
        "truehd" | "mlp" => "TrueHD",
        "aac" => "AAC",
        "flac" => "FLAC",
        "opus" => "Opus",
        "mp3" => "MP3",
        "alac" => "ALAC",
        "vorbis" => "Vorbis",
        "wmav2" | "wmapro" => "WMA",
        _ => return None,
    };
    Some(tag.to_string())
}

/// Detect Dolby Atmos (object audio) on an audio stream.
///
/// Atmos is carried as a substream: TrueHD+Atmos and E-AC-3 JOC. ffprobe does not expose a
/// dedicated flag, so we combine every signal it *does* surface:
///   * `profile` / `codec_long_name` mentioning Atmos or JOC,
///   * the E-AC-3 JOC side-data / `complexity_index` that ffprobe emits for DDP Atmos,
///   * the embedded track title (last resort).
///
/// The title is checked LAST and is deliberately not the only signal: retagging rewrites
/// that title, so a title-only detector loses Atmos on the second pass over the same file
/// (write "TrueHD 7.1" once and the flag is gone forever). Codec+profile survive retagging.
fn detect_atmos(
    stream: &Value,
    codec_name: Option<&str>,
    profile: Option<&str>,
    codec_long_name: Option<&str>,
    title: Option<&str>,
) -> bool {
    let codec = codec_name.unwrap_or("").to_ascii_lowercase();
    // Only these families can carry Atmos. `mlp` is TrueHD's raw form and was previously
    // omitted here even though it maps to TrueHD everywhere else.
    if !matches!(codec.as_str(), "truehd" | "mlp" | "eac3") {
        return false;
    }

    let mentions_atmos = |value: Option<&str>| {
        value
            .map(|v| {
                let lower = v.to_ascii_lowercase();
                lower.contains("atmos") || lower.contains("joc")
            })
            .unwrap_or(false)
    };
    if mentions_atmos(profile) || mentions_atmos(codec_long_name) {
        return true;
    }

    // E-AC-3 JOC: ffprobe reports the joint-object-coding side data / complexity index for
    // DDP Atmos tracks even when the profile string is bare.
    if let Some(list) = stream.get("side_data_list").and_then(|v| v.as_array()) {
        for item in list {
            let side_type = item
                .get("side_data_type")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_ascii_lowercase();
            if side_type.contains("joc") || side_type.contains("object") {
                return true;
            }
            if item
                .get("complexity_index")
                .and_then(|v| v.as_i64())
                .map(|v| v > 0)
                .unwrap_or(false)
            {
                return true;
            }
        }
    }

    mentions_atmos(title)
}

/// Lossless audio families. Previously only TrueHD set this flag, so FLAC / PCM / ALAC /
/// DTS-HD MA all reported `lossless: false` to the UI.
fn is_lossless_audio(codec_name: Option<&str>, profile: Option<&str>) -> bool {
    let codec = codec_name.unwrap_or("").to_ascii_lowercase();
    if codec.starts_with("pcm") {
        return true;
    }
    if matches!(codec.as_str(), "truehd" | "mlp" | "flac" | "alac" | "wavpack" | "tta") {
        return true;
    }
    if codec == "dts" {
        // Reuse the canonical profile mapper rather than re-testing substrings here: a bare
        // `contains("ma")` matches any profile with those two letters anywhere.
        // DTS-HD MA and DTS:X are lossless; DTS-HD HRA, DTS-ES and plain DTS are not.
        return matches!(
            get_audio_codec_tag(&Some(codec), &profile.map(str::to_string)).as_deref(),
            Some("DTS-HD MA") | Some("DTS:X")
        );
    }
    false
}

fn get_channel_layout(count: Option<i64>, layout: &Option<String>) -> Option<String> {
    if let Some(ch) = count {
        let mapped = match ch {
            8 => Some("7.1"),
            7 => Some("6.1"),
            6 => Some("5.1"),
            5 => Some("5.0"),
            4 => Some("4.0"),
            3 => Some("3.0"),
            2 => Some("2.0"),
            1 => Some("1.0"),
            _ => None,
        };
        if let Some(value) = mapped {
            return Some(value.to_string());
        }
    }
    // Fall back to the raw layout, always stripping the parenthetical suffix
    // (e.g. "6.1(back)" -> "6.1") so it never leaks into a tag.
    let from_layout = layout.as_ref().and_then(|value| {
        let cleaned = value.split('(').next().unwrap_or(value).trim();
        if cleaned.is_empty() {
            None
        } else {
            let mapped = match cleaned.to_lowercase().as_str() {
                "stereo" => "2.0",
                "mono" => "1.0",
                _ => cleaned,
            };
            Some(mapped.to_string())
        }
    });
    if from_layout.is_some() {
        return from_layout;
    }
    // Unmapped count with no layout: render "N.0", never a bare digit.
    count.filter(|c| *c > 0).map(|c| format!("{c}.0"))
}

fn bps_from_tags(stream: &Value) -> Option<u64> {
    // Matroska carries per-track bitrate in tags (BPS / BPS-eng), not in `bit_rate`.
    let tags = stream.get("tags").and_then(|v| v.as_object())?;
    for key in ["BPS", "BPS-eng", "BPS_ENG", "bit_rate", "BIT_RATE"] {
        if let Some(value) = tags.get(key).and_then(parse_u64) {
            return Some(value);
        }
    }
    None
}

fn get_video_bitrate(stream: &Value) -> Option<u64> {
    stream
        .get("bit_rate")
        .and_then(parse_u64)
        .or_else(|| stream.get("max_bit_rate").and_then(parse_u64))
        .or_else(|| bps_from_tags(stream))
}

fn get_audio_bitrate(
    stream: &Value,
    sample_rate: Option<u64>,
    channels: Option<i64>,
) -> Option<u64> {
    let direct = stream
        .get("bit_rate")
        .and_then(parse_u64)
        .or_else(|| stream.get("max_bit_rate").and_then(parse_u64));
    if direct.is_some() {
        return direct;
    }

    if let Some(tags) = stream.get("tags").and_then(|v| v.as_object()) {
        for key in ["BPS", "BPS-eng", "BPS_ENG", "bit_rate", "BIT_RATE"] {
            if let Some(value) = tags.get(key).and_then(parse_u64) {
                return Some(value);
            }
        }
    }

    let bits_per_sample = stream
        .get("bits_per_raw_sample")
        .and_then(|v| v.as_u64())
        .or_else(|| stream.get("bits_per_sample").and_then(|v| v.as_u64()));
    match (bits_per_sample, sample_rate, channels) {
        (Some(bits), Some(rate), Some(ch)) if ch > 0 => {
            Some(bits.saturating_mul(rate).saturating_mul(ch as u64))
        }
        _ => None,
    }
}

/// Embedded cover art / poster / thumbnail? ffprobe lists these as `codec_type == "video"`
/// streams, so without this guard a muxed-in poster that precedes the real track becomes the
/// "primary" video and corrupts the resolution / codec / HDR / bit-depth tags (a 1000x1500
/// poster reads as 1080p; a 600x900 one drops the resolution entirely). The canonical signal
/// is the `attached_pic` disposition; still-image codecs (mjpeg/png/...) are the fallback for
/// muxes that don't set it. Real movie/TV video is always h264/hevc/av1/vc1/mpeg2/vp9, so
/// treating a still-image codec as cover art is safe in this domain.
fn is_cover_art_stream(stream: &Value, codec_name: Option<&str>) -> bool {
    let attached_pic = stream
        .get("disposition")
        .and_then(|d| d.get("attached_pic"))
        .and_then(|v| v.as_i64())
        .map(|v| v == 1)
        .unwrap_or(false);
    if attached_pic {
        return true;
    }
    matches!(
        codec_name.unwrap_or("").to_ascii_lowercase().as_str(),
        "mjpeg" | "mjpg" | "jpeg" | "jpg" | "png" | "bmp" | "gif" | "tiff" | "webp" | "ppm"
    )
}

fn get_resolution_tag(width: Option<i64>, height: Option<i64>) -> Option<String> {
    let w = width.unwrap_or(0);
    let h = height.unwrap_or(0);
    if w <= 0 && h <= 0 {
        return None;
    }
    // Bucket by the dominant dimension. UHD/4K films are frequently letterboxed
    // (e.g. 3840x1608 for 2.40:1), so a height-only check misclassifies them as 1080p and
    // loses the "UHD BluRay" source. Use width as the primary signal, height as a fallback.
    //
    // Thresholds sit just below each nominal width so slightly-cropped and anamorphic prints
    // still land in the right bucket (e.g. 3840x1600, 1920x800, 1280x536).
    let tag = if w >= 3840 || h >= 2160 {
        "2160p"
    } else if w >= 2560 || h >= 1440 {
        "1440p"
    } else if w >= 1920 || h >= 1080 {
        "1080p"
    } else if w >= 1280 || h >= 720 {
        "720p"
    } else if w >= 640 || h >= 480 {
        // 720x480 (NTSC) and 720x576 (PAL) both read as 480p here; the distinction is not
        // meaningful for naming and scene names use "480p" for both.
        "480p"
    } else {
        return None;
    };
    Some(tag.to_string())
}

fn get_codec_tag(codec: &Option<String>) -> Option<String> {
    let codec = codec.as_ref()?.to_lowercase();
    match codec.as_str() {
        "h264" => Some("x264".to_string()),
        "hevc" => Some("x265".to_string()),
        _ => None,
    }
}

fn get_bit_depth(stream: &Value) -> Option<i64> {
    if let Some(value) = stream.get("bits_per_raw_sample").and_then(|v| v.as_i64()) {
        if value > 0 {
            return Some(value);
        }
    }
    if let Some(value) = stream.get("bits_per_sample").and_then(|v| v.as_i64()) {
        if value > 0 {
            return Some(value);
        }
    }
    if let Some(pix_fmt) = stream.get("pix_fmt").and_then(|v| v.as_str()) {
        if let Some(caps) = Regex::new(r"p(\d{1,2})").ok()?.captures(pix_fmt) {
            if let Some(m) = caps.get(1) {
                return m.as_str().parse::<i64>().ok();
            }
        }
    }
    None
}

fn has_dolby_vision(stream: &Value) -> (bool, Option<String>, Option<String>) {
    let mut profile = None;
    let mut level = None;
    if let Some(list) = stream.get("side_data_list").and_then(|v| v.as_array()) {
        for item in list {
            if item
                .get("side_data_type")
                .and_then(|v| v.as_str())
                .map(|s| s.contains("DOVI"))
                .unwrap_or(false)
            {
                profile = item
                    .get("dv_profile")
                    .and_then(|v| v.as_i64())
                    .map(|v| v.to_string());
                level = item
                    .get("dv_level")
                    .and_then(|v| v.as_i64())
                    .map(|v| v.to_string());
                return (true, profile, level);
            }
        }
    }
    (false, profile, level)
}

fn get_hdr10_meta(stream: &Value) -> (bool, Option<String>) {
    let mut mastering_display = false;
    let mut max_cll = None;
    if let Some(list) = stream.get("side_data_list").and_then(|v| v.as_array()) {
        for item in list {
            if item
                .get("side_data_type")
                .and_then(|v| v.as_str())
                .map(|s| s.contains("Mastering display metadata"))
                .unwrap_or(false)
            {
                mastering_display = true;
            }
            if item
                .get("side_data_type")
                .and_then(|v| v.as_str())
                .map(|s| s.contains("Content light level metadata"))
                .unwrap_or(false)
            {
                max_cll = item
                    .get("max_cll")
                    .and_then(|v| v.as_i64())
                    .map(|v| v.to_string());
            }
        }
    }
    (mastering_display, max_cll)
}

fn parse_filename_parts(path: &str) -> (Option<String>, Option<String>, Option<String>) {
    let file = Path::new(path);
    let filename = file
        .file_name()
        .and_then(|v| v.to_str())
        .map(|v| v.to_string());
    let extension = file
        .extension()
        .and_then(|v| v.to_str())
        .map(|v| v.to_string());
    (Some(path.to_string()), filename, extension)
}

fn parse_title_year(filename: &str) -> (Option<String>, Option<u16>) {
    let base = filename.rsplit_once('.').map(|v| v.0).unwrap_or(filename);
    let mut clean = base.replace(['.', '_'], " ");
    if let Ok(re) = Regex::new(r"\s+") {
        clean = re.replace_all(&clean, " ").trim().to_string();
    }
    // Prefer the LAST year-like token so titled-year films (Blade Runner 2049) keep the
    // title and pick the release year, not the in-title number. Mirrors
    // naming-engine.ts:parseTitleYear.
    let year_re = Regex::new(r"\b(19|20)\d{2}\b").ok();
    let year_match = year_re
        .as_ref()
        .and_then(|re| re.find_iter(&clean).last());
    let year = year_match
        .as_ref()
        .and_then(|m| m.as_str().parse::<u16>().ok());
    let year_idx = year_match.as_ref().map(|m| m.start());

    // For series without a year, the title ends at the SxxExx marker.
    let se_idx = Regex::new(r"(?i)\bS\d{1,2}E\d{1,2}\b")
        .ok()
        .and_then(|re| re.find(&clean))
        .map(|m| m.start());

    let mut cut = [year_idx, se_idx].into_iter().flatten().min();

    // No year and no SxxExx: fall back to the first technical token boundary so we don't
    // swallow the whole release string into the title.
    if cut.is_none() {
        if let Ok(re) = Regex::new(
            r"(?i)\b(2160p|1080p|720p|480p|4k|blu[\s.-]?ray|web[\s.-]?dl|webrip|hdrip|remux|uhd|x26[45]|h\.?26[45]|hevc|avc|vc-?1)\b",
        ) {
            if let Some(m) = re.find(&clean) {
                if m.start() > 0 {
                    cut = Some(m.start());
                }
            }
        }
    }

    let title = match cut {
        Some(idx) => {
            let part = clean[..idx]
                .trim_end_matches(['[', '(', '{', ' '].as_ref())
                .trim()
                .to_string();
            if part.is_empty() {
                None
            } else {
                Some(part)
            }
        }
        // No year / SxxExx / tech token: the whole cleaned string is the title.
        None if !clean.is_empty() => Some(clean),
        None => None,
    };
    (title, year)
}

/// Source from the filename. Mirrors naming-engine.ts:detectSource so the metadata written
/// INSIDE the file agrees with the generated filename.
///
/// Scene names are dot-separated ("UHD.Blu-Ray"), so the old literal " uhd bluray" match
/// never fired and every UHD disc rip was labeled plain "BluRay" in the video track title
/// while the filename said "UHD BluRay". Separators are normalized before matching, and
/// 2160p implies the UHD variant of a BluRay just as it does in the naming engine.
fn get_source_from_filename(filename: &str) -> Option<String> {
    let lower = filename.to_lowercase();
    // Collapse scene separators so "uhd.blu-ray" / "uhd_bluray" all read as "uhd bluray".
    let normalized: String = lower
        .chars()
        .map(|c| if c == '.' || c == '_' || c == '-' { ' ' } else { c })
        .collect();
    let has_word = |needle: &str| {
        normalized
            .split_whitespace()
            .any(|word| word == needle)
    };

    if normalized.contains("web dl") || has_word("webdl") {
        return Some("WEB-DL".to_string());
    }
    if has_word("webrip") {
        return Some("WEB-DL".to_string());
    }
    if normalized.contains("blu ray") || has_word("bluray") {
        // "UHD" or a 2160p tag makes it the UHD disc; either alone is enough.
        if has_word("uhd") || has_word("2160p") || has_word("4k") {
            return Some("UHD BluRay".to_string());
        }
        return Some("BluRay".to_string());
    }
    if has_word("web") {
        return Some("WEB-DL".to_string());
    }
    None
}

// Hyphen-delimited trailing token only (mirrors naming-engine.ts:parseReleaseGroup). No
// hyphen → no group: never grab the last dotted scene token like "BluRay" or "x264".
fn release_group_is_tech_token(token: &str) -> bool {
    Regex::new(
        r"(?i)^(x26[45]|h\.?26[45]|hevc|avc|av1|vp9|bluray|blu-ray|web|webdl|web-dl|webrip|hdrip|dvdrip|remux|uhd|4k|2160p|1080p|720p|480p|hdr|hdr10|dv|dovi|ddp?|dts|dts-hd|truehd|aac|flac|atmos|5|7|2|1|0)$",
    )
    .map(|re| re.is_match(token))
    .unwrap_or(false)
}

fn get_release_group(filename: &str) -> Option<String> {
    let base = filename.rsplit_once('.').map(|v| v.0).unwrap_or(filename);
    let (_, after_hyphen) = base.rsplit_once('-')?;
    let mut cand = after_hyphen
        .trim_end_matches("_sample")
        .trim_end_matches("-sample")
        .trim_end_matches(" sample")
        .trim_matches(|c: char| !c.is_alphanumeric())
        .to_string();
    // Two space-separated tags ("DarQ HONE") name the source group and the encoder; keep
    // only the last one (the actual encoder).
    let encoder = cand.split_whitespace().next_back().map(str::to_string);
    if let Some(encoder) = encoder {
        cand = encoder;
    }
    if cand.is_empty() || release_group_is_tech_token(&cand) {
        None
    } else {
        Some(cand)
    }
}

fn is_remux(filename: &str) -> bool {
    filename.to_lowercase().contains("remux")
}

/// REMUX vs Encode.
///
/// Only an explicit `remux` token in the filename proves a remux. A bitrate threshold does
/// NOT: a 35 Mbps 2160p x265 encode and a high-bitrate WEB-DL both clear any sane cutoff, and
/// mislabeling them flips the codec token too (a remux prints `HEVC`, an encode prints `x265`).
///
/// An `x264`/`x265` token is positive proof of an ENCODE — those are software encoders, so a
/// remux (which copies the original disc stream untouched) can never carry one.
fn get_release_type(_video_bitrate: Option<u64>, filename: &str) -> Option<String> {
    if is_remux(filename) {
        return Some("REMUX".to_string());
    }
    let lower = filename.to_lowercase();
    if Regex::new(r"(?i)\b(x26[45]|h\.?26[45])\b")
        .map(|re| re.is_match(&lower))
        .unwrap_or(false)
    {
        return Some("Encode".to_string());
    }
    // Unknown: don't guess. Emitting a wrong REMUX/Encode tag is worse than emitting none,
    // and the naming engine already treats an absent release type as "not a remux".
    None
}

#[tauri::command]
async fn list_media_streams(paths: Vec<String>) -> Result<Vec<MediaAnalysis>, String> {
    let mut results = Vec::with_capacity(paths.len());

    for path in paths {
        let output = command_no_window("ffprobe")
            .args([
                "-v",
                "error",
                "-print_format",
                "json",
                "-show_streams",
                "-show_format",
                &path,
            ])
            .output();

        let value: Value = match output {
            Ok(output) if output.status.success() => serde_json::from_slice(&output.stdout)
                .map_err(|e| format!("Failed to parse ffprobe output for {path}: {e}"))?,
            Ok(output) => {
                let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
                let detail = if stderr.is_empty() {
                    format!("ffprobe exited with status {:?}", output.status.code())
                } else {
                    stderr
                };
                return Err(format!("Failed to analyze {path}: {detail}"));
            }
            Err(err) => {
                let message = if err.kind() == std::io::ErrorKind::NotFound {
                    "ffprobe not found. Install ffmpeg to analyze media files.".to_string()
                } else {
                    format!("Failed to run ffprobe: {err}")
                };
                return Err(message);
            }
        };

        let format = value.get("format").and_then(|v| v.as_object());
        let container = GeneralContainer {
            format_name: format
                .and_then(|f| f.get("format_name"))
                .and_then(|v| v.as_str())
                .map(|v| v.to_string()),
            duration_seconds: format.and_then(|f| f.get("duration")).and_then(parse_f64),
            size_bytes: format.and_then(|f| f.get("size")).and_then(parse_u64),
            overall_bitrate: format.and_then(|f| f.get("bit_rate")).and_then(parse_u64),
        };

        let (path_value, filename, extension) = parse_filename_parts(&path);
        let file = GeneralFile {
            path: path_value,
            filename: filename.clone(),
            extension,
        };

        let filename_only = filename
            .as_deref()
            .map(|v| v.to_string())
            .unwrap_or_default();

        let streams = value
            .get("streams")
            .and_then(|v| v.as_array())
            .cloned()
            .unwrap_or_default();
        let filename_source = if !filename_only.is_empty() {
            get_source_from_filename(&filename_only)
        } else {
            None
        };
        let mut video_streams = Vec::new();
        let mut audio_streams = Vec::new();
        let mut subtitle_streams = Vec::new();

        let mut primary_video_height = None;
        let mut primary_video_width = None;
        let mut primary_video_codec = None;
        let mut primary_video_transfer = None;
        let mut primary_video_bitrate = None;
        let mut primary_video_bit_depth = None;
        let mut primary_video_dv = false;

        for stream in &streams {
            let codec_type = stream
                .get("codec_type")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            let index = stream.get("index").and_then(|v| v.as_i64()).unwrap_or(-1);
            let codec_name = stream
                .get("codec_name")
                .and_then(|v| v.as_str())
                .map(|v| v.to_string());
            let codec_long_name = stream
                .get("codec_long_name")
                .and_then(|v| v.as_str())
                .map(|v| v.to_string());
            let profile = stream
                .get("profile")
                .and_then(|v| v.as_str())
                .map(|v| v.to_string());
            let level = stream.get("level").and_then(|v| v.as_i64());
            let width = stream.get("width").and_then(|v| v.as_i64());
            let height = stream.get("height").and_then(|v| v.as_i64());
            // Video bitrate falls back to Matroska BPS tags (ffprobe omits bit_rate for MKV).
            let bitrate = get_video_bitrate(stream);
            let max_bitrate = stream.get("max_bit_rate").and_then(parse_u64);
            let avg_frame_rate = stream
                .get("avg_frame_rate")
                .and_then(|v| v.as_str())
                .map(|v| v.to_string());
            let real_frame_rate = stream
                .get("r_frame_rate")
                .and_then(|v| v.as_str())
                .and_then(parse_rational);
            let pix_fmt = stream
                .get("pix_fmt")
                .and_then(|v| v.as_str())
                .map(|v| v.to_string());
            let bit_depth = get_bit_depth(stream);
            let primaries = stream
                .get("color_primaries")
                .and_then(|v| v.as_str())
                .map(|v| v.to_string());
            let transfer = stream
                .get("color_transfer")
                .and_then(|v| v.as_str())
                .map(|v| v.to_string());
            let matrix = stream
                .get("color_space")
                .and_then(|v| v.as_str())
                .map(|v| v.to_string());

            if codec_type == "video" {
                // Skip embedded cover art / posters so they never become the primary video
                // (which would corrupt the resolution, codec, HDR and bit-depth tags).
                if is_cover_art_stream(stream, codec_name.as_deref()) {
                    continue;
                }
                if primary_video_height.is_none() {
                    primary_video_height = height;
                    primary_video_width = width;
                    primary_video_codec = codec_name.clone();
                    primary_video_transfer = transfer.clone();
                    primary_video_bitrate = bitrate;
                    primary_video_bit_depth = bit_depth;
                    primary_video_dv = has_dolby_vision(stream).0;
                }
                let resolution_tag = get_resolution_tag(width, height);
                let (has_dv, dv_profile, dv_level) = has_dolby_vision(stream);
                let (mastering_display, max_cll) = get_hdr10_meta(stream);
                let hdr_type = if has_dv {
                    Some("dolby_vision".to_string())
                } else if transfer.as_deref() == Some("smpte2084") {
                    Some("hdr10".to_string())
                } else if transfer.as_deref() == Some("arib-std-b67") {
                    Some("hlg".to_string())
                } else if transfer.is_some() {
                    Some("sdr".to_string())
                } else {
                    None
                };
                let is_hdr = matches!(
                    hdr_type.as_deref(),
                    Some("dolby_vision") | Some("hdr10") | Some("hlg")
                );
                let video = VideoStream {
                    stream_index: index,
                    codec: VideoCodec {
                        name: codec_name.clone(),
                        long_name: codec_long_name,
                        profile,
                        level,
                    },
                    dimensions: VideoDimensions {
                        width,
                        height,
                        resolution_tag: resolution_tag.clone(),
                    },
                    bitrate: VideoBitrate {
                        bitrate,
                        max_bitrate,
                    },
                    frame_rate: VideoFrameRate {
                        avg: avg_frame_rate,
                        real: real_frame_rate,
                    },
                    pixel: VideoPixel {
                        pixel_format: pix_fmt,
                        bit_depth,
                    },
                    color: VideoColor {
                        primaries,
                        transfer: transfer.clone(),
                        matrix,
                    },
                    hdr: VideoHdr {
                        hdr_type: hdr_type.clone(),
                        is_hdr,
                        is_dolby_vision: has_dv,
                        dolby_vision: DolbyVisionInfo {
                            profile: dv_profile,
                            level: dv_level,
                        },
                        hdr10: Hdr10Info {
                            mastering_display,
                            max_cll,
                        },
                    },
                    derived: VideoDerived {
                        // Source comes from the filename ONLY. Resolution is not evidence of a
                        // source: deriving "UHD BluRay" from 2160p alone mislabels every UHD
                        // WEB-DL as a disc rip. No token -> no claim.
                        source_type: filename_source.clone(),
                        encode_type: get_release_type(bitrate, &filename_only),
                    },
                };
                video_streams.push(video);
            } else if codec_type == "audio" {
                let channels = stream.get("channels").and_then(|v| v.as_i64());
                let channel_layout = stream
                    .get("channel_layout")
                    .and_then(|v| v.as_str())
                    .map(|v| v.to_string());
                let sample_rate = stream.get("sample_rate").and_then(parse_u64);
                let audio_bitrate = get_audio_bitrate(stream, sample_rate, channels);
                let tags = stream.get("tags").and_then(|v| v.as_object());
                let lang_code = tags
                    .and_then(|t| t.get("language"))
                    .and_then(|v| v.as_str())
                    .map(|v| v.to_string());
                let lang_name = lang_code.as_deref().and_then(get_language_name);
                // Keep the original casing for pass-through; match on a lowered copy.
                let raw_title = tags
                    .and_then(|t| t.get("title"))
                    .and_then(|v| v.as_str())
                    .map(|v| v.to_string());
                let title = raw_title.as_deref().map(|v| v.to_lowercase());
                let atmos = detect_atmos(
                    stream,
                    codec_name.as_deref(),
                    profile.as_deref(),
                    codec_long_name.as_deref(),
                    title.as_deref(),
                );
                let lossless = is_lossless_audio(codec_name.as_deref(), profile.as_deref());
                // Commentary / description tracks must not be treated as a main audio track
                // (they otherwise land in the filename's audio block).
                let disposition = stream.get("disposition").and_then(|v| v.as_object());
                let disposition_flag = |key: &str| {
                    disposition
                        .and_then(|d| d.get(key))
                        .and_then(|v| v.as_i64())
                        .map(|v| v == 1)
                        .unwrap_or(false)
                };
                let commentary = disposition_flag("comment")
                    || disposition_flag("visual_impaired")
                    || title
                        .as_deref()
                        .map(|t| {
                            t.contains("commentary")
                                || t.contains("description")
                                || t.contains("descriptive")
                        })
                        .unwrap_or(false);
                let channel_label = get_channel_layout(channels, &channel_layout);
                let codec_tag = get_audio_codec_tag(&codec_name, &profile);
                // Build display_name from whatever parts exist so a track is NEVER dropped
                // just because it lacks a language tag or uses an unmapped codec.
                let display_name = {
                    let parts: Vec<String> = [
                        lang_name.clone(),
                        codec_tag
                            .clone()
                            .or_else(|| codec_name.as_ref().map(|c| c.to_uppercase())),
                        channel_label.clone(),
                        if atmos {
                            Some("Atmos".to_string())
                        } else {
                            None
                        },
                    ]
                    .into_iter()
                    .flatten()
                    .collect();
                    if parts.is_empty() {
                        None
                    } else {
                        Some(parts.join(" "))
                    }
                };

                let audio = AudioStream {
                    stream_index: index,
                    title: raw_title.clone(),
                    codec: AudioCodec {
                        name: codec_name,
                        long_name: codec_long_name,
                        profile: profile.clone(),
                    },
                    channels: AudioChannels {
                        count: channels,
                        layout: channel_layout,
                    },
                    bitrate: audio_bitrate,
                    sample_rate,
                    // Only meaningful for lossless tracks; the renderer gates display.
                    bit_depth: get_bit_depth(stream),
                    language: LanguageInfo {
                        code: lang_code,
                        name: lang_name,
                    },
                    flags: AudioFlags {
                        atmos,
                        lossless,
                        commentary,
                    },
                    derived: AudioDerived { display_name },
                };
                audio_streams.push(audio);
            } else if codec_type == "subtitle" {
                let tags = stream.get("tags").and_then(|v| v.as_object());
                let lang_code = tags
                    .and_then(|t| t.get("language"))
                    .and_then(|v| v.as_str())
                    .map(|v| v.to_string());
                let lang_name = lang_code.as_deref().and_then(get_language_name);
                let sub_title = tags
                    .and_then(|t| t.get("title"))
                    .and_then(|v| v.as_str())
                    .map(|v| v.to_string());
                let disposition = stream.get("disposition").and_then(|v| v.as_object());
                let forced = disposition
                    .and_then(|d| d.get("forced"))
                    .and_then(|v| v.as_i64())
                    .map(|v| v == 1)
                    .unwrap_or(false);
                let default = disposition
                    .and_then(|d| d.get("default"))
                    .and_then(|v| v.as_i64())
                    .map(|v| v == 1)
                    .unwrap_or(false);
                let hearing_impaired = disposition
                    .and_then(|d| d.get("hearing_impaired"))
                    .and_then(|v| v.as_i64())
                    .map(|v| v == 1)
                    .unwrap_or(false);

                subtitle_streams.push(SubtitleStream {
                    stream_index: index,
                    codec: codec_name,
                    title: sub_title,
                    language: LanguageInfo {
                        code: lang_code,
                        name: lang_name,
                    },
                    flags: SubtitleFlags {
                        forced,
                        default,
                        hearing_impaired,
                    },
                });
            }
        }

        let resolution_tag = get_resolution_tag(primary_video_width, primary_video_height);
        let codec_tag = get_codec_tag(&primary_video_codec);
        let bit_depth_tag = primary_video_bit_depth
            .filter(|v| *v >= 10)
            .map(|_| "10bit".to_string());
        // SDR is the absence of an HDR tag; it must never appear in the generated name.
        // Only emit a tag for Dolby Vision / HDR transfers.
        let hdr_tag = if primary_video_dv {
            Some("DoVi HDR".to_string())
        } else if primary_video_transfer.as_deref() == Some("smpte2084")
            || primary_video_transfer.as_deref() == Some("arib-std-b67")
        {
            Some("HDR".to_string())
        } else {
            None
        };

        let (title, year) = if !filename_only.is_empty() {
            parse_title_year(&filename_only)
        } else {
            (None, None)
        };

        let derived = GeneralDerived {
            title,
            year,
            source: if !filename_only.is_empty() {
                get_source_from_filename(&filename_only)
            } else {
                None
            },
            release_type: if !filename_only.is_empty() {
                get_release_type(primary_video_bitrate, &filename_only)
            } else {
                None
            },
            resolution_tag,
            codec_tag,
            bit_depth_tag,
            hdr_tag,
            release_group: if !filename_only.is_empty() {
                get_release_group(&filename_only)
            } else {
                None
            },
        };

        results.push(MediaAnalysis {
            general: GeneralInfo {
                container,
                file,
                derived,
            },
            video: video_streams,
            audio: audio_streams,
            subtitles: subtitle_streams,
        });
    }

    Ok(results)
}

fn build_temp_output_path(path: &str) -> String {
    let file_path = Path::new(path);
    let parent = file_path.parent().unwrap_or_else(|| Path::new(""));
    let stem = file_path
        .file_stem()
        .and_then(|v| v.to_str())
        .unwrap_or("output");
    let ext = file_path.extension().and_then(|v| v.to_str()).unwrap_or("");
    let filename = if ext.is_empty() {
        format!("{stem}.rskv.tmp")
    } else {
        format!("{stem}.rskv.tmp.{ext}")
    };
    if parent.as_os_str().is_empty() {
        filename
    } else {
        parent.join(filename).to_string_lossy().to_string()
    }
}

fn build_backup_output_path(path: &str) -> String {
    let file_path = Path::new(path);
    let parent = file_path.parent().unwrap_or_else(|| Path::new(""));
    let stem = file_path
        .file_stem()
        .and_then(|v| v.to_str())
        .unwrap_or("output");
    let ext = file_path.extension().and_then(|v| v.to_str()).unwrap_or("");
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or_default();
    let filename = if ext.is_empty() {
        format!("{stem}.rskv.{stamp}.backup")
    } else {
        format!("{stem}.rskv.{stamp}.backup.{ext}")
    };
    if parent.as_os_str().is_empty() {
        filename
    } else {
        parent.join(filename).to_string_lossy().to_string()
    }
}

fn is_mkv_like(path: &str) -> bool {
    let lower = path.to_lowercase();
    lower.ends_with(".mkv") || lower.ends_with(".webm")
}

const WINDOWS_RESERVED: [&str; 22] = [
    "con", "prn", "aux", "nul", "com1", "com2", "com3", "com4", "com5", "com6", "com7", "com8",
    "com9", "lpt1", "lpt2", "lpt3", "lpt4", "lpt5", "lpt6", "lpt7", "lpt8", "lpt9",
];

/// Validate a rename destination at the OS boundary (defense-in-depth beyond the JS
/// sanitizer): byte-length limit, reserved device names, trailing dot/space.
fn validate_rename_target(path: &str) -> Result<(), String> {
    let file = Path::new(path);
    let name = file.file_name().and_then(|v| v.to_str()).unwrap_or("");
    if name.is_empty() {
        return Err("Target filename is empty".to_string());
    }
    if name.len() > 255 {
        return Err("Target filename is too long (over 255 bytes)".to_string());
    }
    if name.ends_with(' ') || name.ends_with('.') {
        return Err("Target filename ends with a space or dot".to_string());
    }
    let stem = file
        .file_stem()
        .and_then(|v| v.to_str())
        .unwrap_or("")
        .to_lowercase();
    if WINDOWS_RESERVED.contains(&stem.as_str()) {
        return Err(format!("Target uses a reserved device name: {name}"));
    }
    Ok(())
}

/// Rename a file without ever overwriting the destination (closes the TOCTOU window in
/// the frontend `exists()` + `rename()` sequence). Allows a same-file/case-only rename.
#[tauri::command]
async fn safe_rename(from: String, to: String) -> Result<(), String> {
    if from == to {
        return Ok(());
    }
    validate_rename_target(&to)?;

    let to_path = Path::new(&to);
    if to_path.exists() {
        // Permit a case-only rename of the same underlying file; reject real collisions.
        let from_canon = std::fs::canonicalize(&from).ok();
        let to_canon = std::fs::canonicalize(&to).ok();
        let same_file = from_canon.is_some() && from_canon == to_canon;
        if !same_file {
            return Err("Target file already exists".to_string());
        }
        return std::fs::rename(&from, &to).map_err(|e| format!("Failed to rename: {e}"));
    }

    // Atomic no-clobber: hard_link refuses if the target exists, then drop the original.
    match std::fs::hard_link(&from, &to) {
        Ok(_) => std::fs::remove_file(&from)
            .map_err(|e| format!("Renamed but failed to remove original: {e}")),
        Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {
            Err("Target file already exists".to_string())
        }
        Err(_) => {
            // Cross-device or filesystems without hard links: guarded plain rename.
            if to_path.exists() {
                return Err("Target file already exists".to_string());
            }
            std::fs::rename(&from, &to).map_err(|e| format!("Failed to rename: {e}"))
        }
    }
}

/// Build the `--edit <selector>` token for one track title.
///
/// Prefers mkvpropedit's `track:@<number>` selector, which addresses a track by its
/// Matroska track NUMBER. ffprobe's `stream_index` is 0-based over every stream in the
/// file and matches the MKV track number minus one, so `stream_index + 1` is the track
/// number. This is stable regardless of which streams the analyzer skipped.
///
/// Falls back to the positional `track:v1` form only when no stream index was supplied
/// (older cached payload), preserving the previous behavior for those.
fn track_selector(kind: char, position: usize, stream_index: Option<i64>) -> String {
    match stream_index {
        // Guard against a negative/absurd index rather than emitting a bad selector.
        Some(index) if index >= 0 => format!("track:@{}", index + 1),
        _ => format!("track:{}{}", kind, position + 1),
    }
}

fn push_track_titles(
    args: &mut Vec<String>,
    kind: char,
    titles: &[String],
    stream_indexes: &[i64],
) {
    for (position, title) in titles.iter().enumerate() {
        // Skip empty titles so a blank generated value never clobbers existing metadata.
        if title.trim().is_empty() {
            continue;
        }
        args.push("--edit".to_string());
        args.push(track_selector(
            kind,
            position,
            stream_indexes.get(position).copied(),
        ));
        args.push("--set".to_string());
        args.push(format!("name={}", title.trim()));
    }
}

fn build_mkvpropedit_args(item: &RetagRequest) -> Vec<String> {
    let mut args = Vec::new();
    // Skip empty titles so a blank generated value never clobbers existing metadata.
    if let Some(title) = item.container_title.as_deref() {
        if !title.trim().is_empty() {
            args.push("--edit".to_string());
            args.push("info".to_string());
            args.push("--set".to_string());
            args.push(format!("title={}", title.trim()));
        }
    }

    push_track_titles(
        &mut args,
        'v',
        &item.video_titles,
        &item.video_stream_indexes,
    );
    push_track_titles(
        &mut args,
        'a',
        &item.audio_titles,
        &item.audio_stream_indexes,
    );
    push_track_titles(
        &mut args,
        's',
        &item.subtitle_titles,
        &item.subtitle_stream_indexes,
    );

    args
}

#[tauri::command]
async fn retag_media_files(items: Vec<RetagRequest>) -> Vec<RetagResult> {
    let mut results = Vec::with_capacity(items.len());
    log::info!("Retag start: {} item(s)", items.len());
    // Reclaim any debris a prior crashed retag left next to these files before writing.
    cleanup_stale_artifacts_for_paths(items.iter().map(|item| item.path.as_str()));
    for item in items {
        log::info!("Retag request: path={}", item.path);
        let result = if is_mkv_like(&item.path) {
            let mut args = build_mkvpropedit_args(&item);
            args.insert(0, item.path.clone());
            log::info!("Running mkvpropedit with {} arg(s)", args.len());
            let output = command_no_window("mkvpropedit").args(&args).output();
            match output {
                Ok(out) if out.status.success() => {
                    log::info!("mkvpropedit succeeded");
                    RetagResult {
                        path: item.path,
                        success: true,
                        error: None,
                    }
                }
                Ok(out) => RetagResult {
                    path: item.path,
                    success: false,
                    error: {
                        let stderr = String::from_utf8_lossy(&out.stderr).to_string();
                        let stdout = String::from_utf8_lossy(&out.stdout).to_string();
                        log::warn!(
                            "mkvpropedit failed: status={:?} stderr_len={} stdout_len={}",
                            out.status.code(),
                            stderr.len(),
                            stdout.len()
                        );
                        if !stderr.is_empty() {
                            log::warn!("mkvpropedit stderr: {stderr}");
                        }
                        if !stdout.is_empty() {
                            log::warn!("mkvpropedit stdout: {stdout}");
                        }
                        Some(stderr)
                    },
                },
                Err(err) => {
                    let message = if err.kind() == std::io::ErrorKind::NotFound {
                        "mkvpropedit not found. Install MKVToolNix to edit MKV titles.".to_string()
                    } else {
                        format!("Failed to run mkvpropedit: {err}")
                    };
                    log::warn!("mkvpropedit error: {message}");
                    RetagResult {
                        path: item.path,
                        success: false,
                        error: Some(message),
                    }
                }
            }
        } else {
            let temp_output = build_temp_output_path(&item.path);
            let mut args = vec![
                "-y".to_string(),
                "-i".to_string(),
                item.path.clone(),
                "-map".to_string(),
                "0".to_string(),
                "-map_metadata".to_string(),
                "0".to_string(),
                "-c".to_string(),
                "copy".to_string(),
            ];

            if let Some(title) = item.container_title.as_deref() {
                args.push("-metadata".to_string());
                args.push(format!("title={}", title.trim()));
            }

            for (index, title) in item.video_titles.iter().enumerate() {
                args.push(format!("-metadata:s:v:{index}"));
                args.push(format!("title={}", title.trim()));
            }

            for (index, title) in item.audio_titles.iter().enumerate() {
                args.push(format!("-metadata:s:a:{index}"));
                args.push(format!("title={}", title.trim()));
            }

            for (index, title) in item.subtitle_titles.iter().enumerate() {
                args.push(format!("-metadata:s:s:{index}"));
                args.push(format!("title={}", title.trim()));
            }

            args.push(temp_output.clone());

            log::info!("Running ffmpeg with {} arg(s)", args.len());
            let output = command_no_window("ffmpeg").args(&args).output();
            match output {
                Ok(out) if out.status.success() => {
                    log::info!("ffmpeg succeeded");
                    let backup_output = build_backup_output_path(&item.path);
                    match std::fs::rename(&item.path, &backup_output) {
                        Ok(_) => match std::fs::rename(&temp_output, &item.path) {
                            Ok(_) => {
                                let _ = std::fs::remove_file(&backup_output);
                                RetagResult {
                                    path: item.path,
                                    success: true,
                                    error: None,
                                }
                            }
                            Err(err) => {
                                let restore_result = std::fs::rename(&backup_output, &item.path);
                                let _ = std::fs::remove_file(&temp_output);
                                let restore_message = restore_result
                                    .err()
                                    .map(|restore_err| format!(" Restore failed: {restore_err}"))
                                    .unwrap_or_default();
                                RetagResult {
                                    path: item.path,
                                    success: false,
                                    error: Some(format!(
                                        "Failed to replace file: {err}.{restore_message}"
                                    )),
                                }
                            }
                        },
                        Err(err) => {
                            let _ = std::fs::remove_file(&temp_output);
                            RetagResult {
                                path: item.path,
                                success: false,
                                error: Some(format!(
                                    "Failed to prepare original file backup: {err}"
                                )),
                            }
                        }
                    }
                }
                Ok(out) => {
                    let stderr = String::from_utf8_lossy(&out.stderr).to_string();
                    let _ = std::fs::remove_file(&temp_output);
                    log::warn!(
                        "ffmpeg failed: status={:?} stderr_len={}",
                        out.status.code(),
                        stderr.len()
                    );
                    RetagResult {
                        path: item.path,
                        success: false,
                        error: Some(stderr),
                    }
                }
                Err(err) => {
                    let _ = std::fs::remove_file(&temp_output);
                    log::warn!("ffmpeg error: {err}");
                    let message = if err.kind() == std::io::ErrorKind::NotFound {
                        "ffmpeg not found. Install ffmpeg to edit metadata for this file type."
                            .to_string()
                    } else {
                        format!("Failed to run ffmpeg: {err}")
                    };
                    RetagResult {
                        path: item.path,
                        success: false,
                        error: Some(message),
                    }
                }
            }
        };
        results.push(result);
    }
    results
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GeneralMetadataRequest {
    path: String,
    #[serde(default)]
    writing_application: String,
    #[serde(default)]
    muxing_application: String,
    #[serde(default)]
    website: String,
    #[serde(default)]
    encoded_by: String,
    #[serde(default)]
    telegram: String,
}

/// Escape the five XML predefined entities so user values can never break the tags document.
fn xml_escape(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;")
}

/// Build a Matroska global-tags XML document from (name, value) pairs. Applied with
/// `mkvpropedit --tags global:` it replaces only the segment-wide tags, leaving per-track
/// statistics tags (BPS, etc.) intact.
fn build_general_tags_xml(tags: &[(&str, &str)]) -> String {
    let mut xml = String::from(
        "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<!DOCTYPE Tags SYSTEM \"matroskatags.dtd\">\n<Tags>\n  <Tag>\n    <Targets></Targets>\n",
    );
    for (name, value) in tags {
        xml.push_str(&format!(
            "    <Simple>\n      <Name>{}</Name>\n      <String>{}</String>\n    </Simple>\n",
            xml_escape(name),
            xml_escape(value)
        ));
    }
    xml.push_str("  </Tag>\n</Tags>\n");
    xml
}

/// Permanently write general/segment-level metadata (writing application, muxing application,
/// and the WEBSITE / ENCODED_BY / TELEGRAM global tags) into each file. MKV/WebM are edited
/// in place with mkvpropedit; everything else is remuxed losslessly with ffmpeg. Empty fields
/// are skipped so a blank value never clobbers existing metadata.
#[tauri::command]
async fn write_general_metadata(items: Vec<GeneralMetadataRequest>) -> Vec<RetagResult> {
    let mut results = Vec::with_capacity(items.len());
    log::info!("Write general metadata: {} item(s)", items.len());
    // Reclaim any debris a prior crashed remux left next to these files before writing.
    cleanup_stale_artifacts_for_paths(items.iter().map(|item| item.path.as_str()));

    for item in items {
        let writing = item.writing_application.trim();
        let muxing = item.muxing_application.trim();
        let website = item.website.trim();
        let encoded_by = item.encoded_by.trim();
        let telegram = item.telegram.trim();

        let mut tags: Vec<(&str, &str)> = Vec::new();
        if !website.is_empty() {
            tags.push(("WEBSITE", website));
        }
        if !encoded_by.is_empty() {
            tags.push(("ENCODED_BY", encoded_by));
        }
        if !telegram.is_empty() {
            tags.push(("TELEGRAM", telegram));
        }

        if writing.is_empty() && muxing.is_empty() && tags.is_empty() {
            results.push(RetagResult {
                path: item.path,
                success: true,
                error: None,
            });
            continue;
        }

        let result = if is_mkv_like(&item.path) {
            // Stage the global-tags XML to a temp file when there are any tags to write.
            let tags_file = if tags.is_empty() {
                None
            } else {
                let xml = build_general_tags_xml(&tags);
                let path = std::env::temp_dir().join(format!(
                    "rskv-tags-{}-{}.xml",
                    std::process::id(),
                    results.len()
                ));
                match std::fs::write(&path, xml) {
                    Ok(_) => Some(path),
                    Err(err) => {
                        results.push(RetagResult {
                            path: item.path,
                            success: false,
                            error: Some(format!("Failed to stage tags file: {err}")),
                        });
                        continue;
                    }
                }
            };

            let mut args: Vec<String> = vec![item.path.clone()];
            if !writing.is_empty() || !muxing.is_empty() {
                args.push("--edit".to_string());
                args.push("info".to_string());
                if !writing.is_empty() {
                    args.push("--set".to_string());
                    args.push(format!("writing-application={writing}"));
                }
                if !muxing.is_empty() {
                    args.push("--set".to_string());
                    args.push(format!("muxing-application={muxing}"));
                }
            }
            if let Some(ref path) = tags_file {
                args.push("--tags".to_string());
                args.push(format!("global:{}", path.display()));
            }

            log::info!("Running mkvpropedit (general metadata) with {} arg(s)", args.len());
            let output = command_no_window("mkvpropedit").args(&args).output();
            if let Some(path) = tags_file {
                let _ = std::fs::remove_file(path);
            }
            match output {
                Ok(out) if out.status.success() => RetagResult {
                    path: item.path,
                    success: true,
                    error: None,
                },
                Ok(out) => {
                    let stderr = String::from_utf8_lossy(&out.stderr).to_string();
                    log::warn!("mkvpropedit (general) failed: {stderr}");
                    RetagResult {
                        path: item.path,
                        success: false,
                        error: Some(stderr),
                    }
                }
                Err(err) => {
                    let message = if err.kind() == std::io::ErrorKind::NotFound {
                        "mkvpropedit not found. Install MKVToolNix to write MKV metadata."
                            .to_string()
                    } else {
                        format!("Failed to run mkvpropedit: {err}")
                    };
                    log::warn!("mkvpropedit (general) error: {message}");
                    RetagResult {
                        path: item.path,
                        success: false,
                        error: Some(message),
                    }
                }
            }
        } else {
            // Non-MKV: lossless remux carrying the new container metadata.
            let temp_output = build_temp_output_path(&item.path);
            let mut args = vec![
                "-y".to_string(),
                "-i".to_string(),
                item.path.clone(),
                "-map".to_string(),
                "0".to_string(),
                "-map_metadata".to_string(),
                "0".to_string(),
                "-c".to_string(),
                "copy".to_string(),
            ];
            // Non-MKV containers (MP4/MOV/…) don't carry the MKV-only
            // writing_application/muxing_application keys. Fold the writing application into
            // the portable `encoder` metadata key (ffmpeg writes this into MP4/MOV/etc.) and
            // drop muxing_application — there is no portable equivalent.
            let metadata: [(&str, &str); 4] = [
                ("encoder", writing),
                ("WEBSITE", website),
                ("ENCODED_BY", encoded_by),
                ("TELEGRAM", telegram),
            ];
            for (key, value) in metadata {
                if value.is_empty() {
                    continue;
                }
                args.push("-metadata".to_string());
                args.push(format!("{key}={value}"));
            }
            args.push(temp_output.clone());

            log::info!("Running ffmpeg (general metadata) with {} arg(s)", args.len());
            match command_no_window("ffmpeg").args(&args).output() {
                Ok(out) if out.status.success() => {
                    let backup_output = build_backup_output_path(&item.path);
                    match std::fs::rename(&item.path, &backup_output) {
                        Ok(_) => match std::fs::rename(&temp_output, &item.path) {
                            Ok(_) => {
                                let _ = std::fs::remove_file(&backup_output);
                                RetagResult {
                                    path: item.path,
                                    success: true,
                                    error: None,
                                }
                            }
                            Err(err) => {
                                let restore_result = std::fs::rename(&backup_output, &item.path);
                                let _ = std::fs::remove_file(&temp_output);
                                let restore_message = restore_result
                                    .err()
                                    .map(|e| format!(" Restore failed: {e}"))
                                    .unwrap_or_default();
                                RetagResult {
                                    path: item.path,
                                    success: false,
                                    error: Some(format!(
                                        "Failed to replace file: {err}.{restore_message}"
                                    )),
                                }
                            }
                        },
                        Err(err) => {
                            let _ = std::fs::remove_file(&temp_output);
                            RetagResult {
                                path: item.path,
                                success: false,
                                error: Some(format!("Failed to prepare backup: {err}")),
                            }
                        }
                    }
                }
                Ok(out) => {
                    let stderr = String::from_utf8_lossy(&out.stderr).to_string();
                    let _ = std::fs::remove_file(&temp_output);
                    RetagResult {
                        path: item.path,
                        success: false,
                        error: Some(stderr),
                    }
                }
                Err(err) => {
                    let _ = std::fs::remove_file(&temp_output);
                    let message = if err.kind() == std::io::ErrorKind::NotFound {
                        "ffmpeg not found. Install ffmpeg to write metadata for this file type."
                            .to_string()
                    } else {
                        format!("Failed to run ffmpeg: {err}")
                    };
                    RetagResult {
                        path: item.path,
                        success: false,
                        error: Some(message),
                    }
                }
            }
        };
        results.push(result);
    }
    results
}

// Create the native menu system
fn create_app_menu(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    log::info!("Setting up native menu system");

    // Build the main application submenu
    let app_submenu = SubmenuBuilder::new(app, "RsKv")
        .item(&MenuItemBuilder::with_id("about", "About RsKv").build(app)?)
        .separator()
        .item(&MenuItemBuilder::with_id("check-updates", "Check for Updates...").build(app)?)
        .separator()
        .item(
            &MenuItemBuilder::with_id("preferences", "Preferences...")
                .accelerator("CmdOrCtrl+,")
                .build(app)?,
        )
        .separator()
        .item(&PredefinedMenuItem::hide(app, Some("Hide RsKv"))?)
        .item(&PredefinedMenuItem::hide_others(app, None)?)
        .item(&PredefinedMenuItem::show_all(app, None)?)
        .separator()
        .item(&PredefinedMenuItem::quit(app, Some("Quit RsKv"))?)
        .build()?;

    // Build the View submenu
    let view_submenu = SubmenuBuilder::new(app, "View")
        .item(
            &MenuItemBuilder::with_id("toggle-left-sidebar", "Toggle Left Sidebar")
                .accelerator("CmdOrCtrl+1")
                .build(app)?,
        )
        .build()?;

    #[cfg(target_os = "macos")]
    let mut menu_builder = MenuBuilder::new(app).item(&app_submenu);
    #[cfg(not(target_os = "macos"))]
    let menu_builder = MenuBuilder::new(app).item(&app_submenu);

    #[cfg(target_os = "macos")]
    {
        // Build the Edit submenu to enable standard shortcuts (copy/paste/select all)
        let edit_submenu = SubmenuBuilder::new(app, "Edit")
            .item(&PredefinedMenuItem::undo(app, None)?)
            .item(&PredefinedMenuItem::redo(app, None)?)
            .separator()
            .item(&PredefinedMenuItem::cut(app, None)?)
            .item(&PredefinedMenuItem::copy(app, None)?)
            .item(&PredefinedMenuItem::paste(app, None)?)
            .item(&PredefinedMenuItem::select_all(app, None)?)
            .build()?;
        menu_builder = menu_builder.item(&edit_submenu);
    }

    // Build the main menu with submenus
    let menu = menu_builder.item(&view_submenu).build()?;

    // Set the menu for the app
    app.set_menu(menu)?;

    log::info!("Native menu system initialized successfully");
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(
            tauri_plugin_log::Builder::new()
                // Use Debug level in development, Info in production
                .level(if cfg!(debug_assertions) {
                    log::LevelFilter::Debug
                } else {
                    log::LevelFilter::Info
                })
                .targets([
                    // Always log to stdout for development
                    tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::Stdout),
                    // Log to webview console for development
                    tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::Webview),
                    // Log to a file in the app log directory
                    tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::LogDir {
                        file_name: Some("rskv.log.txt".to_string()),
                    }),
                ])
                .build(),
        )
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_persisted_scope::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            log::info!("🚀 Application starting up");
            log::debug!(
                "App handle initialized for package: {}",
                app.package_info().name
            );

            // Set up native menu system
            if let Err(e) = create_app_menu(app) {
                log::error!("Failed to create app menu: {e}");
                return Err(e);
            }

            // Set up menu event handlers
            app.on_menu_event(move |app, event| {
                log::debug!("Menu event received: {:?}", event.id());

                match event.id().as_ref() {
                    "about" => {
                        log::info!("About menu item clicked");
                        // Emit event to React for handling
                        match app.emit("menu-about", ()) {
                            Ok(_) => log::debug!("Successfully emitted menu-about event"),
                            Err(e) => log::error!("Failed to emit menu-about event: {e}"),
                        }
                    }
                    "check-updates" => {
                        log::info!("Check for Updates menu item clicked");
                        // Emit event to React for handling
                        match app.emit("menu-check-updates", ()) {
                            Ok(_) => log::debug!("Successfully emitted menu-check-updates event"),
                            Err(e) => log::error!("Failed to emit menu-check-updates event: {e}"),
                        }
                    }
                    "preferences" => {
                        log::info!("Preferences menu item clicked");
                        // Emit event to React for handling
                        match app.emit("menu-preferences", ()) {
                            Ok(_) => log::debug!("Successfully emitted menu-preferences event"),
                            Err(e) => log::error!("Failed to emit menu-preferences event: {e}"),
                        }
                    }
                    "toggle-left-sidebar" => {
                        log::info!("Toggle Left Sidebar menu item clicked");
                        // Emit event to React for handling
                        match app.emit("menu-toggle-left-sidebar", ()) {
                            Ok(_) => {
                                log::debug!("Successfully emitted menu-toggle-left-sidebar event")
                            }
                            Err(e) => {
                                log::error!("Failed to emit menu-toggle-left-sidebar event: {e}")
                            }
                        }
                    }
                    _ => {
                        log::debug!("Unhandled menu event: {:?}", event.id());
                    }
                }
            });

            // Example of different log levels
            log::trace!("This is a trace message (most verbose)");
            log::debug!("This is a debug message (development only)");
            log::info!("This is an info message (production)");
            log::warn!("This is a warning message");
            // log::error!("This is an error message");

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            greet,
            load_preferences,
            save_preferences,
            send_native_notification,
            save_emergency_data,
            load_emergency_data,
            cleanup_old_recovery_files,
            classify_paths,
            list_media_streams,
            retag_media_files,
            write_general_metadata,
            safe_rename,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolution_tag_buckets() {
        assert_eq!(
            get_resolution_tag(Some(3840), Some(2160)),
            Some("2160p".to_string())
        );
        // Letterboxed UHD (2.40:1) keeps its 2160p tag via the width signal.
        assert_eq!(
            get_resolution_tag(Some(3840), Some(1608)),
            Some("2160p".to_string())
        );
        assert_eq!(
            get_resolution_tag(Some(1920), Some(1080)),
            Some("1080p".to_string())
        );
        // Letterboxed 1080p (1920x800) is still 1080p, not dropped.
        assert_eq!(
            get_resolution_tag(Some(1920), Some(800)),
            Some("1080p".to_string())
        );
        // 1440p is its own bucket; it used to be mislabeled 1080p.
        assert_eq!(
            get_resolution_tag(Some(2560), Some(1440)),
            Some("1440p".to_string())
        );
        // 720p / 480p used to return None, which dropped the resolution entirely whenever
        // the filename lacked the token.
        assert_eq!(
            get_resolution_tag(Some(1280), Some(720)),
            Some("720p".to_string())
        );
        assert_eq!(
            get_resolution_tag(Some(720), Some(480)),
            Some("480p".to_string())
        );
        assert_eq!(
            get_resolution_tag(Some(720), Some(576)),
            Some("480p".to_string())
        );
        assert_eq!(get_resolution_tag(None, None), None);
        assert_eq!(get_resolution_tag(Some(0), Some(0)), None);
    }

    #[test]
    fn release_type_never_guesses_remux_from_bitrate() {
        // An explicit token is the only proof of a remux.
        assert_eq!(
            get_release_type(Some(80_000_000), "Movie.2160p.BluRay.REMUX.HEVC-GRP.mkv"),
            Some("REMUX".to_string())
        );
        // A 35 Mbps x265 ENCODE used to be mislabeled REMUX by the bitrate threshold,
        // which also flipped the codec token from x265 to HEVC.
        assert_eq!(
            get_release_type(Some(35_000_000), "Movie.2160p.BluRay.x265-GRP.mkv"),
            Some("Encode".to_string())
        );
        // High-bitrate WEB-DL with no codec token: unknown, so claim nothing.
        assert_eq!(get_release_type(Some(45_000_000), "Movie.2160p.WEB-DL.mkv"), None);
        assert_eq!(get_release_type(None, "Movie.mkv"), None);
    }

    #[test]
    fn dts_profiles_match_whole_words() {
        let dts = Some("dts".to_string());
        // "Express" contains "es" and used to be mislabeled DTS-ES.
        assert_eq!(
            get_audio_codec_tag(&dts, &Some("DTS Express".into())),
            Some("DTS Express".to_string())
        );
        assert_eq!(
            get_audio_codec_tag(&dts, &Some("DTS-HD Master Audio".into())),
            Some("DTS-HD MA".to_string())
        );
        assert_eq!(
            get_audio_codec_tag(&dts, &Some("DTS-X".into())),
            Some("DTS:X".to_string())
        );
        assert_eq!(
            get_audio_codec_tag(&dts, &Some("DTS-ES".into())),
            Some("DTS-ES".to_string())
        );
    }

    #[test]
    fn atmos_survives_a_rewritten_track_title() {
        // Profile/codec signals must carry Atmos on their own: retagging overwrites the
        // track title, so a title-only detector loses Atmos on the second pass.
        let no_title = serde_json::json!({ "codec_name": "truehd" });
        assert!(detect_atmos(
            &no_title,
            Some("truehd"),
            Some("TrueHD + Dolby Atmos"),
            None,
            None
        ));
        // E-AC-3 JOC side data, with a title that no longer mentions Atmos.
        let joc = serde_json::json!({
            "codec_name": "eac3",
            "side_data_list": [{ "side_data_type": "JOC", "complexity_index": 16 }]
        });
        assert!(detect_atmos(&joc, Some("eac3"), None, None, Some("english 5.1")));
        // `mlp` is TrueHD's raw form and was previously excluded outright.
        let mlp = serde_json::json!({ "codec_name": "mlp" });
        assert!(detect_atmos(&mlp, Some("mlp"), None, None, Some("truehd atmos 7.1")));
        // A plain DTS track is never Atmos.
        let dts = serde_json::json!({ "codec_name": "dts" });
        assert!(!detect_atmos(&dts, Some("dts"), None, None, Some("atmos")));
    }

    #[test]
    fn lossless_covers_every_lossless_family() {
        assert!(is_lossless_audio(Some("truehd"), None));
        assert!(is_lossless_audio(Some("mlp"), None));
        assert!(is_lossless_audio(Some("flac"), None));
        assert!(is_lossless_audio(Some("alac"), None));
        assert!(is_lossless_audio(Some("pcm_s24le"), None));
        assert!(is_lossless_audio(Some("dts"), Some("DTS-HD Master Audio")));
        // Lossy families.
        assert!(!is_lossless_audio(Some("eac3"), None));
        assert!(!is_lossless_audio(Some("aac"), None));
        assert!(!is_lossless_audio(Some("dts"), Some("DTS-HD HRA")));
    }

    #[test]
    fn channel_layout_never_emits_a_bare_digit() {
        assert_eq!(get_channel_layout(Some(6), &None), Some("5.1".to_string()));
        assert_eq!(get_channel_layout(Some(5), &None), Some("5.0".to_string()));
        // An unmapped count with no layout renders "N.0", not a lone "9".
        assert_eq!(get_channel_layout(Some(9), &None), Some("9.0".to_string()));
        assert_eq!(
            get_channel_layout(Some(6), &Some("5.1(side)".into())),
            Some("5.1".to_string())
        );
        assert_eq!(get_channel_layout(None, &None), None);
    }

    #[test]
    fn track_selector_uses_the_real_stream_index() {
        // stream_index 3 -> MKV track number 4. Positional selectors would target the
        // wrong track whenever the analyzer skipped a cover-art stream.
        assert_eq!(track_selector('a', 0, Some(3)), "track:@4");
        assert_eq!(track_selector('v', 0, Some(0)), "track:@1");
        // No index supplied (older cached payload) -> positional fallback.
        assert_eq!(track_selector('a', 1, None), "track:a2");
        assert_eq!(track_selector('s', 0, Some(-1)), "track:s1");
    }

    #[test]
    fn cover_art_streams_are_detected() {
        // attached_pic disposition -> cover art regardless of codec.
        let attached = serde_json::json!({
            "codec_name": "hevc",
            "disposition": { "attached_pic": 1 }
        });
        assert!(is_cover_art_stream(&attached, Some("hevc")));

        // Still-image codec with no disposition flag -> cover art.
        let mjpeg = serde_json::json!({ "codec_name": "mjpeg" });
        assert!(is_cover_art_stream(&mjpeg, Some("mjpeg")));
        let png = serde_json::json!({ "codec_name": "png" });
        assert!(is_cover_art_stream(&png, Some("PNG")));

        // A real video track is never treated as cover art.
        let real = serde_json::json!({
            "codec_name": "hevc",
            "disposition": { "attached_pic": 0 }
        });
        assert!(!is_cover_art_stream(&real, Some("hevc")));
        let real_h264 = serde_json::json!({ "codec_name": "h264" });
        assert!(!is_cover_art_stream(&real_h264, Some("h264")));
    }

    #[test]
    fn codec_tag_maps_avc_and_hevc() {
        assert_eq!(
            get_codec_tag(&Some("h264".into())),
            Some("x264".to_string())
        );
        assert_eq!(
            get_codec_tag(&Some("hevc".into())),
            Some("x265".to_string())
        );
        assert_eq!(get_codec_tag(&Some("av1".into())), None);
        assert_eq!(get_codec_tag(&None), None);
    }

    #[test]
    fn audio_codec_tag_known_codecs() {
        let none: Option<String> = None;
        assert_eq!(
            get_audio_codec_tag(&Some("eac3".into()), &none),
            Some("DDP".to_string())
        );
        assert_eq!(
            get_audio_codec_tag(&Some("ac3".into()), &none),
            Some("DD".to_string())
        );
        assert_eq!(
            get_audio_codec_tag(&Some("dts".into()), &none),
            Some("DTS".to_string())
        );
        assert_eq!(
            get_audio_codec_tag(&Some("truehd".into()), &none),
            Some("TrueHD".to_string())
        );
        assert_eq!(
            get_audio_codec_tag(&Some("aac".into()), &none),
            Some("AAC".to_string())
        );
        assert_eq!(
            get_audio_codec_tag(&Some("flac".into()), &none),
            Some("FLAC".to_string())
        );
    }

    #[test]
    fn audio_codec_tag_pcm_opus_mp3_now_mapped() {
        let none: Option<String> = None;
        assert_eq!(
            get_audio_codec_tag(&Some("pcm_s24le".into()), &none),
            Some("PCM".to_string())
        );
        assert_eq!(
            get_audio_codec_tag(&Some("opus".into()), &none),
            Some("Opus".to_string())
        );
        assert_eq!(
            get_audio_codec_tag(&Some("mp3".into()), &none),
            Some("MP3".to_string())
        );
    }

    #[test]
    fn audio_codec_tag_dts_profile_disambiguation() {
        assert_eq!(
            get_audio_codec_tag(&Some("dts".into()), &Some("DTS-HD MA".into())),
            Some("DTS-HD MA".to_string())
        );
        assert_eq!(
            get_audio_codec_tag(&Some("dts".into()), &Some("DTS:X".into())),
            Some("DTS:X".to_string())
        );
    }

    #[test]
    fn stale_artifact_name_matching() {
        assert!(is_stale_artifact_name("Movie.rskv.tmp.mkv"));
        assert!(is_stale_artifact_name("Movie.rskv.tmp"));
        assert!(is_stale_artifact_name("Movie.rskv.1700000000000.backup.mkv"));
        assert!(is_stale_artifact_name("Movie.rskv.1700000000000.backup"));
        assert!(!is_stale_artifact_name("Movie.mkv"));
        assert!(!is_stale_artifact_name("Movie.backup.mkv"));
        assert!(!is_stale_artifact_name("Movie.tmp.mkv"));
    }

    #[test]
    fn cleanup_stale_artifacts_preserves_recent_and_unrelated() {
        let dir = std::env::temp_dir().join(format!(
            "rskv-cleanup-test-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map(|d| d.as_nanos())
                .unwrap_or_default()
        ));
        std::fs::create_dir_all(&dir).unwrap();

        let fresh_tmp = dir.join("Movie.rskv.tmp.mkv");
        let fresh_backup = dir.join("Movie.rskv.123.backup.mkv");
        let unrelated = dir.join("Movie.mkv");
        std::fs::write(&fresh_tmp, b"x").unwrap();
        std::fs::write(&fresh_backup, b"x").unwrap();
        std::fs::write(&unrelated, b"x").unwrap();

        // Just-created artifacts are under the 1h threshold, so nothing is removed —
        // this guards against clobbering an in-flight write from another process.
        cleanup_stale_artifacts(&dir);
        assert!(fresh_tmp.exists());
        assert!(fresh_backup.exists());
        assert!(unrelated.exists());

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn channel_layout_7_channels_is_6_1_and_strips_parens() {
        assert_eq!(get_channel_layout(Some(7), &None), Some("6.1".to_string()));
        assert_eq!(
            get_channel_layout(Some(0), &Some("6.1(back)".into())),
            Some("6.1".to_string())
        );
    }

    #[test]
    fn video_bitrate_falls_back_to_bps_tag() {
        let stream = serde_json::json!({ "tags": { "BPS": "35000000" } });
        assert_eq!(get_video_bitrate(&stream), Some(35_000_000));
    }

    #[test]
    fn rename_target_validation() {
        assert!(validate_rename_target("/m/Movie (2018) 1080p.mkv").is_ok());
        assert!(validate_rename_target("/m/CON.mkv").is_err());
        assert!(validate_rename_target("/m/trailing ").is_err());
        assert!(validate_rename_target("/m/trailing.").is_err());
        let long = format!("/m/{}.mkv", "a".repeat(260));
        assert!(validate_rename_target(&long).is_err());
    }

    #[test]
    fn channel_layout_by_count() {
        assert_eq!(get_channel_layout(Some(8), &None), Some("7.1".to_string()));
        assert_eq!(get_channel_layout(Some(6), &None), Some("5.1".to_string()));
        assert_eq!(get_channel_layout(Some(2), &None), Some("2.0".to_string()));
        assert_eq!(get_channel_layout(Some(1), &None), Some("1.0".to_string()));
    }

    #[test]
    fn source_handles_dotted_scene_separators() {
        // Scene names are dot-separated, so the old literal "uhd bluray" match never fired
        // and every UHD disc rip was labeled plain "BluRay" INSIDE the file while the
        // filename said "UHD BluRay".
        assert_eq!(
            get_source_from_filename(
                "Dune.part.two.2160p.UHD.Blu-Ray.TrueHD.7.1.Atmos.REMUX-Framestor.mkv"
            ),
            Some("UHD BluRay".to_string())
        );
        assert_eq!(
            get_source_from_filename("Movie.2020.2160p.UHD.BluRay.x265-G.mkv"),
            Some("UHD BluRay".to_string())
        );
        // 2160p alone upgrades a BluRay to the UHD variant, matching the naming engine.
        assert_eq!(
            get_source_from_filename("Movie.2020.2160p.BluRay.x265-G.mkv"),
            Some("UHD BluRay".to_string())
        );
        assert_eq!(
            get_source_from_filename("Movie.2020.1080p.Blu-Ray.x264-G.mkv"),
            Some("BluRay".to_string())
        );
        assert_eq!(
            get_source_from_filename("Show.2020.1080p.WEB-DL.x264-G.mkv"),
            Some("WEB-DL".to_string())
        );
    }

    #[test]
    fn source_from_filename() {
        assert_eq!(
            get_source_from_filename("Inception.2018.1080p.BluRay.x264-RaZoR.mkv"),
            Some("BluRay".to_string())
        );
        assert_eq!(
            get_source_from_filename("Show.2018.1080p.WEB-DL.x264-RaZoR.mkv"),
            Some("WEB-DL".to_string())
        );
        assert_eq!(get_source_from_filename("Random.File.mkv"), None);
    }

    #[test]
    fn parse_title_year_basic() {
        let (title, year) = parse_title_year("Inception.2018.1080p.BluRay.x264-RaZoR.mkv");
        assert_eq!(title, Some("Inception".to_string()));
        assert_eq!(year, Some(2018));
    }

    #[test]
    fn parse_title_year_last_match() {
        // Titled-year films keep the in-title number and use the LAST year as the release
        // year (mirrors naming-engine.ts:parseTitleYear).
        let (title, year) = parse_title_year("Blade.Runner.2049.2017.2160p.BluRay-Group.mkv");
        assert_eq!(title, Some("Blade Runner 2049".to_string()));
        assert_eq!(year, Some(2017));
    }

    #[test]
    fn release_group_with_hyphen() {
        assert_eq!(
            get_release_group("Inception.2018.1080p.BluRay.x264-RaZoR.mkv"),
            Some("RaZoR".to_string())
        );
    }

    #[test]
    fn release_group_without_hyphen_is_none() {
        // No hyphen-delimited group: never grab the last dotted scene token.
        assert_eq!(
            get_release_group("Inception.2018.1080p.BluRay.x264.mkv"),
            None
        );
    }

    #[test]
    fn release_group_rejects_tech_token_after_hyphen() {
        // A hyphen before a technical token is not a release group.
        assert_eq!(get_release_group("Movie.2020.1080p.x265-HEVC.mkv"), None);
    }

    #[test]
    fn release_group_two_space_tags_keeps_encoder() {
        assert_eq!(
            get_release_group("Movie.2020.1080p.BluRay.x264-DarQ HONE.mkv"),
            Some("HONE".to_string())
        );
    }
}

