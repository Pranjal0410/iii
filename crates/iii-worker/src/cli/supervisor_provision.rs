// Copyright Motia LLC and/or licensed to Motia LLC under one or more
// contributor license agreements. Licensed under the Elastic License 2.0;
// you may not use this file except in compliance with the Elastic License 2.0.
// This software is patent protected. We welcome discussions - reach out at support@motia.dev
// See LICENSE and PATENTS files for details.

//! Resolve and install the `iii-supervisor` binary into a worker's
//! rootfs.
//!
//! Mirrors the three-tier resolution pattern used by `ensure_init_binary`:
//!   1. `III_SUPERVISOR_PATH` env var (explicit override)
//!   2. `~/.iii/lib/iii-supervisor`
//!   3. Adjacent to the running `iii-worker` binary
//!
//! Embedded and GitHub-release download paths are TODO. When the binary
//! is missing, fast-restart is disabled but the VM still boots and the
//! full `iii-worker start` path still works.
//!
//! The supervisor must be a Linux musl-static build targeting the
//! guest architecture. Developers cross-compile with:
//!   cargo build -p iii-supervisor --target aarch64-unknown-linux-musl --release
//! and copy the binary to `~/.iii/lib/iii-supervisor`.

use std::path::{Path, PathBuf};

/// Resolution chain order for `iii-supervisor`. Returns the first
/// entry that exists on disk and is a regular file.
pub fn resolve_supervisor_binary() -> Option<PathBuf> {
    if let Ok(p) = std::env::var("III_SUPERVISOR_PATH") {
        let path = PathBuf::from(p);
        if path.is_file() {
            return Some(path);
        }
    }

    if let Some(home) = dirs::home_dir() {
        let candidate = home.join(".iii/lib/iii-supervisor");
        if candidate.is_file() {
            return Some(candidate);
        }
    }

    if let Ok(exe_path) = std::env::current_exe()
        && let Some(dir) = exe_path.parent()
    {
        let candidate = dir.join("iii-supervisor");
        if candidate.is_file() {
            return Some(candidate);
        }
    }

    None
}

/// Install the supervisor binary at `dest` (typically
/// `<rootfs>/opt/iii/supervisor`). Creates parent dirs, copies, sets
/// the executable bit. Returns `Ok(true)` if installed, `Ok(false)` if
/// the source binary wasn't resolvable (soft failure — fast-restart
/// disabled but VM still boots), `Err(_)` on copy/permission errors.
pub fn install_supervisor_into_rootfs(dest: &Path) -> std::io::Result<bool> {
    let Some(src) = resolve_supervisor_binary() else {
        return Ok(false);
    };

    if let Some(parent) = dest.parent() {
        std::fs::create_dir_all(parent)?;
    }
    std::fs::copy(&src, dest)?;

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(dest, std::fs::Permissions::from_mode(0o755))?;
    }

    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn resolve_respects_env_var() {
        let tmp = tempdir().unwrap();
        let bin = tmp.path().join("fake-supervisor");
        std::fs::write(&bin, b"#!/bin/sh\n").unwrap();

        unsafe {
            std::env::set_var("III_SUPERVISOR_PATH", &bin);
        }
        let resolved = resolve_supervisor_binary();
        unsafe {
            std::env::remove_var("III_SUPERVISOR_PATH");
        }

        assert_eq!(resolved.as_deref(), Some(bin.as_path()));
    }

    #[test]
    fn resolve_ignores_missing_env_path() {
        unsafe {
            std::env::set_var(
                "III_SUPERVISOR_PATH",
                "/definitely/not/a/real/path/iii-supervisor",
            );
        }
        let resolved = resolve_supervisor_binary();
        unsafe {
            std::env::remove_var("III_SUPERVISOR_PATH");
        }
        assert!(
            resolved.as_deref()
                != Some(std::path::Path::new(
                    "/definitely/not/a/real/path/iii-supervisor"
                ))
        );
    }

    #[test]
    fn install_copies_and_sets_mode() {
        let tmp = tempdir().unwrap();
        let src = tmp.path().join("src-supervisor");
        std::fs::write(&src, b"binary content").unwrap();
        unsafe {
            std::env::set_var("III_SUPERVISOR_PATH", &src);
        }

        let dest = tmp.path().join("rootfs/opt/iii/supervisor");
        let installed = install_supervisor_into_rootfs(&dest).expect("install ok");
        unsafe {
            std::env::remove_var("III_SUPERVISOR_PATH");
        }

        assert!(installed);
        assert!(dest.exists());
        assert_eq!(std::fs::read(&dest).unwrap(), b"binary content");

        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = std::fs::metadata(&dest).unwrap().permissions().mode();
            assert!(mode & 0o100 != 0, "owner exec bit must be set");
        }
    }
}
