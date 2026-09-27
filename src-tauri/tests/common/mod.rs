use std::fs::{self, OpenOptions};
use std::ops::Deref;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

static NEXT_TEMPORARY_FILE: AtomicU64 = AtomicU64::new(0);

pub struct TemporaryFile {
    path: PathBuf,
}

impl TemporaryFile {
    pub fn new(prefix: &str, extension: &str) -> Self {
        let directory = std::env::temp_dir();
        for attempt in 0..100 {
            let counter = NEXT_TEMPORARY_FILE.fetch_add(1, Ordering::Relaxed);
            let path = directory.join(format!(
                "{prefix}-{}-{counter}-{attempt}{extension}",
                std::process::id()
            ));
            match OpenOptions::new().write(true).create_new(true).open(&path) {
                Ok(file) => {
                    drop(file);
                    return Self { path };
                }
                Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
                Err(error) => panic!("create unique temporary file failed: {error}"),
            }
        }
        panic!("could not reserve a unique temporary file path");
    }
}

impl Deref for TemporaryFile {
    type Target = Path;

    fn deref(&self) -> &Self::Target {
        &self.path
    }
}

impl AsRef<Path> for TemporaryFile {
    fn as_ref(&self) -> &Path {
        &self.path
    }
}

impl Drop for TemporaryFile {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.path);
    }
}
