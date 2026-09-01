use super::{discard_request, read_request, stage_request, AttachmentStore, TempAttachmentRoot};

#[test]
fn manual_qa_prints_opaque_metadata_and_sanitized_temp_tree() {
    let root_path;
    {
        let root = TempAttachmentRoot::new("manual-qa");
        root_path = root.path().to_path_buf();
        let store = AttachmentStore::default();
        let staged = store
            .stage(
                root.path(),
                stage_request("session-a", "manual.txt", "text/plain", b"qa".to_vec()),
            )
            .expect("stage manual QA attachment");
        let read = store
            .read(read_request("session-a", &staged.id))
            .expect("read manual QA attachment");
        let mut tree = Vec::new();
        for entry in std::fs::read_dir(root.path()).expect("read QA tree") {
            let entry = entry.expect("tree entry");
            let directory_name = entry.file_name().to_string_lossy().into_owned();
            tree.push(directory_name.clone());
            for child in std::fs::read_dir(entry.path()).expect("read QA attachment directory") {
                tree.push(format!(
                    "{directory_name}/{}",
                    child
                        .expect("attachment tree entry")
                        .file_name()
                        .to_string_lossy()
                ));
            }
        }
        tree.sort();
        let serialized = serde_json::to_string(&read).expect("serialize QA read");

        println!(
            "manual_qa metadata={} tree={:?} contains_native_path={}",
            serialized,
            tree,
            serialized.contains(&root.path().to_string_lossy().to_string())
        );
        assert_eq!(
            tree,
            vec![staged.id.clone(), format!("{}/source", staged.id)]
        );
        assert!(!serialized.contains(&root.path().to_string_lossy().to_string()));

        store
            .discard(discard_request("session-a", &staged.id))
            .expect("discard manual QA attachment");
    }
    println!("manual_qa cleanup root_exists={}", root_path.exists());
    assert!(!root_path.exists());
}
