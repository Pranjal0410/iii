# Secret handling

This file specifies how secrets (API keys, DB passwords, OTEL tokens, signing keys)
flow through an iii project without landing in plaintext where a developer does not
expect them. It exists because none of `env_file`, `environment:`, or
`config-worker:<id>` distinguishes a secret from an ordinary string today, and
per-worker config now lives in the **committed `worker-compose.yaml`** (over a
`defaults.yaml` floor); a value set at runtime is **written back into that committed
file** by the optional `configuration` worker. The goal is a small, opinionated v1
that closes the obvious leaks (committed secrets, secrets echoed to a terminal) and
leaves a clean seam for a real secrets backend later, without shipping crypto we can't
yet justify.

The rules below are normative ("MUST"/"SHOULD"). Where two earlier design docs
disagreed, the [SHARED DECISION CONTRACT](README.md) wins and is restated here.

---

## 1. Threat model — where a secret would land in plaintext today

Trace a single secret, `DB_PASSWORD`, through every surface the DX spec introduces.
Each row is a place the value would sit readable, and who can see it.

| # | Surface | How the secret gets there | Who reads it | Persists? |
|---|---|---|---|---|
| T1 | `worker-compose.yaml` `environment:` | Dev inlines `DB_PASSWORD: hunter2` | Anyone with the repo (compose is **committed**, see [worker-compose.md](worker-compose.md)) | git history, forever |
| T2 | `worker-compose.yaml` `config:` blocks (and `defaults.yaml`) | A dev inlines a value in a worker's `config:` block, or `configuration::set` / `iii worker config set` writes a value back into the active compose file | Anyone with the repo (compose `config:` is **committed**, see [worker-compose.md](worker-compose.md)) | git history, forever |
| T3 | `iii worker ps` / `iii worker info <id>` / `iii worker config <id>` | These print **resolved** config/env to stdout | Anyone watching the terminal; CI logs; screen-shares | no, but echoed |
| T4 | `--json` output of the above | Same data, machine-readable | Pipelines, log aggregators that capture stdout | wherever the pipeline lands |
| T5 | Process logs (ring buffer + log file) | A worker that `console.log`s its own config; a crash dump that tails env | `iii worker logs`, the daemon ring buffer + on-disk log file (see [process-daemon.md](process-daemon.md)) | log file on disk |
| T6 | `env_file` on disk | Dev puts `DB_PASSWORD=hunter2` in `.env` | Anyone with the repo **if `.env` is committed** | yes, unless `.gitignore`d |
| T7 | configuration trigger fan-out | Hot-reload payload carries `old_value`/`new_value`, env-expanded | Any worker subscribed to the `configuration` trigger | in-flight; logged if a subscriber logs it |

The two structural hazards, restated plainly:

- **Persistence (T2), now sharper, not softer.** Per-worker config lives in the
  `config:` blocks of the **committed** `worker-compose.yaml` (over the worker's shipped
  `defaults.yaml` floor), and the optional `configuration` worker writes runtime changes
  **back into that committed file** on `configuration::set` (the function behind
  `iii worker config set`). A dev who inlines a literal into a `config:` block, or a
  `set` that writes one in, lands the value in a tracked file; a secret put here does not
  just sit on disk, it persists in **git history forever**. This escalates the old
  on-disk-only `./data/configuration` framing: there is no longer a runtime-only store
  that a checkout could clobber; the source of truth IS the committed file.
- **Echo (T3/T4):** the whole CLI thesis is "every command is a thin wrapper over a
  function that returns resolved state." `worker::info`/`worker::config`/`process::ps`
  return the resolved value by construction, so the default read path leaks unless we
  redact.

`env_file` (T6) is the *least* dangerous surface **as long as it is never committed and
never inlined into the compose file**: the value lives only in a gitignored file and in
the real process env. That observation drives the rules.

---

## 2. The rules (v1, normative)

### Rule 1 — `env_file` carries secrets; `env_file` is NEVER persisted into the compose file

`env_file` entries are **file-only**. They are loaded by the env-file loader at process
launch (see [process-daemon.md](process-daemon.md) for where in the spawn path), applied
to the child process environment, and **never written into the committed compose file or
`defaults.yaml`**. The compose `config:` blocks (over `defaults.yaml`) are for
*non-secret, schema-validated, hot-reloadable* config; they are not a secrets store.

Division of labor:

| Use | For |
|---|---|
| `worker-compose.yaml` `config:` (committed) + the worker's `defaults.yaml` (a worker's own `configuration::register` at boot; `iii worker config set` writing back into the active compose file at runtime) | **Non-secret** runtime config only (log level, sampling rate, feature flags, adapter choice). It is committed, so it must hold no secrets. |
| `env_file` | Secrets and machine-local values (passwords, tokens, DB URLs) |
| `environment:` inline in compose | Non-secret values only (it is committed, see Rule 4) |

