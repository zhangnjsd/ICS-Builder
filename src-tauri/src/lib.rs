use serde::{Deserialize, Serialize};
use tauri_plugin_opener::OpenerExt;
use chrono::{DateTime, Utc};
use uuid::Uuid;
use tauri::Manager;
use ics::{ICalendar, Event, properties::{Summary, Description, DtEnd, DtStart}};

#[tauri::command]
async fn generate_ics(
    app_handle: tauri::AppHandle, 
    title: String, 
    description: String, 
    start_time: String, 
    end_time: String
) -> Result<String, String> {
    // Create ICS Event
    let uid = Uuid::new_v4().to_string();
    let mut event = Event::new(uid, Utc::now().format("%Y%m%dT%H%M%SZ").to_string());
    event.push(Summary::new(title));
    event.push(Description::new(description));

    // Parse and format dates correctly without hyphens and colons for standard ICS formats
    let parse_date = |ds: &str| -> Result<String, String> {
        let dt = DateTime::parse_from_rfc3339(ds).or_else(|_| DateTime::parse_from_rfc3339(&format!("{}Z", ds)))
            .map_err(|e| format!("Invalid date {}: {}", ds, e))?;
        Ok(dt.with_timezone(&Utc).format("%Y%m%dT%H%M%SZ").to_string())
    };

    event.push(DtStart::new(parse_date(&start_time)?));
    event.push(DtEnd::new(parse_date(&end_time)?));

    let mut calendar = ICalendar::new("2.0", "ics-builder");
    calendar.add_event(event);

    // Save ICS to a temporary or cache folder
    let cache_dir = app_handle
        .path()
        .cache_dir()
        .map_err(|_| "Failed to get cache dir".to_string())?;
    
    let path = cache_dir.join(format!("event_{}.ics", Uuid::new_v4()));
    calendar.save_file(&path).map_err(|e| format!("Failed to save ics: {}", e))?;

    // Open ICS
    app_handle.opener().open_path(path.to_str().unwrap(), None::<&str>)
        .map_err(|e| format!("Failed to open file: {}", e))?;

    Ok("ICS file generated and opened successfully!".into())
}

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![greet, generate_ics])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
