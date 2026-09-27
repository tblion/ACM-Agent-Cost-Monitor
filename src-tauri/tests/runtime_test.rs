mod common;

use common::TemporaryFile;
use std::fs;

use opencode_costs_viewer_lib::runtime::collect;

#[test]
fn collects_file_size_without_opening_or_modifying_a_database() {
    let path = TemporaryFile::new("opencode-runtime-metrics", "");
    let contents = b"runtime metrics fixture";
    fs::write(path.as_ref(), contents).expect("create temporary file");

    let before = fs::metadata(path.as_ref()).expect("metadata before collection");
    let metrics = collect(Some(path.as_ref()));
    let after = fs::metadata(path.as_ref()).expect("metadata after collection");

    assert_eq!(metrics.database_size_bytes, Some(contents.len() as u64));
    assert_eq!(before.len(), after.len());
    assert_eq!(
        fs::read(path.as_ref()).expect("read temporary file"),
        contents
    );
}

#[test]
fn reports_missing_database_path_as_none() {
    let path = TemporaryFile::new("opencode-runtime-metrics", "");
    fs::remove_file(path.as_ref()).expect("remove reserved temporary file");

    let metrics = collect(Some(path.as_ref()));

    assert_eq!(metrics.database_size_bytes, None);
}

#[test]
fn reports_a_plausible_millisecond_timestamp() {
    let metrics = collect(None);

    assert!(metrics.measured_at > 1_000_000_000_000);
}

#[test]
fn serializes_runtime_metrics_with_camel_case_fields() {
    let metrics = collect(None);
    let value = serde_json::to_value(&metrics).expect("serialize runtime metrics");
    let object = value.as_object().expect("serialized object");

    assert!(object.contains_key("databaseSizeBytes"));
    assert!(object.contains_key("processMemoryBytes"));
    assert!(object.contains_key("measuredAt"));
    assert!(object["databaseSizeBytes"].is_null());
    assert!(object["processMemoryBytes"].is_null() || object["processMemoryBytes"].is_u64());
    assert_eq!(object["measuredAt"], metrics.measured_at);
}

#[test]
fn collects_process_memory_without_panicking() {
    let result = std::panic::catch_unwind(|| collect(None));

    assert!(result.is_ok());
    let _process_memory_bytes = result
        .expect("runtime collection should not panic")
        .process_memory_bytes;
}
