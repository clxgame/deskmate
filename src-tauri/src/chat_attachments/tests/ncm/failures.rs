use super::*;

struct BlockingRunner {
    started: std::sync::mpsc::SyncSender<()>,
    release: std::sync::mpsc::Receiver<()>,
}

impl NcmRunner for BlockingRunner {
    fn run(&self, _source: &Path, output_dir: &Path) -> Result<(), NcmRunError> {
        self.started.send(()).map_err(|_| NcmRunError::Failed)?;
        self.release.recv().map_err(|_| NcmRunError::Failed)?;
        write_output(output_dir, "first.mp3", MP3_BYTES)
    }
}

struct CountingRunner<'counter>(&'counter std::sync::atomic::AtomicUsize);

impl NcmRunner for CountingRunner<'_> {
    fn run(&self, _source: &Path, _output_dir: &Path) -> Result<(), NcmRunError> {
        self.0.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        Ok(())
    }
}

#[path = "failures/concurrency.rs"]
mod concurrency;
#[path = "failures/identity.rs"]
mod identity;
#[path = "failures/output.rs"]
mod output;
