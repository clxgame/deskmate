use super::*;
use crate::tool_permissions::runtime::PermissionRequest;
use tauri::http::Request;

struct Fixture {
    root: PathBuf,
    store: ResourceStore,
}
impl Fixture {
    fn new() -> Self {
        let root =
            std::env::temp_dir().join(format!("yume-local-resources-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap();
        let store = ResourceStore::open(&root.join("registry.db")).unwrap();
        Self { root, store }
    }
    fn file(&self, name: &str) -> PathBuf {
        let path = self.root.join(name);
        std::fs::write(&path, b"0123456789").unwrap();
        path
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.root);
    }
}

fn permission(kind: &str, path: &Path) -> PermissionRequest {
    PermissionRequest {
        id: "per_read".into(),
        session_id: "ses_one".into(),
        permission: kind.into(),
        patterns: vec![path.to_string_lossy().into_owned()],
        always: Vec::new(),
        metadata: serde_json::json!({"path":path}),
        tool: None,
    }
}

#[test]
fn originals_and_message_references_survive_restart_without_path_metadata() {
    let f = Fixture::new();
    let path = f.file("sample.mp3");
    let meta = f
        .store
        .register_paths(vec![path.clone()])
        .unwrap()
        .remove(0);
    let wire = serde_json::to_string(&meta).unwrap();
    assert!(!wire.contains(&f.root.to_string_lossy().to_string()));
    assert_eq!(meta.kind, ResourceKind::Audio);
    assert!(meta.preview_url.as_deref().unwrap().ends_with(&meta.id));
    f.store
        .bind(
            "/workspace",
            "ses_one",
            std::slice::from_ref(&meta.id),
            Some("msg_one"),
        )
        .unwrap();
    f.store
        .bind(
            "/workspace",
            "ses_one",
            std::slice::from_ref(&meta.id),
            Some("msg_one"),
        )
        .unwrap();
    assert_eq!(
        f.store
            .bind(
                "/workspace",
                "ses_two",
                std::slice::from_ref(&meta.id),
                None
            )
            .unwrap_err(),
        "resource_wrong_session"
    );
    let reopened = ResourceStore::open(&f.root.join("registry.db")).unwrap();
    assert_eq!(
        reopened
            .message_resources("/workspace", "ses_one", "msg_one")
            .unwrap()
            .len(),
        1
    );
    assert!(reopened
        .message_resources("/other", "ses_one", "msg_one")
        .unwrap()
        .is_empty());
    assert_eq!(
        reopened.get(&meta.id).unwrap().checked_path().unwrap(),
        path.canonicalize().unwrap()
    );
    assert!(path.exists());
}

#[test]
fn selected_resource_paths_are_read_only_and_scope_is_session_bound() {
    let f = Fixture::new();
    let selected = f.file("selected.wav");
    let other = f.file("other.wav");
    let meta = f
        .store
        .register_paths(vec![selected.clone()])
        .unwrap()
        .remove(0);
    assert!(f.store.scopes("/workspace", "ses_one").unwrap().is_empty());
    f.store
        .bind("/workspace", "ses_one", &[meta.id], None)
        .unwrap();
    let scopes = f.store.scopes("/workspace", "ses_one").unwrap();
    assert!(allows_request(
        &scopes,
        &f.root,
        &permission("read", &selected)
    ));
    assert!(!allows_request(
        &scopes,
        &f.root,
        &permission("read", &other)
    ));
    let sibling = permission("read", &other);
    assert_eq!(
        crate::tool_permissions::runtime::resource_request_mode(
            &crate::tool_permissions::ToolPermissions::default(),
            &sibling,
            allows_request(&scopes, &f.root, &sibling)
        ),
        crate::tool_permissions::Mode::Deny
    );
    assert!(!allows_request(
        &scopes,
        &f.root,
        &permission("edit", &selected)
    ));
    assert!(!allows_request(
        &scopes,
        &f.root,
        &permission("glob", &f.root)
    ));
    assert!(f
        .store
        .scopes("/workspace", "ses_other")
        .unwrap()
        .is_empty());
    assert!(f
        .store
        .scopes("/other-workspace", "ses_one")
        .unwrap()
        .is_empty());
    let external = permission("external_directory", &selected.parent().unwrap().join("*"));
    assert!(allows_request(&scopes, &f.root, &external));
}

#[test]
fn deleting_a_conversation_revokes_only_its_references_and_preserves_originals() {
    let f = Fixture::new();
    let original = f.file("original.mp4");
    let selected = f
        .store
        .register_paths(vec![original.clone()])
        .unwrap()
        .remove(0);
    f.store
        .bind(
            "/workspace",
            "ses_one",
            &[selected.id.clone()],
            Some("msg_one"),
        )
        .unwrap();
    let copy_root = f
        .root
        .join("chat-resource-uploads")
        .join(uuid::Uuid::new_v4().to_string());
    std::fs::create_dir_all(&copy_root).unwrap();
    let copy = copy_root.join("upload.mp3");
    std::fs::write(&copy, b"copy").unwrap();
    let uploaded = f
        .store
        .register_paths(vec![copy.clone()])
        .unwrap()
        .remove(0);
    f.store.mark_owned(&uploaded.id).unwrap();
    f.store
        .bind("/workspace", "ses_one", &[uploaded.id], Some("msg_one"))
        .unwrap();
    f.store.revoke_session("/workspace", "ses_one").unwrap();
    assert!(original.exists());
    assert!(!copy.exists());
    assert!(f.store.get(&selected.id).is_err());
    assert!(f.store.scopes("/workspace", "ses_one").unwrap().is_empty());
}

#[test]
fn discard_draft_is_idempotent_and_cannot_delete_submitted_resources() {
    let f = Fixture::new();
    let original = f.file("original.wav");
    let selected = f
        .store
        .register_paths(vec![original.clone()])
        .unwrap()
        .remove(0);
    let submitted = f
        .store
        .register_paths(vec![original.clone()])
        .unwrap()
        .remove(0);
    f.store
        .bind(
            "/workspace",
            "ses_one",
            &[submitted.id.clone()],
            Some("msg_one"),
        )
        .unwrap();
    let ids = vec![selected.id.clone(), submitted.id.clone()];
    f.store.discard_unbound(&ids).unwrap();
    f.store.discard_unbound(&ids).unwrap();
    assert!(f.store.get(&selected.id).is_err());
    assert!(f.store.get(&submitted.id).is_ok());
    assert!(original.exists());
}

#[test]
fn duplicate_session_ids_in_different_directories_never_share_read_scopes() {
    let f = Fixture::new();
    let a = f.file("a.mp3");
    let b = f.file("b.mp3");
    let resources = f.store.register_paths(vec![a.clone(), b.clone()]).unwrap();
    f.store
        .bind("/first", "ses_same", &[resources[0].id.clone()], None)
        .unwrap();
    f.store
        .bind("/second", "ses_same", &[resources[1].id.clone()], None)
        .unwrap();
    assert_eq!(
        f.store.session_directory("ses_same").unwrap_err(),
        "resource_ambiguous_session"
    );
    let scopes = f.store.scopes("/first", "ses_same").unwrap();
    assert!(allows_request(&scopes, &f.root, &permission("read", &a)));
    assert!(!allows_request(&scopes, &f.root, &permission("read", &b)));
}

#[cfg(unix)]
#[test]
fn native_read_patterns_resolve_against_worktree_not_instance_directory() {
    let f = Fixture::new();
    let original = f.file("reference.txt");
    let resource = f
        .store
        .register_paths(vec![original.clone()])
        .unwrap()
        .remove(0);
    f.store
        .bind("/workspace/nested", "ses_one", &[resource.id], None)
        .unwrap();
    f.store
        .set_read_base("/workspace/nested", "ses_one", Path::new("/"))
        .unwrap();
    let scopes = f.store.scopes("/workspace/nested", "ses_one").unwrap();
    let absolute = original.canonicalize().unwrap();
    let request = permission("read", absolute.strip_prefix("/").unwrap());
    assert!(allows_request(
        &scopes,
        Path::new("/workspace/nested"),
        &request
    ));
    let nested = f.root.join("nested");
    std::fs::create_dir(&nested).unwrap();
    f.store
        .set_read_base(
            "/workspace/nested",
            "ses_one",
            &f.root.canonicalize().unwrap(),
        )
        .unwrap();
    let scopes = f.store.scopes("/workspace/nested", "ses_one").unwrap();
    assert!(allows_request(
        &scopes,
        &nested,
        &permission("read", Path::new("reference.txt"))
    ));
    assert!(!allows_request(
        &scopes,
        &nested,
        &permission("read", Path::new("../reference.txt"))
    ));
}

#[test]
fn preview_serves_seek_ranges_and_rejects_unknown_or_non_media_resources() {
    let f = Fixture::new();
    let audio = f
        .store
        .register_paths(vec![f.file("sample.wav")])
        .unwrap()
        .remove(0);
    let response = respond_preview(
        &f.store,
        Request::builder()
            .uri(format!("chat-resource://localhost/{}", audio.id))
            .header("Range", "bytes=2-5")
            .body(Vec::new())
            .unwrap(),
    );
    assert_eq!(response.status(), 206);
    assert_eq!(response.headers()["Content-Range"], "bytes 2-5/10");
    assert_eq!(response.headers()["Content-Type"], "audio/wav");
    assert_eq!(response.body(), b"2345");
    let response = respond_preview(
        &f.store,
        Request::builder()
            .uri(format!("chat-resource://localhost/{}", audio.id))
            .method("HEAD")
            .body(Vec::new())
            .unwrap(),
    );
    assert_eq!(response.headers()["Content-Length"], "10");
    assert!(response.body().is_empty());
    let response = respond_preview(
        &f.store,
        Request::builder()
            .uri(format!("chat-resource://localhost/{}", audio.id))
            .header("Range", "bytes=20-")
            .body(Vec::new())
            .unwrap(),
    );
    assert_eq!(response.status(), 416);
    let file = f
        .store
        .register_paths(vec![f.file("notes.txt")])
        .unwrap()
        .remove(0);
    let response = respond_preview(
        &f.store,
        Request::builder()
            .uri(format!("chat-resource://localhost/{}", file.id))
            .body(Vec::new())
            .unwrap(),
    );
    assert_eq!(response.status(), 403);
    let response = respond_preview(
        &f.store,
        Request::builder()
            .uri("chat-resource://localhost/../../etc/passwd")
            .body(Vec::new())
            .unwrap(),
    );
    assert_eq!(response.status(), 404);
}

#[test]
fn folder_preview_is_bounded_and_rejects_parent_traversal() {
    let f = Fixture::new();
    let folder = f.root.join("folder");
    std::fs::create_dir(&folder).unwrap();
    for index in 0..102 {
        std::fs::write(folder.join(format!("item-{index}.txt")), b"item").unwrap();
    }
    let resource = f.store.register_paths(vec![folder]).unwrap().remove(0);
    let listing = f.store.list_directory(&resource.id, "").unwrap();
    assert_eq!(listing.entries.len(), 100);
    assert!(listing.truncated);
    assert!(f.store.list_directory(&resource.id, "..").is_err());
}

#[cfg(unix)]
#[test]
fn folder_and_registered_file_reject_symlink_escapes() {
    use std::os::unix::fs::symlink;
    let f = Fixture::new();
    let folder = f.root.join("folder");
    std::fs::create_dir(&folder).unwrap();
    let outside = f.file("outside.txt");
    symlink(&outside, folder.join("escape.txt")).unwrap();
    let resource = f
        .store
        .register_paths(vec![folder.clone()])
        .unwrap()
        .remove(0);
    assert!(f
        .store
        .list_directory(&resource.id, "")
        .unwrap()
        .entries
        .is_empty());
    let scopes = vec![ReadScope {
        path: folder.canonicalize().unwrap(),
        directory: true,
        read_base: None,
    }];
    assert!(!allows_request(
        &scopes,
        &f.root,
        &permission("read", &folder.join("escape.txt"))
    ));
    assert!(!allows_request(
        &scopes,
        &f.root,
        &permission("glob", &folder)
    ));
    let selected = f.file("selected.mp3");
    let record = f
        .store
        .register_paths(vec![selected.clone()])
        .unwrap()
        .remove(0);
    std::fs::remove_file(&selected).unwrap();
    symlink(&outside, &selected).unwrap();
    assert!(f.store.get(&record.id).unwrap().checked_path().is_err());
}

#[test]
fn mainstream_media_and_ncm_are_classified_without_audio_video_confusion() {
    for ext in [
        "mp3", "wav", "m4a", "aac", "flac", "ogg", "opus", "aif", "aiff", "wma",
    ] {
        assert_eq!(
            classify(Path::new(&format!("sample.{ext}")), false).0,
            ResourceKind::Audio
        );
    }
    for ext in ["mp4", "mov", "m4v", "mkv", "avi", "webm"] {
        assert_eq!(
            classify(Path::new(&format!("sample.{ext}")), false).0,
            ResourceKind::Video
        );
    }
    assert_eq!(
        classify(Path::new("song.ncm"), false),
        (ResourceKind::File, "application/x-ncm")
    );
}
