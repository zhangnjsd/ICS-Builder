use chrono::{DateTime, NaiveDateTime, TimeZone, Utc};
use chrono_tz::Tz;
use ics::components::{Parameter, Property};
use ics::{
    Alarm, Event, ICalendar,
    properties::{
        Action, Class, Description, Location, RRule, Summary, Transp, Trigger,
    },
};
use tauri::Manager;
use tauri_plugin_opener::OpenerExt;
use uuid::Uuid;

#[derive(serde::Deserialize)]
pub struct EventInfo {
    pub title: String,
    pub description: String,
    pub start_time: String,
    pub end_time: String,
    pub timezone: Option<String>,
    pub location: Option<String>,
    pub rrule: Option<String>,
    pub reminder_minutes: Option<i32>,
    pub is_busy: Option<bool>,
    pub privacy: Option<String>,
}

#[tauri::command]
async fn generate_ics(
    app_handle: tauri::AppHandle,
    events: Vec<EventInfo>,
) -> Result<String, String> {
    let mut calendar = ICalendar::new("2.0", "ics-builder");

    let system_tz_name = iana_time_zone::get_timezone().unwrap_or_else(|_| "UTC".to_string());
    let system_tz = system_tz_name
        .parse::<Tz>()
        .unwrap_or(chrono_tz::UTC);

    // Keep event timestamps as local wall-clock values in the selected timezone.
    let parse_date = |ds: &str, tz: Tz| -> Result<String, String> {
        if let Ok(dt) = DateTime::parse_from_rfc3339(ds) {
            return Ok(dt.with_timezone(&tz).format("%Y%m%dT%H%M%S").to_string());
        }

        let naive = NaiveDateTime::parse_from_str(ds, "%Y-%m-%dT%H:%M:%S")
            .or_else(|_| NaiveDateTime::parse_from_str(ds, "%Y-%m-%dT%H:%M"))
            .map_err(|e| format!("Invalid date {}: {}", ds, e))?;

        let localized = tz
            .from_local_datetime(&naive)
            .single()
            .or_else(|| tz.from_local_datetime(&naive).earliest())
            .ok_or_else(|| format!("Invalid local time {} for timezone {}", ds, tz.name()))?;

        Ok(localized.format("%Y%m%dT%H%M%S").to_string())
    };

    for ev in events {
        let uid = Uuid::new_v4().to_string();
        let effective_tz = ev
            .timezone
            .as_deref()
            .map(str::trim)
            .filter(|tz| !tz.is_empty())
            .unwrap_or(system_tz.name());
        let tz = effective_tz
            .parse::<Tz>()
            .map_err(|e| format!("Invalid timezone {}: {}", effective_tz, e))?;

        let mut event = Event::new(uid, Utc::now().format("%Y%m%dT%H%M%SZ").to_string());

        event.push(Summary::new(ev.title));
        event.push(Description::new(ev.description));
        let mut dtstart = Property::new("DTSTART", parse_date(&ev.start_time, tz)?);
        dtstart.add(Parameter::new("TZID", tz.name().to_string()));
        event.push(dtstart);

        let mut dtend = Property::new("DTEND", parse_date(&ev.end_time, tz)?);
        dtend.add(Parameter::new("TZID", tz.name().to_string()));
        event.push(dtend);

        if let Some(loc) = ev.location {
            event.push(Location::new(loc));
        }
        if let Some(rrule) = ev.rrule {
            event.push(RRule::new(rrule));
        }

        let busy = ev.is_busy.unwrap_or(true);
        event.push(Transp::new(if busy { "OPAQUE" } else { "TRANSPARENT" }));

        match ev.privacy.as_deref() {
            Some("PUBLIC") | Some("public") => event.push(Class::new("PUBLIC")),
            Some("PRIVATE") | Some("private") => event.push(Class::new("PRIVATE")),
            Some("CONFIDENTIAL") | Some("confidential") => event.push(Class::new("CONFIDENTIAL")),
            _ => (), // omit if not specified
        }

        if let Some(mins) = ev.reminder_minutes {
            let mut alarm = Alarm::new(Action::display(), Trigger::new(format!("-PT{}M", mins)));
            alarm.push(Description::new("Reminder"));
            event.add_alarm(alarm);
        }

        calendar.add_event(event);
    }

    #[cfg(target_os = "android")]
    let target_dir = {
        let candidates = [
            std::path::PathBuf::from("/storage/emulated/0/Documents/ICSBuilder"),
            std::path::PathBuf::from("/sdcard/Documents/ICSBuilder"),
        ];

        let mut chosen: Option<std::path::PathBuf> = None;
        for dir in candidates {
            if std::fs::create_dir_all(&dir).is_ok() {
                chosen = Some(dir);
                break;
            }
        }

        chosen.ok_or_else(|| {
            "Failed to access Documents directory. "
                .to_string()
        })?
    };

    #[cfg(not(target_os = "android"))]
    let target_dir = app_handle
        .path()
        .document_dir()
        .or_else(|_| app_handle.path().download_dir())
        .map_err(|_| "Failed to get public dir".to_string())?
        .join("ICSBuilder");

    let _ = std::fs::create_dir_all(&target_dir);

    let file_path = target_dir.join(format!("event_{}.ics", Uuid::new_v4()));
    calendar
        .save_file(&file_path)
        .map_err(|e| format!("Failed to save ics: {}", e))?;

    #[cfg(target_os = "android")]
    let file_url = {
        let raw = file_path.to_string_lossy().replace('\\', "/");
        let rel = raw
            .strip_prefix("/storage/emulated/0/")
            .or_else(|| raw.strip_prefix("/sdcard/"))
            .unwrap_or(&raw);
        format!(
            "content://{}.fileprovider/my_images/{}",
            "top.shizukuaqua.ics", rel
        )
    };

    #[cfg(not(target_os = "android"))]
    let file_url = format!(
        "file://{}",
        file_path
            .to_string_lossy()
            .replace('\\', "/")
            .replace(" ", "%20")
    );

    app_handle
        .opener()
        .open_url(file_url, None::<&str>)
        .map_err(|e| format!("Saved but failed to open ICS: {}", e))?;

    Ok(file_path.to_string_lossy().into_owned())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![generate_ics])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
