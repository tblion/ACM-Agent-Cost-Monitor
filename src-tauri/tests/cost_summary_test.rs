mod common;

use common::TemporaryFile;
use rusqlite::Connection;

#[test]
fn cost_summary_marks_models_configured_from_resolved_config() {
    let db_path = TemporaryFile::new("opencode-cost-summary-command", ".db");
    let config_path = TemporaryFile::new("opencode-cost-summary-command", ".jsonc");
    let conn = Connection::open(&db_path).unwrap();
    conn.execute_batch(
        "CREATE TABLE message (data TEXT NOT NULL);
         INSERT INTO message (data) VALUES
           ('{\"role\":\"assistant\",\"providerID\":\"p1\",\"modelID\":\"m1\",\"cost\":2.5}'),
           ('{\"role\":\"assistant\",\"providerID\":\"p2\",\"modelID\":\"m2\",\"cost\":1.25}')",
    )
    .unwrap();
    drop(conn);
    std::fs::write(
        &config_path,
        r#"{ "provider": { "p1": { "models": { "m1": { "cost": { "input": 1 } } } } } }"#,
    )
    .unwrap();

    let summaries = opencode_costs_viewer_lib::application::data_service::compute_cost_summary(
        &db_path,
        &config_path,
    )
    .unwrap();

    assert!(
        summaries
            .iter()
            .find(|s| s.model == "m1")
            .unwrap()
            .configured
    );
    assert!(
        !summaries
            .iter()
            .find(|s| s.model == "m2")
            .unwrap()
            .configured
    );
}
