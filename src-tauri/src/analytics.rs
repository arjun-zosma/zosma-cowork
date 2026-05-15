//! Minimal anonymous analytics module for Zosma Cowork.
//!
//! Replaces tauri-plugin-aptabase which has an async runtime conflict
//! in Tauri v2 (tokio::spawn panics during plugin setup).
//!
//! Sends events to Aptabase's ingest API directly via reqwest,
//! using tauri::async_runtime::spawn to stay on the correct runtime.

use std::{
    collections::VecDeque,
    sync::{Arc, RwLock},
    time::Duration,
};

use log::{debug, trace};
use reqwest::header::{HeaderMap, HeaderValue};
use serde_json::{json, Value};
use tauri::Manager;

static DEFAULT_FLUSH_INTERVAL: Duration = Duration::from_secs(60);
static HTTP_TIMEOUT: Duration = Duration::from_secs(10);
static INGEST_URL: &str = "https://in.aptabase.com/v1/event";

/// Thread-safe internal queue of pending events.
struct EventQueue {
    inner: RwLock<VecDeque<Value>>,
    http_client: reqwest::Client,
    ingest_url: String,
}

impl EventQueue {
    fn new(app_key: &str) -> Self {
        let mut headers = HeaderMap::new();
        headers.insert(
            "App-Key",
            HeaderValue::from_str(app_key).expect("invalid App-Key"),
        );
        headers.insert("Content-Type", HeaderValue::from_static("application/json"));

        let http_client = reqwest::Client::builder()
            .timeout(HTTP_TIMEOUT)
            .default_headers(headers)
            .build()
            .expect("failed to build reqwest client");

        Self {
            inner: RwLock::new(VecDeque::new()),
            http_client,
            ingest_url: INGEST_URL.to_string(),
        }
    }

    fn enqueue(&self, event: Value) {
        if let Ok(mut queue) = self.inner.write() {
            queue.push_back(event);
        }
    }

    /// Try to send all queued events. Errors are silently dropped (fire-and-forget).
    async fn flush(&self) {
        let batch: Vec<Value> = {
            let mut queue = self.inner.write().expect("lock queue");
            queue.drain(..).collect()
        };

        if batch.is_empty() {
            return;
        }

        trace!("flushing {} analytics events", batch.len());

        let body = json!(batch);
        match self
            .http_client
            .post(&self.ingest_url)
            .json(&body)
            .send()
            .await
        {
            Ok(resp) => {
                if resp.status().is_success() {
                    trace!("analytics flush OK");
                } else {
                    debug!("analytics flush returned {}", resp.status());
                }
            }
            Err(e) => debug!("analytics flush failed: {}", e),
        }
    }
}

/// Public handle stored in Tauri state for the JS frontend to call.
pub(crate) struct Analytics {
    queue: Arc<EventQueue>,
    enabled: std::sync::atomic::AtomicBool,
}

impl Analytics {
    fn new(app_key: &str) -> Self {
        let queue = Arc::new(EventQueue::new(app_key));
        Self {
            queue,
            enabled: std::sync::atomic::AtomicBool::new(true),
        }
    }

    /// Track an event if analytics is enabled.
    pub fn track_event(&self, name: &str, props: Option<Value>) {
        if !self.enabled.load(std::sync::atomic::Ordering::Relaxed) {
            return;
        }

        let event = json!({
            "eventName": name,
            "props": props.unwrap_or(json!({})),
        });
        self.queue.enqueue(event);
    }

    /// Enable or disable analytics.
    pub fn set_enabled(&self, enabled: bool) {
        self.enabled
            .store(enabled, std::sync::atomic::Ordering::Release);
    }

    /// Spawn the background flush loop on the Tauri async runtime.
    fn start_flush_loop(&self) {
        let queue = self.queue.clone();
        tauri::async_runtime::spawn(async move {
            loop {
                tokio::time::sleep(DEFAULT_FLUSH_INTERVAL).await;
                queue.flush().await;
            }
        });
    }
}

/// Tauri IPC command — track an anonymous event.
#[tauri::command]
pub(crate) fn track_analytics_event(
    app: tauri::AppHandle,
    name: String,
    props: Option<Value>,
) -> Result<(), String> {
    if let Some(analytics) = app.try_state::<Analytics>() {
        analytics.track_event(&name, props);
    }
    Ok(())
}

/// Tauri IPC command — enable or disable analytics.
#[tauri::command]
pub(crate) fn set_analytics_enabled(app: tauri::AppHandle, enabled: bool) -> Result<(), String> {
    if let Some(analytics) = app.try_state::<Analytics>() {
        analytics.set_enabled(enabled);
    }
    Ok(())
}

/// Set up the analytics system.
///
/// Call this from the app's `setup` closure (not from a plugin build),
/// so we are safely within Tauri's tokio runtime.
pub(crate) fn setup(app: &mut tauri::App, app_key: &str) -> Result<(), Box<dyn std::error::Error>> {
    let analytics = Analytics::new(app_key);
    analytics.start_flush_loop();
    app.manage(analytics);
    Ok(())
}
