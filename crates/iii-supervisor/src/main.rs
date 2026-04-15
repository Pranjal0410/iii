// Copyright Motia LLC and/or licensed to Motia LLC under one or more
// contributor license agreements. Licensed under the Elastic License 2.0;
// you may not use this file except in compliance with the Elastic License 2.0.
// This software is patent protected. We welcome discussions - reach out at support@motia.dev
// See LICENSE and PATENTS files for details.

//! In-VM supervisor binary.
//!
//! Runs as PID something-not-one inside a libkrun microVM alongside the
//! user's worker process. The supervisor's whole job is to keep the VM
//! alive across source edits: it spawns the worker command as a child,
//! listens for `Restart`/`Shutdown` messages on a virtio-console port
//! from the host, and cycles the child in-place. The VM itself never
//! reboots between saves, which is how the dev loop goes from ~1s to
//! ~200ms.

use std::fs::OpenOptions;
use std::io::BufReader;
use std::path::PathBuf;

use clap::Parser;

use iii_supervisor::child::{Config, State};
use iii_supervisor::{control, signals};

/// Virtio-console port name configured on the host side via
/// `ConsoleBuilder::port("iii.control", ...)`. The guest kernel
/// exposes this at `/sys/class/virtio-ports/<dev>/name`; we find the
/// matching device node at runtime rather than hardcoding a path that
/// depends on port-enumeration order.
pub const CONTROL_PORT_NAME: &str = "iii.control";

#[derive(Parser, Debug)]
#[command(
    name = "iii-supervisor",
    about = "in-VM process supervisor for iii workers"
)]
struct Args {
    /// Shell command to run and supervise. Executed via `/bin/sh -c`
    /// so normal shell syntax (pipes, env, `&&`) works.
    #[arg(long, value_name = "CMD")]
    run_cmd: String,

    /// Optional override for the control-port device path. When set,
    /// skips the sysfs name lookup and opens this path directly. Used
    /// by tests and as an escape hatch; normal boots resolve the port
    /// by name (`iii.control`).
    #[arg(long, value_name = "PATH")]
    control_port: Option<PathBuf>,

    /// Working directory for the child process.
    #[arg(long, default_value = "/workspace", value_name = "DIR")]
    workdir: PathBuf,
}

/// Walk `/sys/class/virtio-ports/*/name` and return the `/dev/<dev>`
/// path for the entry whose name matches `target`. Returns `None`
/// when sysfs isn't mounted, no entries exist, or no name matches.
///
/// Virtio-console port numbering depends on controller count and
/// whether the implicit console is enabled — hardcoding
/// `/dev/vport0p1` breaks when libkrun wires the implicit console
/// first. The sysfs name is stable by construction (we pick it on
/// the host), so lookup by name is the right primitive.
fn find_virtio_port_by_name(target: &str) -> Option<PathBuf> {
    let sysfs = std::path::Path::new("/sys/class/virtio-ports");
    let entries = std::fs::read_dir(sysfs).ok()?;
    for entry in entries.flatten() {
        let dev_name = entry.file_name();
        let dev_name_str = dev_name.to_string_lossy();
        let name_file = entry.path().join("name");
        if let Ok(contents) = std::fs::read_to_string(&name_file)
            && contents.trim() == target
        {
            return Some(PathBuf::from("/dev").join(dev_name_str.as_ref()));
        }
    }
    None
}

fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info")),
        )
        .with_writer(std::io::stderr)
        .init();

    let args = Args::parse();

    // Resolve the control port: explicit override wins, otherwise
    // look up by name via /sys/class/virtio-ports. The sysfs lookup
    // is the correct primitive because device index (e.g. vport0p1
    // vs vport0p2) depends on whether libkrun wired an implicit
    // console ahead of our named port — something we can't predict
    // from the host side.
    let control_port = match &args.control_port {
        Some(p) => p.clone(),
        None => match find_virtio_port_by_name(CONTROL_PORT_NAME) {
            Some(p) => p,
            None => {
                anyhow::bail!(
                    "could not locate virtio-console port '{CONTROL_PORT_NAME}' in \
                     /sys/class/virtio-ports. The VM may have been booted without \
                     --control-sock, or sysfs isn't mounted yet."
                );
            }
        },
    };

    tracing::info!(
        run_cmd = %args.run_cmd,
        control_port = %control_port.display(),
        workdir = %args.workdir.display(),
        "iii-supervisor starting"
    );

    let state = State::new(Config {
        run_cmd: args.run_cmd,
        workdir: args.workdir.to_string_lossy().to_string(),
    });

    // Spawn the worker immediately. If this fails, the supervisor has
    // nothing to supervise — bail and let the VM exit so the host
    // observes the failure and can decide what to do.
    let pid = state.spawn_initial()?;
    tracing::info!(pid, "worker spawned");

    signals::install(state.clone());

    // Open the virtio-console port bidirectionally. The same fd is used
    // for reads and writes — the guest sees it as a char device and
    // libkrun wires both directions to the same host socket.
    let file = OpenOptions::new()
        .read(true)
        .write(true)
        .open(&control_port)?;
    let writer = file.try_clone()?;
    let reader = BufReader::new(file);

    control::serve(state.clone(), reader, writer)?;

    // Reached when either the host closed the channel or a Shutdown
    // request was processed. Either way, child is dead; exit cleanly so
    // the VM powers off.
    tracing::info!("supervisor exiting");
    Ok(())
}
