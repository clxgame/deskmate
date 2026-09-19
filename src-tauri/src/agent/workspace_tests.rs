use super::test_support::{Checked, TestResult};
use super::workspace::{opencode_wire_directory, PathIntent, WorkspaceError, WorkspaceRoot};
use std::fs;

fn fixture() -> TestResult<std::path::PathBuf> {
    let root = std::env::temp_dir().join(format!("yume-agent-workspace-{}", uuid::Uuid::new_v4()));
    fs::create_dir_all(root.join("nested")).checked("create workspace fixture")?;
    fs::write(root.join("nested/existing.txt"), "inside").checked("write fixture file")?;
    Ok(root)
}

#[test]
fn rejects_missing_root_and_file_root() -> TestResult<()> {
    let root = fixture()?;
    let file = root.join("nested/existing.txt");
    assert!(WorkspaceRoot::open(root.join("missing")).is_err());
    assert!(WorkspaceRoot::open(file).is_err());
    fs::remove_dir_all(root).checked("remove fixture")?;
    Ok(())
}

#[test]
fn permits_existing_and_new_paths_only_under_canonical_root() -> TestResult<()> {
    let root = fixture()?;
    let workspace = WorkspaceRoot::open(&root).checked("open fixture root")?;
    assert!(workspace
        .resolve("nested/existing.txt", PathIntent::Existing)
        .is_ok());
    assert!(workspace
        .resolve("nested/new.txt", PathIntent::NewFile)
        .is_ok());
    assert!(workspace.resolve(&root, PathIntent::NewFile).is_err());
    assert!(workspace
        .resolve(root.join("nested"), PathIntent::NewFile)
        .is_err());
    assert!(workspace.resolve(".", PathIntent::NewFile).is_err());
    assert!(workspace
        .resolve("nested/../new.txt", PathIntent::NewFile)
        .is_err());
    assert!(workspace
        .resolve("future/nested/new.txt", PathIntent::NewFile)
        .is_err());
    assert!(workspace
        .resolve(root.join("../outside.txt"), PathIntent::NewFile)
        .is_err());
    fs::remove_dir_all(root).checked("remove fixture")?;
    Ok(())
}

#[test]
fn rejects_symlink_that_resolves_outside_root_when_supported() -> TestResult<()> {
    let root = fixture()?;
    let outside = std::env::temp_dir().join(format!("yume-agent-outside-{}", uuid::Uuid::new_v4()));
    fs::write(&outside, "outside").checked("write outside fixture")?;
    let link = root.join("nested/link.txt");
    #[cfg(windows)]
    let linked = std::os::windows::fs::symlink_file(&outside, &link);
    #[cfg(unix)]
    let linked = std::os::unix::fs::symlink(&outside, &link);
    if linked.is_ok() {
        let workspace = WorkspaceRoot::open(&root).checked("open fixture root")?;
        assert!(workspace.resolve(&link, PathIntent::Existing).is_err());
        assert!(workspace.resolve(&link, PathIntent::NewFile).is_err());
    }
    fs::remove_dir_all(root).checked("remove fixture")?;
    fs::remove_file(outside).checked("remove outside fixture")?;
    Ok(())
}

#[test]
fn opencode_wire_directory_removes_only_windows_verbatim_prefixes() {
    assert_eq!(
        opencode_wire_directory(std::path::Path::new(r"\\?\C:\中文 工作区\保留#?&%")),
        r"C:\中文 工作区\保留#?&%"
    );
    assert_eq!(
        opencode_wire_directory(std::path::Path::new(
            r"\\?\UNC\server\share\中文 工作区\保留#?&%"
        )),
        r"\\server\share\中文 工作区\保留#?&%"
    );
    assert_eq!(
        opencode_wire_directory(std::path::Path::new(r"C:\ordinary\中文 #?&%")),
        r"C:\ordinary\中文 #?&%"
    );
    assert_eq!(
        opencode_wire_directory(std::path::Path::new(r"relative\中文 #?&%")),
        r"relative\中文 #?&%"
    );
}

#[cfg(windows)]
#[test]
fn rejects_ambiguous_workspace_relative_pattern_named_like_drive_root_directory() -> TestResult<()>
{
    let root = fixture()?;
    fs::create_dir_all(root.join("Users")).checked("create relative Users directory")?;
    fs::write(root.join("Users/inside.txt"), "inside").checked("write relative Users file")?;
    let workspace = WorkspaceRoot::open(&root).checked("open fixture root")?;

    assert!(workspace
        .resolve_opencode("Users/inside.txt", PathIntent::Existing)
        .is_err());

    fs::remove_dir_all(root).checked("remove fixture")?;
    Ok(())
}

