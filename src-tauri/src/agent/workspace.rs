use std::{
    fmt, fs,
    path::{Component, Path, PathBuf},
};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum PathIntent {
    Existing,
    NewFile,
}

#[derive(Clone, Debug)]
pub(super) struct WorkspaceRoot(pub(super) PathBuf);

#[derive(Debug, PartialEq, Eq)]
pub(super) enum WorkspaceError {
    Missing,
    NotDirectory,
    MissingParent,
    OutsideRoot,
    InvalidPath,
}

impl fmt::Display for WorkspaceError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        let code = match self {
            Self::Missing => "workspace_missing",
            Self::NotDirectory => "workspace_not_directory",
            Self::MissingParent => "workspace_parent_missing",
            Self::OutsideRoot => "workspace_outside_root",
            Self::InvalidPath => "workspace_invalid_path",
        };
        formatter.write_str(code)
    }
}

impl std::error::Error for WorkspaceError {}

pub(crate) fn opencode_wire_directory(path: &Path) -> String {
    let value = path.to_string_lossy();
    if let Some(rest) = value.strip_prefix(r"\\?\UNC\") {
        format!(r"\\{rest}")
    } else if let Some(rest) = value.strip_prefix(r"\\?\") {
        rest.to_owned()
    } else {
        value.into_owned()
    }
}

impl WorkspaceRoot {
    pub(super) fn open(path: impl AsRef<Path>) -> Result<Self, WorkspaceError> {
        let path = path.as_ref();
        if !path.exists() {
            return Err(WorkspaceError::Missing);
        }
        if !path.is_dir() {
            return Err(WorkspaceError::NotDirectory);
        }
        path.canonicalize()
            .map(Self)
            .map_err(|_| WorkspaceError::InvalidPath)
    }

    pub(super) fn resolve(
        &self,
        path: impl AsRef<Path>,
        intent: PathIntent,
    ) -> Result<PathBuf, WorkspaceError> {
        let input = path.as_ref();
        let candidate = if input.is_absolute() {
            input.to_path_buf()
        } else {
            self.0.join(input)
        };
        let resolved = match intent {
            PathIntent::Existing => candidate
                .canonicalize()
                .map_err(|_| WorkspaceError::InvalidPath)?,
            PathIntent::NewFile => self.resolve_file_target(input, &candidate)?,
        };
        if resolved.starts_with(&self.0) {
            Ok(resolved)
        } else {
            Err(WorkspaceError::OutsideRoot)
        }
    }

    pub(super) fn resolve_opencode(
        &self,
        path: impl AsRef<Path>,
        intent: PathIntent,
    ) -> Result<PathBuf, WorkspaceError> {
        let input = path.as_ref();
        if input.is_absolute() {
            return self.resolve(input, intent);
        }
        if input.components().any(|component| {
            matches!(
                component,
                Component::Prefix(_) | Component::RootDir | Component::ParentDir
            )
        }) {
            return Err(WorkspaceError::InvalidPath);
        }
        if let Some(root) = self.nearest_git_root()? {
            return self.resolve(root.join(input), intent);
        }
        #[cfg(windows)]
        {
            let candidate = self.windows_opencode_candidate(input)?;
            return self.resolve(candidate, intent);
        }
        #[cfg(not(windows))]
        self.resolve(input, intent)
    }

    pub(super) fn matches_opencode_path(
        &self,
        path: impl AsRef<Path>,
        intent: PathIntent,
        expected: &Path,
    ) -> bool {
        self.resolve_opencode(path, intent).as_deref() == Ok(expected)
    }

    pub(super) fn path(&self) -> &Path {
        &self.0
    }

    fn resolve_file_target(
        &self,
        input: &Path,
        candidate: &Path,
    ) -> Result<PathBuf, WorkspaceError> {
        if input
            .components()
            .any(|component| component == Component::ParentDir)
        {
            return Err(WorkspaceError::InvalidPath);
        }
        if candidate.exists() {
            if !candidate.is_file() {
                return Err(WorkspaceError::InvalidPath);
            }
            return candidate
                .canonicalize()
                .map_err(|_| WorkspaceError::InvalidPath);
        }
        candidate.file_name().ok_or(WorkspaceError::InvalidPath)?;
        let parent = candidate.parent().ok_or(WorkspaceError::MissingParent)?;
        if !parent.is_dir() {
            return Err(WorkspaceError::MissingParent);
        }
        let canonical_parent = parent
            .canonicalize()
            .map_err(|_| WorkspaceError::MissingParent)?;
        if !canonical_parent.starts_with(&self.0) {
            return Err(WorkspaceError::OutsideRoot);
        }
        Ok(canonical_parent.join(candidate.file_name().ok_or(WorkspaceError::InvalidPath)?))
    }

    fn nearest_git_root(&self) -> Result<Option<PathBuf>, WorkspaceError> {
        for ancestor in self.0.ancestors() {
            match fs::symlink_metadata(ancestor.join(".git")) {
                Ok(metadata) => {
                    if metadata.file_type().is_symlink() {
                        return Err(WorkspaceError::InvalidPath);
                    }
                    if metadata.is_dir() || metadata.is_file() {
                        return Ok(Some(ancestor.to_path_buf()));
                    }
                    return Err(WorkspaceError::InvalidPath);
                }
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
                Err(_) => return Err(WorkspaceError::InvalidPath),
            }
        }
        Ok(None)
    }

    #[cfg(windows)]
    pub(super) fn windows_opencode_candidate(
        &self,
        input: &Path,
    ) -> Result<PathBuf, WorkspaceError> {
        if input.is_absolute() {
            return Ok(input.to_path_buf());
        }
        let ordinary = PathBuf::from(opencode_wire_directory(&self.0));
        let root = ordinary
            .ancestors()
            .last()
            .ok_or(WorkspaceError::InvalidPath)?;
        if !root.has_root() {
            return Err(WorkspaceError::InvalidPath);
        }
        let workspace_components = ordinary
            .strip_prefix(root)
            .map_err(|_| WorkspaceError::InvalidPath)?;
        if workspace_components.as_os_str().is_empty() || !input.starts_with(workspace_components) {
            return Err(WorkspaceError::OutsideRoot);
        }
        Ok(root.join(input))
    }
}
