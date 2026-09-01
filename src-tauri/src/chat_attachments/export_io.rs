use std::fs::{File, OpenOptions};
use std::io::Write;
use std::path::Path;

pub(super) trait ExportFileSystem {
    type Writer: Write;

    fn create_new(&self, path: &Path) -> std::io::Result<Self::Writer>;
    fn remove_file(&self, path: &Path) -> std::io::Result<()>;
}

pub(super) struct StdExportFileSystem;

impl ExportFileSystem for StdExportFileSystem {
    type Writer = File;

    fn create_new(&self, path: &Path) -> std::io::Result<Self::Writer> {
        OpenOptions::new().write(true).create_new(true).open(path)
    }

    fn remove_file(&self, path: &Path) -> std::io::Result<()> {
        std::fs::remove_file(path)
    }
}
