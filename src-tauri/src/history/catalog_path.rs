use super::ExclusionReason;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn malformed_directory_cannot_enter_catalog() {
        for path in [
            "",
            "relative/project",
            "C:project",
            "/../outside",
            "C:/../outside",
            "C:/foo\nbar",
            "//server",
        ] {
            assert_eq!(
                canonical_directory(path),
                Err(ExclusionReason::MalformedIdentity)
            );
        }
    }

    #[test]
    fn unc_aliases_collapse_while_posix_case_stays_distinct() {
        assert_eq!(
            canonical_directory("\\\\?\\UNC\\HOST\\SHARE\\a\\..\\b\\"),
            canonical_directory("//host/share/b")
        );
        assert_ne!(
            canonical_directory("/Projects/alpha"),
            canonical_directory("/projects/alpha")
        );
        assert_eq!(canonical_directory("C:/"), Ok("c:/".to_owned()));
    }
}

pub(crate) fn canonical_directory(value: &str) -> Result<String, ExclusionReason> {
    let mut path = value.replace('\\', "/");
    if let Some(unc) = path.strip_prefix("//?/UNC/") {
        path = format!("//{unc}");
    } else if let Some(verbatim) = path.strip_prefix("//?/") {
        path = verbatim.to_owned();
    }
    let drive = path.as_bytes().get(1) == Some(&b':')
        && path.as_bytes().first().is_some_and(u8::is_ascii_alphabetic)
        && path.as_bytes().get(2) == Some(&b'/');
    let unc = path.starts_with("//");
    if path.chars().any(char::is_control) || !(drive || path.starts_with('/')) {
        return Err(ExclusionReason::MalformedIdentity);
    }
    if drive || unc {
        path = path.to_lowercase();
    }
    let protected = if drive {
        1
    } else if unc {
        2
    } else {
        0
    };
    let mut parts = Vec::new();
    for part in path
        .split('/')
        .filter(|part| !part.is_empty() && *part != ".")
    {
        if part == ".." {
            if parts.len() <= protected {
                return Err(ExclusionReason::MalformedIdentity);
            }
            parts.pop();
        } else {
            parts.push(part);
        }
    }
    if parts.len() < protected {
        return Err(ExclusionReason::MalformedIdentity);
    }
    let joined = parts.join("/");
    Ok(if drive && parts.len() == 1 {
        format!("{joined}/")
    } else if drive {
        joined
    } else if unc {
        format!("//{joined}")
    } else {
        format!("/{joined}")
    })
}
