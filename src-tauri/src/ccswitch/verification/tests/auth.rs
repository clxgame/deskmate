use std::fs;
use std::path::PathBuf;

use crate::ccswitch::recovery::{observe_files, OpenCodePaths};
use crate::ccswitch::verification::{
    verify_once, ExternalVerification, VerificationProblem, VerificationTarget,
};

struct TempHome {
    root: PathBuf,
    home: PathBuf,
}

impl TempHome {
    fn new() -> Self {
        let root = std::env::temp_dir().join(format!(
            "yume-ccswitch-verification-auth-test-{}",
            uuid::Uuid::new_v4()
        ));
        let home = root.join("home");
        fs::create_dir_all(home.join(".config/opencode")).expect("create config fixture");
        fs::create_dir_all(home.join(".local/share/opencode")).expect("create auth fixture");
        fs::write(
            home.join(".config/opencode/opencode.json"),
            br#"{"provider":{}}"#,
        )
        .expect("write initial config fixture");
        fs::write(home.join(".local/share/opencode/auth.json"), b"{}")
            .expect("write initial auth fixture");
        Self { root, home }
    }

    fn paths(&self) -> OpenCodePaths {
        OpenCodePaths::from_home(&self.home).expect("resolve temporary OpenCode paths")
    }

    fn config_path(&self) -> PathBuf {
        self.home.join(".config/opencode/opencode.json")
    }

    fn auth_path(&self) -> PathBuf {
        self.home.join(".local/share/opencode/auth.json")
    }
}

impl Drop for TempHome {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.root);
    }
}

#[test]
fn auth_change_blocks_matching_config_success_without_secret_echo() {
    // Given
    let tree = TempHome::new();
    let paths = tree.paths();
    let target = VerificationTarget {
        provider_name: "Test Provider".to_owned(),
        endpoint: "https://api.example.test/v1/".to_owned(),
        model_id: "model-a".to_owned(),
        initial: observe_files(&paths).expect("observe initial temporary files"),
    };
    fs::write(
        tree.config_path(),
        br#"{
  "provider": {
    "generated-provider-id": {
      "name": "Test Provider",
      "options": {"baseURL": "https://api.example.test/v1"},
      "models": {"model-a": {}}
    }
  }
}"#,
    )
    .expect("write matching imported config");
    let secret_canary = format!("yume-auth-change-canary-{}", uuid::Uuid::new_v4());
    fs::write(
        tree.auth_path(),
        format!(r#"{{"token":"{secret_canary}"}}"#),
    )
    .expect("write changed auth fixture");

    // When
    let status = verify_once(&paths, &target);

    // Then
    assert!(matches!(
        status,
        ExternalVerification::ChangedInvalid {
            reason: VerificationProblem::AuthChanged,
            current_hash: Some(_),
        }
    ));
    assert!(!format!("{status:?}").contains(&secret_canary));
}
