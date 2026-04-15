// Copyright Motia LLC and/or licensed to Motia LLC under one or more
// contributor license agreements. Licensed under the Elastic License 2.0;
// you may not use this file except in compliance with the Elastic License 2.0.
// This software is patent protected. We welcome discussions - reach out at support@motia.dev
// See LICENSE and PATENTS files for details.

//! Child-process lifecycle for the in-VM supervisor.
//!
//! Holds a shared handle to the currently-running worker subprocess.
//! Spawns it, kills it, respawns it. Nothing else. Signal handling and
//! control-channel decoding live in sibling modules.

use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};

/// Configuration captured once at supervisor startup. Immutable after.
#[derive(Debug, Clone)]
pub struct Config {
    /// Shell command line to run as the user's worker. Executed via
    /// `/bin/sh -c` so the user's existing `iii.worker.yaml` run_cmd
    /// (e.g. `npm run dev`, `uvicorn app:main`) works verbatim.
    pub run_cmd: String,
    /// Working directory for the child. `/workspace` for local-path
    /// workers.
    pub workdir: String,
}

/// Mutable supervisor state protected by a single mutex.
#[derive(Debug)]
struct Inner {
    child: Option<Child>,
    restarts: u32,
}

/// Shareable handle to the supervisor's process state. Cheap to clone.
#[derive(Clone, Debug)]
pub struct State {
    config: Config,
    inner: Arc<Mutex<Inner>>,
}

impl State {
    pub fn new(config: Config) -> Self {
        Self {
            config,
            inner: Arc::new(Mutex::new(Inner {
                child: None,
                restarts: 0,
            })),
        }
    }

    /// Spawn the worker subprocess for the first time. Call once during
    /// supervisor boot, before entering the control loop. Returns an
    /// error if spawn fails; supervisor should exit in that case so the
    /// host can observe the VM going down and fall back.
    pub fn spawn_initial(&self) -> anyhow::Result<u32> {
        let mut guard = self.inner.lock().expect("inner mutex poisoned");
        let child = Self::spawn_child(&self.config)?;
        let pid = child.id();
        guard.child = Some(child);
        Ok(pid)
    }

    /// Kill the current child (if any) and spawn a fresh one with the
    /// same config. Increments the restart counter. Returns the new
    /// pid on success.
    ///
    /// Used from the control-channel handler when the host sends
    /// `Restart`. Idempotent on a dead child — if the child already
    /// exited, we still respawn cleanly.
    pub fn kill_and_respawn(&self) -> anyhow::Result<u32> {
        let mut guard = self.inner.lock().expect("inner mutex poisoned");
        if let Some(mut old) = guard.child.take() {
            let _ = old.kill();
            // Reap immediately so we don't leave a zombie. `wait` is
            // blocking but fine here — the child's death is imminent
            // after SIGKILL and the supervisor is single-threaded
            // around this call.
            let _ = old.wait();
        }
        let child = Self::spawn_child(&self.config)?;
        let pid = child.id();
        guard.child = Some(child);
        guard.restarts = guard.restarts.saturating_add(1);
        Ok(pid)
    }

    /// Kill the current child, do NOT respawn, mark supervisor as
    /// shutting down. Caller should then return from the control loop
    /// so `main` exits 0, which triggers the VM's poweroff path.
    pub fn kill_for_shutdown(&self) -> anyhow::Result<()> {
        let mut guard = self.inner.lock().expect("inner mutex poisoned");
        if let Some(mut old) = guard.child.take() {
            let _ = old.kill();
            let _ = old.wait();
        }
        Ok(())
    }

    /// Current child pid, if alive. `None` during the restart window or
    /// after an unexpected child exit that `kill_and_respawn` hasn't yet
    /// been called to recover from.
    pub fn pid(&self) -> Option<u32> {
        let mut guard = self.inner.lock().expect("inner mutex poisoned");
        // Check if the stored child has died on its own. `try_wait`
        // non-destructively reaps dead children so we don't report a
        // stale pid.
        if let Some(child) = guard.child.as_mut() {
            match child.try_wait() {
                Ok(Some(_)) => {
                    guard.child = None;
                    return None;
                }
                Ok(None) => return Some(child.id()),
                Err(_) => return Some(child.id()),
            }
        }
        None
    }

