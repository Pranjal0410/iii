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

    /// Path to the virtio-console control port exposed by libkrun. The
    /// host writes newline-delimited JSON requests here; the supervisor
    /// replies on the same fd.
    #[arg(long, default_value = "/dev/vport0p1", value_name = "PATH")]
    control_port: PathBuf,

    /// Working directory for the child process.
    #[arg(long, default_value = "/workspace", value_name = "DIR")]
    workdir: PathBuf,
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
    tracing::info!(
        run_cmd = %args.run_cmd,
        control_port = %args.control_port.display(),
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
        .open(&args.control_port)?;
    let writer = file.try_clone()?;
    let reader = BufReader::new(file);

    control::serve(state.clone(), reader, writer)?;

    // Reached when either the host closed the channel or a Shutdown
    // request was processed. Either way, child is dead; exit cleanly so
    // the VM powers off.
    tracing::info!("supervisor exiting");
    Ok(())
}
