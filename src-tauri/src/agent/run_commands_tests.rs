use super::{
    run_commands::StartSettings,
    test_support::{Checked, TestResult},
};
use std::sync::{Arc, Mutex};

#[test]
fn start_settings_snapshot_cannot_mix_identity_after_concurrent_mutation() -> TestResult<()> {
    let mut initial = crate::settings::Settings::default();
    initial.provider_id = "provider-before".into();
    initial.model_id = "model-before".into();
    initial.persona_id = "persona-before".into();
    initial.memory_ai_use = true;
    let shared = Arc::new(Mutex::new(initial));
    let captured = {
        let settings = shared.lock().checked("lock initial settings")?;
        StartSettings::from(&*settings)
    };
    let concurrent = Arc::clone(&shared);
    std::thread::spawn(move || -> TestResult<()> {
        let mut settings = concurrent.lock().checked("lock changed settings")?;
        settings.provider_id = "provider-after".into();
        settings.model_id = "model-after".into();
        settings.persona_id = "persona-after".into();
        settings.memory_ai_use = false;
        Ok(())
    })
    .join()
    .checked("join settings mutation")??;
    let changed = {
        let settings = shared.lock().checked("read changed settings")?;
        StartSettings::from(&*settings)
    };
    assert_ne!(captured, changed);
    assert_eq!(captured.provider_id, "provider-before");
    assert_eq!(captured.model_id, "model-before");
    assert_eq!(captured.persona_id, "persona-before");
    assert!(captured.memory_ai_use);
    Ok(())
}
