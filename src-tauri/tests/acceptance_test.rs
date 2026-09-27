use std::collections::{HashMap, HashSet};

fn insert_csv_cost(
    csv_costs: &mut HashMap<String, f64>,
    session_id: String,
    cost: f64,
) -> Result<(), String> {
    if csv_costs.contains_key(&session_id) {
        return Err(format!("duplicate SessionId in legacy CSV: {session_id}"));
    }
    csv_costs.insert(session_id, cost);
    Ok(())
}

#[test]
fn duplicate_csv_session_ids_are_rejected_before_comparison() {
    let mut csv_costs = HashMap::new();
    insert_csv_cost(&mut csv_costs, "same-session".into(), 1.0)
        .expect("first SessionId is accepted");

    let error = insert_csv_cost(&mut csv_costs, "same-session".into(), 2.0)
        .expect_err("duplicate SessionId must be rejected");

    assert!(error.contains("duplicate"));
    assert!(error.contains("same-session"));
}

/// Acceptance test: compare the app's per-session costs with the legacy CSV
/// for the same database, checking session coverage and numeric tolerance.
/// Requires the ACCEPTANCE_DB and ACCEPTANCE_CSV environment variables;
/// otherwise the test is skipped to avoid breaking the regular test suite.
#[test]
fn acceptance_costs_match_legacy() {
    let (db_path, csv_path) = match (
        std::env::var("ACCEPTANCE_DB"),
        std::env::var("ACCEPTANCE_CSV"),
    ) {
        (Ok(db_path), Ok(csv_path)) => (db_path, csv_path),
        _ => {
            eprintln!(
                "SKIP: validation legacy non exécutée; ACCEPTANCE_DB et ACCEPTANCE_CSV sont requis"
            );
            return;
        }
    };

    // 1. App pipeline (same logic as the app).
    let rows = opencode_costs_viewer_lib::db::load_rows(&db_path).expect("load_rows");
    // Resolve the explicit legacy path from USERPROFILE, falling back to HOME if unset.
    // The comparison reads <home>/.config/opencode/opencode.jsonc to match the legacy script.
    let home = std::env::var("USERPROFILE")
        .or_else(|_| std::env::var("HOME"))
        .expect("USERPROFILE ou HOME");
    let config_path = std::path::Path::new(&home)
        .join(".config")
        .join("opencode")
        .join("opencode.jsonc");
    let config_text = std::fs::read_to_string(&config_path).unwrap_or_else(|_| {
        // If reading that path fails for any reason, retry with default_config_path().
        std::fs::read_to_string(opencode_costs_viewer_lib::config::default_config_path())
            .expect("read config (ni ~/.config ni default_config_path)")
    });
    let rates =
        opencode_costs_viewer_lib::config::extract_rates(&config_text).expect("extract_rates");
    let catalog =
        opencode_costs_viewer_lib::pricing::load_embedded_catalog().expect("embedded catalog");
    let sessions = opencode_costs_viewer_lib::aggregate::aggregate(&rows, &catalog, &rates);

    let mut app_costs: HashMap<String, f64> = HashMap::new();
    for s in &sessions {
        app_costs.insert(s.id.clone(), s.cost);
    }

    // 2. Legacy CSV (French decimal comma -> dot).
    let mut csv = std::fs::read_to_string(&csv_path).expect("read csv");
    if csv.starts_with('\u{feff}') {
        csv.remove(0);
    } // Strip an optional BOM.
    let mut rdr = csv::ReaderBuilder::new()
        .has_headers(true)
        .from_reader(csv.as_bytes());
    // The legacy CSV contains no message ID, provider, or model.
    // Compare the fields available in this format: session identity and cost.
    assert_eq!(
        rdr.headers()
            .expect("csv headers")
            .iter()
            .collect::<Vec<_>>(),
        ["Project", "SessionId", "Title", "Cost", "TarifCustomUtil"]
    );
    let mut csv_costs: HashMap<String, f64> = HashMap::new();
    for res in rdr.records() {
        let rec = res.expect("csv record");
        let sid = rec.get(1).expect("col SessionId").to_string();
        let cost: f64 = rec
            .get(3)
            .expect("col Cost")
            .trim()
            .replace(',', ".")
            .parse()
            .expect("parse cost");
        insert_csv_cost(&mut csv_costs, sid, cost).expect("CSV SessionId must be unique");
    }

    // 3. Exact comparison of session IDs.
    let csv_session_ids: HashSet<String> = csv_costs.keys().cloned().collect();
    let app_session_ids: HashSet<String> = app_costs.keys().cloned().collect();
    let missing_session_ids: HashSet<String> = csv_session_ids
        .difference(&app_session_ids)
        .cloned()
        .collect();
    let extra_session_ids: HashSet<String> = app_session_ids
        .difference(&csv_session_ids)
        .cloned()
        .collect();

    let mut missing_ids: Vec<String> = missing_session_ids.iter().cloned().collect();
    let mut extra_ids: Vec<String> = extra_session_ids.iter().cloned().collect();
    missing_ids.sort();
    extra_ids.sort();

    println!("Sessions CSV : {}", csv_session_ids.len());
    println!("Sessions app : {}", app_session_ids.len());
    println!("Sessions manquantes dans l'app : {missing_ids:?}");
    println!("Sessions supplémentaires dans l'app : {extra_ids:?}");

    assert!(
        missing_session_ids.is_empty(),
        "sessions du CSV absentes de l'app: {missing_ids:?}"
    );
    assert!(
        extra_session_ids.is_empty(),
        "sessions supplémentaires dans l'app: {extra_ids:?}"
    );

    // 4. Per-session cost comparison.
    let mut matched = 0usize;
    let mut mismatches: Vec<(String, f64, f64)> = Vec::new();
    for (sid, csv_cost) in &csv_costs {
        match app_costs.get(sid) {
            Some(app_cost) => {
                if (app_cost - csv_cost).abs() <= 1e-9 * (1.0 + csv_cost.abs()) {
                    matched += 1;
                } else {
                    mismatches.push((sid.clone(), *app_cost, *csv_cost));
                }
            }
            None => unreachable!("les sets de sessions ont déjà été comparés"),
        }
    }

    println!("Coûts identiques : {}", matched);
    println!("Divergences de coût : {}", mismatches.len());
    for (sid, a, c) in mismatches.iter().take(10) {
        println!("  DIVERGENCE {sid}: app={a} csv={c}");
    }

    assert!(
        mismatches.is_empty(),
        "{} divergences de coût",
        mismatches.len()
    );
    assert_eq!(
        app_costs.len(),
        csv_costs.len(),
        "nombre de sessions différent"
    );
}