This is the cleanest version of the property "a secret should live in exactly one place,
off git." A reviewer can state a one-line invariant:
**nothing in a committed `config:` block (or `defaults.yaml`) came from an `env_file`.**

### Rule 2 — the recommended path: `${VAR}` indirection so the value lives only in process env

For config that must reference a secret but should still be *declared* in a worker's
`config:` block, use a `${VAR}` reference, never the literal. The variable is supplied by
the real process env (typically sourced from an `env_file`), and `${VAR}` is expanded **on
read** by the configuration worker, so the committed compose file holds the reference, not
the secret.

```yaml
# worker-compose.yaml — committed; the config: reference is safe, the secret is NOT here
workers:
  api:
    runtime: { workspace: ./services/api }
    env_file:
      - .env                       # gitignored; DB_PASSWORD=... lives ONLY here
    config:
      # value is the REFERENCE, expanded on read against the process env
      database_url: "postgres://app:${DB_PASSWORD}@db.internal/app"
```

The committed file contains `${DB_PASSWORD}`, not `hunter2`; the secret stays only in the
gitignored `env_file` (and the real process env). Expansion happens on read in the
configuration worker (the same `${VAR:default}` expansion already used for all config
values; see [configuration-and-bootstrap.md](configuration-and-bootstrap.md)). This is the
**strongly recommended** pattern: it composes with hot-reload (the reference is stable;
only the env supplies the secret) and it never serializes the secret into the committed
compose file.

> Caveat: `${VAR}` expansion happens on read, so a *resolved* read (T3/T4 `info`/`config`
> with expansion on) would still surface the secret. That is exactly what Rule 3 redacts.
> Use `--raw` reads (no expansion) for the safe, reference-only view.

### Rule 3 — `secret: true` on a ConfigurationEntry redacts in EVERY read path

For values that genuinely must live in config (a secret a worker hot-reloads, a value
the worker registers once at boot and rotates via `configuration::set`), mark the entry
secret. Add a boolean to `ConfigurationEntry`:

```rust
pub struct ConfigurationEntry {
    pub id: String,
    pub name: String,
    pub description: String,
    pub schema: serde_json::Value,
    pub value: serde_json::Value,
    pub metadata: Option<serde_json::Value>,
    #[serde(default)]
    pub secret: bool,            // NEW — redact in every read path
}
```

Per-field secrecy (one entry, some fields secret) is **out of scope for v1**; secrecy is
entry-granular. Authors who need field-level secrecy split the secret into its own entry.

Because config now lives in the **committed** `worker-compose.yaml`, a `secret: true`
value SHOULD still be a `${VAR}` reference (Rule 2), never a literal: `secret: true`
governs *redaction on read*, it does not stop the literal from being serialized into the
tracked compose file. The two rules compose: `${VAR}` keeps the secret out of git;
`secret: true` keeps the resolved value out of read paths. Redaction below still applies
to **all** read paths regardless.

Redaction contract — applies to **every** function and CLI surface that returns a value:

| Path | Default behavior when `secret: true` | With `--reveal` |
|---|---|---|
| `configuration::get` | returns `"***"` for the value | returns the real (expanded) value |
| `worker::info`, `worker::config` ([cli-and-functions.md](cli-and-functions.md)) | shows `***` | shows real value |
| `process::ps` / `iii worker ps`, `iii worker info`, `iii worker config` | shows `***` | shows real value |
| `--json` output of any of the above | emits `"***"` (a string sentinel, never the real value) | emits real value |
| `configuration::list` | already schema-only, never returns `value` — unchanged | n/a |
| configuration trigger fan-out (T7) | `old_value`/`new_value` redacted to `"***"` for secret entries | n/a — triggers never reveal |

Rules for `--reveal` (and its function-level equivalent, a `reveal: true` argument):

- It MUST be explicit per invocation — there is no persistent "reveal mode."
- It SHOULD require a tty confirmation or be denied when stdout is not a tty (so a CI
  pipeline cannot accidentally `--reveal` into its captured logs). Recommended default:
  `--reveal` is rejected when stdout is not a tty unless `--reveal --force` is given.
- Every `--reveal` SHOULD be recorded (the `configuration` trigger already fires on reads
  is *not* true today — reads are silent; so reveal-audit is an open question, §7).

The redaction is applied at the **serialization boundary** of each function result, not
at the call site, so a new CLI command or a new consumer (TUI, console) inherits it for
free. This is the same "function id is a contract" discipline the rest of the spec relies
on: redaction lives with the function, so every wrapper is safe by default.

### Rule 4 — inline `environment:` and inline `config:` are for non-secrets only (both committed)

