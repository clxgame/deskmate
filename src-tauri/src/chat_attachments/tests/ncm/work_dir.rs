use super::*;

#[test]
fn dropping_one_work_dir_preserves_a_live_sibling() {
    let root = TempAttachmentRoot::new("ncm-work-isolation");
    let first = WorkDir::new(root.path()).expect("create first work directory");
    let second = WorkDir::new(root.path()).expect("create second work directory");
    assert_ne!(first.path(), second.path());
    drop(first);
    assert!(
        second.path().exists(),
        "live sibling work directory removed"
    );
}
