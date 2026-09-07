use std::fs;
use std::path::{Path, PathBuf};

use serde_json::{json, Value};

use super::{import_pack_into, installed_packs_in, uninstall_pack_in};

fn qa_root() -> Result<PathBuf, String> {
    let repo = Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .ok_or_else(|| "missing repository directory".to_string())?;
    let expected = repo.join(".omo/evidence/pack-display-metadata/qa-data");
    let requested =
        PathBuf::from(std::env::var("YUME_PACK_QA_ROOT").map_err(|error| error.to_string())?);
    if requested != expected {
        return Err(format!("QA root must be {}", expected.display()));
    }
    fs::create_dir_all(&expected).map_err(|error| error.to_string())?;
    Ok(expected)
}

fn run_qa_command() -> Result<Value, String> {
    let root = qa_root()?;
    let action = std::env::var("YUME_PACK_QA_ACTION").map_err(|error| error.to_string())?;
    match action.as_str() {
        "import" => {
            let archive =
                std::env::var("YUME_PACK_QA_ARCHIVE").map_err(|error| error.to_string())?;
            serde_json::to_value(import_pack_into(Path::new(&archive), &root)?)
                .map_err(|error| error.to_string())
        }
        "list" => {
            serde_json::to_value(installed_packs_in(&root)?).map_err(|error| error.to_string())
        }
        "uninstall" => {
            let pack_id =
                std::env::var("YUME_PACK_QA_PACK_ID").map_err(|error| error.to_string())?;
            uninstall_pack_in(&root, &pack_id)?;
            Ok(Value::Null)
        }
        _ => Err("YUME_PACK_QA_ACTION must be import, list, or uninstall".into()),
    }
}

#[test]
#[ignore = "manual native command bridge, restricted to repository QA data"]
fn qa_pack_command() {
    // Given: an explicit command targeting the repository's isolated QA directory.
    // When: the same file operation used by the app command is executed.
    let result = run_qa_command();
    // Then: the browser bridge receives the native result, including expected errors.
    let envelope = match result {
        Ok(value) => json!({"ok": true, "value": value}),
        Err(error) => json!({"ok": false, "error": error}),
    };
    println!("YUME_PACK_QA_JSON:{envelope}");
}