`worker-compose.yaml` is committed (Rule: commit compose + lock, §5). An inline
`environment:` value *and* an inline `config:` literal are therefore in git history
forever, since both live in the same committed file. The spec does **not** mechanically
block a secret-looking value (we can't reliably detect one), but:

- `iii worker compose up` / `compose::validate` SHOULD emit a **non-fatal warning** when an
  `environment:` value **or a `config:` value** matches a high-confidence secret heuristic
  (e.g. key name contains `PASSWORD`/`SECRET`/`TOKEN`/`KEY` and the value is not a `${VAR}`
  reference):
  `worker 'api': environment.DB_PASSWORD looks like a secret. Move it to an env_file or use ${DB_PASSWORD}.`
  (and the equivalent `config.database_url looks like a secret. ...`).
- Docs (the `init` scaffold and onboarding, [lifecycle-and-onboarding.md](lifecycle-and-onboarding.md))
  steer secrets to `env_file` from the first hello-world.

---

## 3. Interaction with env precedence and config orthogonality

### Env precedence (restated — the contract's ladder)

Secrets ride the **same** env precedence ladder as every other variable; secrecy does not
change *who wins*, only *who can see the resolved value*. Highest → lowest
(per [worker-compose.md](worker-compose.md), and overriding design A §3.3 which had it
backwards):

```
host process env  >  inline environment:  >  env_file[n] > … > env_file[1] > env_file[0]
   (highest)                                  (LATER-listed file wins among files)   (lowest)
```

Implications for secrets:

- A secret in `env_file` can be overridden by a host env var of the same name — useful for
  CI, where the secret comes from the CI secret store as a real env var and the committed
  `.env` (if any) holds only dev placeholders.
- Because **later-listed env_file wins**, `env_file: [.env, .env.local]` lets `.env.local`
  (the developer's personal, gitignored overrides) supersede the shared `.env`. This is the
  recommended split: `.env` = team defaults (may be committed if non-secret), `.env.local`
  = per-dev secrets (always gitignored).

### Orthogonality with the compose-backed config

The compose `config:` (over `defaults.yaml`) and the env ladder are **independent
resolution systems** that meet only at `${VAR}` expansion:

- The env ladder produces the child process's environment (Rule 2's `DB_PASSWORD`).
- The compose `config:` (over `defaults.yaml`) produces config values, resolved by the
  optional configuration worker, which expands `${VAR}` against that same process env on
  read.
- A `secret: true` config entry (Rule 3) is orthogonal to the env ladder: it governs
  *redaction of config values*, not env vars. An env var is never "secret-tagged"; it is
  redacted only insofar as it is surfaced through a config read or a process-info read that
  the consumer chooses to redact (see the open question in §7 about redacting `environment:`
  in `info`).

The clean mental model: **env_file = secret transport (off-git); committed compose
`config:` = non-secret config (redacted only if marked); `${VAR}` = the bridge.**

---

## 4. `.gitignore` guidance

`iii init` (see [lifecycle-and-onboarding.md](lifecycle-and-onboarding.md)) MUST scaffold a
`.gitignore` with the entries below, and the migration tooling
([migration.md](migration.md)) SHOULD offer to add them.

```gitignore
# iii — machine-local / secret-bearing; never commit
.env
.env.local
.env.*.local
*.env

# the process daemon's local state, logs, sockets
.iii/

# resolved artifacts, caches (machine-global lives in ~/.iii; project copies if any)
```

```gitignore
# iii — DO commit (the reproducible project definition)
# worker-compose.yaml     <- the human-authored boot file (incl. per-worker config:)
# iii.lock                <- the machine-written resolved lockfile
```

Decisions and rationale:

- **`env_file`s are gitignored by default.** This is the linchpin of Rule 1: if `.env` is
  never committed, the secret transport never reaches git. A team that wants to commit a
  *non-secret* `.env` of defaults can un-ignore a specific file, but the default is safe.
- **There is no `./data/configuration/` to ignore.** Per-worker config no longer lives in
  a separate runtime store; it lives in the `config:` blocks of the **committed**
  `worker-compose.yaml` (over the worker's `defaults.yaml`), and the configuration worker
  writes runtime changes back into that same committed file. Because the config IS source
  now, the safety burden shifts entirely onto Rule 2 (references, not literals) and Rule 4
  (no secret-looking inline values): a literal here is committed and is in git history.
- **`.iii/` is gitignored**: daemon state, logs, and any local socket/lock are
  machine-local.
- **`worker-compose.yaml` and `iii.lock` ARE committed**: they are the reproducible
  project definition (the package.json/lockfile split). This is exactly why `environment:`
  *and* `config:` must stay secret-free (Rule 4): both are in the committed file.

---

## 5. Cloud secrets handoff

`env_file` is **local-only**. It MUST NOT be uploaded by `iii cloud deploy`. The cloud uses
its own secrets backend; the local secret transport stops at the machine boundary.

The contract (coordinate with [migration.md](migration.md) M4, the cloud cutover):

| Field | Local (`iii worker compose up`) | Cloud (`iii cloud deploy`) |
|---|---|---|
| `env_file` | loaded into process env | **rejected / ignored** — cloud injects secrets from its backend |
| `environment:` (non-secret) | applied | applied (honored remotely) |
| `${VAR}` references in compose `config:` | expanded against local env | expanded against **cloud-injected** env vars of the same name |
| `secret: true` config entries | redacted in read paths | the cloud backend is the source; config-file values are not deployed |

The handoff is intentionally name-based: a worker reads `${DB_PASSWORD}` identically in both
environments; locally `DB_PASSWORD` comes from `.env`, in the cloud it comes from the cloud
secrets backend bound into the runtime's env. **Nothing in the worker's code or compose file
changes between local and cloud** — only the source of the env var. This keeps the worker
author out of the secrets-plumbing business and makes the local→cloud transition a no-op for
secret references.

`iii cloud deploy` therefore consumes `worker-compose.yaml` + `iii.lock` (the reproducible
definition) and MUST reject local-only secret transports (`env_file`) with an actionable
error pointing the dev at the cloud secrets backend. Exact field-honoring is owned by
[migration.md](migration.md) M4.

---

## 6. Explicitly OUT OF SCOPE for v1

A real secrets backend is **not** in v1. Specifically out of scope:

- **Encryption at rest** of config values in the compose file (age/sops-style encrypted
  `config:` blocks).
- **External secret managers** (HashiCorp Vault, AWS SSM Parameter Store / Secrets Manager,
  GCP Secret Manager, 1Password) as a config source.
- **Secret rotation, leasing, dynamic credentials, or audit trails** beyond best-effort
  `--reveal` gating.
- **Field-level (sub-entry) secrecy** — secrecy is entry-granular in v1 (Rule 3).

v1's posture is: **secrets live off-git (env_file), or as `${VAR}` references in the
committed compose `config:`; the configuration worker redacts what it surfaces;
filesystem permissions + `.gitignore` (on the `env_file`) are the at-rest protection.**
This is honest and shippable.

### The seam (so v1 does not foreclose v2)

The `configuration` worker resolves each entry through a **source** it can vary
per-entry. A real secrets backend is a future per-entry `source:` pointer (the
**`secret` source**) resolved by the configuration worker, instead of the value living
inline in the compose `config:`:

```yaml
# FUTURE (not v1) — sketch only
workers:
  api:
    config:
      database_url: "${DB_PASSWORD}"   # non-secret reference, resolved on read
# a future secret source, selected per-entry:
#   secret entries resolve through a backend instead of the compose file
#   ConfigurationEntry.secret: true would route reads to the backend
```

Because Rule 3 puts redaction at the function-result boundary and `secret: true` is already
a first-class entry field, a v2 `secret` source can resolve secret-tagged entries from an
external backend **without changing any consumer** (CLI, TUI, console all already redact and
already gate `--reveal`). The `secret: true` flag is the forward-compatible hook; the
per-entry source pointer is the storage seam. Nothing in v1 needs to be unwound to add a
backend later.

---

## 7. Open questions

- **Encrypt-at-rest for secret-tagged entries in v1?** Options:
  (a) keep secrets out of the committed compose file entirely (`${VAR}` references + a
  gitignored `env_file`), **recommended default** (no key-management burden, matches
  "off-git is the protection"); (b) age/sops-encrypt only `secret: true` `config:` values
  in the compose file, which adds a key-management UX we can't yet justify and risks a
  half-secret committed file. Recommend (a) for v1, with the §6 seam for (b).
- **Should `info`/`ps` redact `environment:` values too, or only store entries?** Env vars
  are not secret-tagged (Rule 3 is store-only). Options: (a) never redact env in process
  info (status quo — leaks T3 for env-borne secrets); (b) apply the same name-heuristic from
  Rule 4 to redact env values whose key looks secret; (c) let a worker declare which env keys
  are secret in `iii.worker.yaml`. Recommend (b) as a cheap default, (c) as the precise
  escape hatch. **Lead author must reconcile** this with the process-info shape in
  [process-daemon.md](process-daemon.md) and [cli-and-functions.md](cli-and-functions.md).
- **Audit `--reveal`?** Config reads are silent today (no trigger on `get`). Should
  `--reveal` emit an audit event? Recommend deferring to v2 alongside the real backend, but
  flag it so the function signature can reserve the hook.
- **Default `.gitignore` aggressiveness for `.env`.** Ignoring all `*.env` by default is
  safe but blocks a team that wants a committed non-secret `.env`. Recommend ignore-by-default
  + documented opt-out, but confirm with onboarding ([lifecycle-and-onboarding.md](lifecycle-and-onboarding.md)).
