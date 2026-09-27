use notify::{RecursiveMode, Watcher};
use std::path::{Path, PathBuf};
use std::sync::mpsc;
use tauri::{AppHandle, Emitter, Runtime};

pub struct WatcherService {
    active: Option<WatcherHandle>,
}

struct WatcherHandle {
    stop: mpsc::Sender<()>,
    thread: std::thread::JoinHandle<()>,
    path: PathBuf,
}

impl Default for WatcherService {
    fn default() -> Self {
        Self { active: None }
    }
}

impl WatcherService {
    pub fn start_or_restart<R: Runtime>(
        &mut self,
        app: AppHandle<R>,
        db_path: &Path,
    ) -> Result<(), String> {
        if !db_path.exists() {
            return Err(format!(
                "DB introuvable pour le watcher: {}",
                db_path.display()
            ));
        }
        self.stop();

        let (events_tx, events_rx) = mpsc::channel::<()>();
        let (stop_tx, stop_rx) = mpsc::channel::<()>();
        let path = db_path.to_path_buf();
        let mut watcher = notify::recommended_watcher(move |res: notify::Result<notify::Event>| {
            if res.is_ok() {
                let _ = events_tx.send(());
            }
        })
        .map_err(|e| e.to_string())?;
        watcher
            .watch(&path, RecursiveMode::NonRecursive)
            .map_err(|e| e.to_string())?;

        let thread = std::thread::spawn(move || {
            let _watcher = watcher;
            let poll = std::time::Duration::from_millis(50);
            let debounce = std::time::Duration::from_millis(1000);
            let mut last_event = None;
            loop {
                if stop_rx.try_recv().is_ok() {
                    break;
                }
                match events_rx.recv_timeout(poll) {
                    Ok(()) => last_event = Some(std::time::Instant::now()),
                    Err(mpsc::RecvTimeoutError::Timeout) => {
                        if last_event.is_some_and(|at| at.elapsed() >= debounce) {
                            last_event = None;
                            let _ = app.emit("db-changed", ());
                        }
                    }
                    Err(mpsc::RecvTimeoutError::Disconnected) => break,
                }
            }
        });

        self.active = Some(WatcherHandle {
            stop: stop_tx,
            thread,
            path,
        });
        Ok(())
    }

    pub fn stop(&mut self) {
        if let Some(handle) = self.active.take() {
            let _ = handle.stop.send(());
            let _ = handle.thread.join();
        }
    }

    pub fn active_path(&self) -> Option<&Path> {
        self.active.as_ref().map(|handle| handle.path.as_path())
    }
}

impl Drop for WatcherService {
    fn drop(&mut self) {
        self.stop();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tauri::{test::mock_app, Listener};

    #[test]
    fn missing_database_is_rejected_without_leaving_a_watcher() {
        let app = mock_app();
        let mut service = WatcherService::default();
        let path = std::env::temp_dir().join("ocv-watcher-missing.db");
        let _ = fs::remove_file(&path);

        assert!(service
            .start_or_restart(app.handle().clone(), &path)
            .is_err());
        assert!(service.active_path().is_none());
    }

    #[test]
    fn restarting_replaces_the_active_path_and_stop_joins_it() {
        let app = mock_app();
        let mut service = WatcherService::default();
        let first = std::env::temp_dir().join("ocv-watcher-first.db");
        let second = std::env::temp_dir().join("ocv-watcher-second.db");
        fs::write(&first, []).unwrap();
        fs::write(&second, []).unwrap();

        service
            .start_or_restart(app.handle().clone(), &first)
            .unwrap();
        assert_eq!(service.active_path(), Some(first.as_path()));
        service
            .start_or_restart(app.handle().clone(), &second)
            .unwrap();
        assert_eq!(service.active_path(), Some(second.as_path()));

        service.stop();
        assert!(service.active_path().is_none());
        let _ = fs::remove_file(first);
        let _ = fs::remove_file(second);
    }

    #[test]
    fn emits_one_debounced_event_after_database_changes() {
        let app = mock_app();
        let (events_tx, events_rx) = mpsc::channel();
        let _listener = app.listen("db-changed", move |_| {
            let _ = events_tx.send(());
        });
        let mut service = WatcherService::default();
        let path = std::env::temp_dir().join("ocv-watcher-debounce.db");
        fs::write(&path, []).unwrap();

        service
            .start_or_restart(app.handle().clone(), &path)
            .unwrap();
        fs::write(&path, b"first").unwrap();
        fs::write(&path, b"second").unwrap();

        assert!(events_rx
            .recv_timeout(std::time::Duration::from_secs(5))
            .is_ok());
        assert!(events_rx
            .recv_timeout(std::time::Duration::from_secs(2))
            .is_err());
        service.stop();
        let _ = fs::remove_file(path);
    }

    #[test]
    fn stop_prevents_events_after_the_watcher_is_stopped() {
        let app = mock_app();
        let (events_tx, events_rx) = mpsc::channel();
        let _listener = app.listen("db-changed", move |_| {
            let _ = events_tx.send(());
        });
        let mut service = WatcherService::default();
        let path = std::env::temp_dir().join("ocv-watcher-stop.db");
        fs::write(&path, []).unwrap();

        service
            .start_or_restart(app.handle().clone(), &path)
            .unwrap();
        service.stop();
        fs::write(&path, b"after-stop").unwrap();

        assert!(events_rx
            .recv_timeout(std::time::Duration::from_secs(2))
            .is_err());
        let _ = fs::remove_file(path);
    }
}
