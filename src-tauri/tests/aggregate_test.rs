use opencode_costs_viewer_lib::pricing::load_embedded_catalog;
use std::collections::HashMap;

#[test]
fn pipeline_on_fixture() {
    let db = concat!(env!("CARGO_MANIFEST_DIR"), "/fixtures/fixture.db");
    let rows = opencode_costs_viewer_lib::db::load_rows(db).expect("load_rows");
    let mut rates = HashMap::new();
    rates.insert(
        ("llmproxy".into(), "openai/gpt-4.1".into()),
        opencode_costs_viewer_lib::cost::Rate {
            input: 2.0,
            output: 8.0,
            cache_read: 0.0,
            cache_write: 0.0,
        },
    );
    let catalog = load_embedded_catalog().expect("embedded catalog");
    let sessions = opencode_costs_viewer_lib::aggregate::aggregate(&rows, &catalog, &rates);
    assert_eq!(sessions.len(), 2); // s1 and s2 (m4 ignored)
    let s1 = sessions.iter().find(|s| s.id == "s1").unwrap();
    // m1: (1e6*2 + 1e5*8)/1e6 = 2.8 ; m2: (5e5*2 + 5e4*8 + 1e4*8)/1e6 = 1.48 ; total 4.28
    assert!((s1.cost - 4.28).abs() < 1e-6);
    let s2 = sessions.iter().find(|s| s.id == "s2").unwrap();
    assert_eq!(s2.cost, 0.0);
    assert!(s2.is_subagent);
}
