use std::{env, fs, process};

use opencode_costs_viewer_lib::pricing::validate_catalog;

fn main() {
    let mut arguments = env::args().skip(1);
    let Some(path) = arguments.next() else {
        eprintln!("usage: validate_pricing <catalog-path>");
        process::exit(2);
    };
    if arguments.next().is_some() {
        eprintln!("usage: validate_pricing <catalog-path>");
        process::exit(2);
    }

    let contents = match fs::read_to_string(&path) {
        Ok(contents) => contents,
        Err(error) => {
            eprintln!("cannot read pricing catalog '{path}': {error}");
            process::exit(1);
        }
    };

    if let Err(error) = validate_catalog(&contents) {
        eprintln!("invalid pricing catalog '{path}': {error}");
        process::exit(1);
    }

    println!("pricing catalog is valid: {path}");
}