    /// Total restart count since supervisor boot.
    pub fn restarts(&self) -> u32 {
        self.inner.lock().expect("inner mutex poisoned").restarts
    }

    fn spawn_child(config: &Config) -> anyhow::Result<Child> {
        let child = Command::new("/bin/sh")
            .arg("-c")
            .arg(&config.run_cmd)
            .current_dir(&config.workdir)
            // Inherit stdio directly — the supervisor's stdout/stderr
            // are piped to the VM's console, which goes to the host's
            // ~/.iii/logs/<name>/stdout.log. Passing through preserves
            // log ordering without userspace copying.
            .stdin(Stdio::null())
            .stdout(Stdio::inherit())
            .stderr(Stdio::inherit())
            .spawn()?;
        Ok(child)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::thread;
    use std::time::Duration;

    fn sleep_config() -> Config {
        Config {
            run_cmd: "sleep 5".to_string(),
            workdir: "/tmp".to_string(),
        }
    }

    #[test]
    fn spawn_initial_reports_live_pid() {
        let state = State::new(sleep_config());
        let pid = state.spawn_initial().expect("spawn");
        assert!(pid > 0);
        assert_eq!(state.pid(), Some(pid));
        assert_eq!(state.restarts(), 0);
        state.kill_for_shutdown().unwrap();
    }

    #[test]
    fn kill_and_respawn_changes_pid_and_bumps_counter() {
        let state = State::new(sleep_config());
        let pid1 = state.spawn_initial().unwrap();
        let pid2 = state.kill_and_respawn().unwrap();
        assert_ne!(pid1, pid2, "pid must change on respawn");
        assert_eq!(state.restarts(), 1);
        let pid3 = state.kill_and_respawn().unwrap();
        assert_ne!(pid2, pid3);
        assert_eq!(state.restarts(), 2);
        state.kill_for_shutdown().unwrap();
    }

    #[test]
    fn kill_for_shutdown_clears_pid() {
        let state = State::new(sleep_config());
        state.spawn_initial().unwrap();
        state.kill_for_shutdown().unwrap();
        assert_eq!(state.pid(), None);
    }

    #[test]
    fn pid_none_after_child_exits_on_its_own() {
        // Child that exits immediately: supervisor should detect the
        // exit via try_wait and report None rather than a stale pid.
        let state = State::new(Config {
            run_cmd: "true".to_string(),
            workdir: "/tmp".to_string(),
        });
        state.spawn_initial().unwrap();
        // Give the child a moment to exit.
        thread::sleep(Duration::from_millis(100));
        assert_eq!(state.pid(), None, "exited child must not report a pid");
    }

    #[test]
    fn kill_and_respawn_is_idempotent_on_already_dead_child() {
        // Child exits immediately; we call kill_and_respawn against a
        // dead child. Should still spawn a fresh one without erroring.
        let state = State::new(Config {
            run_cmd: "true".to_string(),
            workdir: "/tmp".to_string(),
        });
        state.spawn_initial().unwrap();
        thread::sleep(Duration::from_millis(100));
        let pid_new = state.kill_and_respawn().expect("respawn from dead");
        assert!(pid_new > 0);
        state.kill_for_shutdown().unwrap();
    }

    #[test]
    fn state_handle_is_clonable_and_shared() {
        let state = State::new(sleep_config());
        let pid = state.spawn_initial().unwrap();
        let clone = state.clone();
        assert_eq!(clone.pid(), Some(pid));
        state.kill_for_shutdown().unwrap();
        // The clone observes the shared state.
        assert_eq!(clone.pid(), None);
    }
}
