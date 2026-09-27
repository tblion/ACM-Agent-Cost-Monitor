use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

use sysinfo::{get_current_pid, ProcessesToUpdate, System};

use crate::model::RuntimeMetrics;

pub fn collect(database_path: Option<&Path>) -> RuntimeMetrics {
    let database_size_bytes = database_path
        .and_then(|path| std::fs::metadata(path).ok())
        .map(|metadata| metadata.len());

    let process_memory_bytes = current_process_memory();
    let measured_at = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as i64)
        .unwrap_or_default();

    RuntimeMetrics {
        database_size_bytes,
        process_memory_bytes,
        measured_at,
    }
}

fn current_process_memory() -> Option<u64> {
    let pid = get_current_pid().ok()?;
    let mut system = System::new();
    system.refresh_processes(ProcessesToUpdate::Some(&[pid]), true);
    system.process(pid).map(|process| process.memory())
}