#[cfg(windows)]
#[test]
fn handles_drive_root_and_unc_patterns_without_guessing() -> TestResult<()> {
    let drive_root = WorkspaceRoot(std::path::PathBuf::from(r"\\?\C:\"));
    assert!(drive_root
        .windows_opencode_candidate(std::path::Path::new(r"Windows\file.txt"))
        .is_err());
    assert_eq!(
        drive_root
            .windows_opencode_candidate(std::path::Path::new(r"C:\Windows\file.txt"))
            .checked("keep absolute drive path")?,
        std::path::PathBuf::from(r"C:\Windows\file.txt")
    );

    let unc_workspace = WorkspaceRoot(std::path::PathBuf::from(r"\\?\UNC\server\share\workspace"));
    assert_eq!(
        unc_workspace
            .windows_opencode_candidate(std::path::Path::new(r"workspace\file.txt"))
            .checked("rebuild structured UNC path")?,
        std::path::PathBuf::from(r"\\server\share\workspace\file.txt")
    );
    let unc_root = WorkspaceRoot(std::path::PathBuf::from(r"\\?\UNC\server\share\"));
    assert!(unc_root
        .windows_opencode_candidate(std::path::Path::new("file.txt"))
        .is_err());
    Ok(())
}

#[cfg(windows)]
#[test]
fn resolves_exact_git_root_relative_permission_pattern_inside_workspace() -> TestResult<()> {
    let fixture_root =
        std::env::temp_dir().join(format!("yume-agent-git-relative-{}", uuid::Uuid::new_v4()));
    let repo = fixture_root.join("repo");
    let workspace_path = repo.join(".omo/evidence/run/中文 工作区");
    fs::create_dir_all(repo.join(".git")).checked("create git marker")?;
    fs::create_dir_all(&workspace_path).checked("create nested workspace fixture")?;
    fs::write(workspace_path.join("same.txt"), "ORIGINAL_A")
        .checked("write nested workspace file")?;
    fs::write(repo.join("outside.txt"), "outside").checked("write outside repo file")?;
    let workspace = WorkspaceRoot::open(&workspace_path).checked("open nested workspace")?;
    let raw_pattern = std::path::Path::new(r".omo\evidence\run\中文 工作区\same.txt");

    assert_eq!(
        workspace
            .resolve_opencode(raw_pattern, PathIntent::Existing)
            .checked("resolve exact raw permission pattern")?,
        workspace_path
            .join("same.txt")
            .canonicalize()
            .checked("canonical exact target")?
    );
    assert_eq!(
        workspace.resolve_opencode("outside.txt", PathIntent::Existing),
        Err(WorkspaceError::OutsideRoot)
    );

    fs::remove_dir_all(fixture_root).checked("remove nested workspace fixture")?;
    Ok(())
}

#[cfg(windows)]
#[test]
fn resolves_repo_root_relative_pattern_for_git_directory_and_worktree_file() -> TestResult<()> {
    for marker_is_file in [false, true] {
        let repo =
            std::env::temp_dir().join(format!("yume-agent-repo-root-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&repo).checked("create repo fixture")?;
        if marker_is_file {
            fs::write(repo.join(".git"), "gitdir: elsewhere").checked("create worktree marker")?;
        } else {
            fs::create_dir(repo.join(".git")).checked("create git directory marker")?;
        }
        fs::write(repo.join("same.txt"), "inside").checked("write repo file")?;
        let workspace = WorkspaceRoot::open(&repo).checked("open repo workspace")?;
        assert_eq!(
            workspace
                .resolve_opencode("same.txt", PathIntent::Existing)
                .checked("resolve repo-root-relative file")?,
            repo.join("same.txt")
                .canonicalize()
                .checked("canonical repo file")?
        );
        fs::remove_dir_all(repo).checked("remove repo fixture")?;
    }
    Ok(())
}

#[cfg(windows)]
#[test]
fn git_root_relative_pattern_still_rejects_outside_symlink_when_supported() -> TestResult<()> {
    let repo =
        std::env::temp_dir().join(format!("yume-agent-repo-symlink-{}", uuid::Uuid::new_v4()));
    let workspace_path = repo.join("workspace");
    let outside =
        std::env::temp_dir().join(format!("yume-agent-repo-outside-{}", uuid::Uuid::new_v4()));
    fs::create_dir_all(repo.join(".git")).checked("create git marker")?;
    fs::create_dir_all(&workspace_path).checked("create workspace fixture")?;
    fs::write(&outside, "outside").checked("write outside file")?;
    let link = workspace_path.join("link.txt");
    if std::os::windows::fs::symlink_file(&outside, &link).is_ok() {
        let workspace = WorkspaceRoot::open(&workspace_path).checked("open workspace")?;
        assert_eq!(
            workspace.resolve_opencode("workspace/link.txt", PathIntent::Existing),
            Err(WorkspaceError::OutsideRoot)
        );
        fs::remove_file(link).checked("remove symlink")?;
    }
    fs::remove_dir_all(repo).checked("remove repo fixture")?;
    fs::remove_file(outside).checked("remove outside file")?;
    Ok(())
}

#[cfg(windows)]
#[test]
fn rejects_symlink_git_marker_instead_of_widening_relative_base() -> TestResult<()> {
    let repo =
        std::env::temp_dir().join(format!("yume-agent-repo-marker-{}", uuid::Uuid::new_v4()));
    let marker_target =
        std::env::temp_dir().join(format!("yume-agent-marker-target-{}", uuid::Uuid::new_v4()));
    fs::create_dir_all(repo.join("workspace")).checked("create workspace fixture")?;
    fs::create_dir_all(&marker_target).checked("create marker target")?;
    fs::write(repo.join("workspace/same.txt"), "inside").checked("write workspace file")?;
    if std::os::windows::fs::symlink_dir(&marker_target, repo.join(".git")).is_ok() {
        let workspace = WorkspaceRoot::open(repo.join("workspace"))
            .checked("open workspace with symlink marker")?;
        assert_eq!(
            workspace.resolve_opencode("workspace/same.txt", PathIntent::Existing),
            Err(WorkspaceError::InvalidPath)
        );
        fs::remove_dir(repo.join(".git")).checked("remove marker symlink")?;
    }
    fs::remove_dir_all(repo).checked("remove repo fixture")?;
    fs::remove_dir_all(marker_target).checked("remove marker target")?;
    Ok(())
}
