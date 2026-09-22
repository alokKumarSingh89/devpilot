# Repository inventory V1

TASK-DP-006 creates deterministic facts at `.devpilot/codebase/inventory.yaml`. It does not generate architectural conclusions, invoke AI, execute code or change project lifecycle. Only explicitly requested scans for initialized CODEBASE / PRD_AND_CODEBASE projects are allowed. PRD intelligence remains independent.

## Boundaries

`domain/repository` owns types, limits, portable-path rules and strict runtime validation. `application/repository` owns scan/state orchestration and ports; its `detection` functions transform bounded snapshots into facts without editor APIs. `infrastructure/repository` implements VS Code discovery, optional Git metadata and YAML storage. Command controllers own progress/cancellation and editor opening; the Control Center renders escaped summaries. The composition root owns service/listener/watcher disposal. No reasoning gateway is a scan dependency. Cancellation reuses the existing editor-independent token contract.

## Persisted schema

Unknown fields and unsupported schema versions are rejected. All collections and strings are bounded; source contents are never persisted. Exact TypeScript definitions are in `src/domain/repository/inventory.ts`, with the authoritative runtime constraints in `validateInventory.ts`.

| Field | V1 meaning |
| --- | --- |
| `schemaVersion` | Literal `1` |
| `generated` | UTC ISO `generatedAt`, project UUID `projectId`, lowercase 64-hex `repositoryFingerprint` |
| `repository` | Display `workspaceName`, SINGLE_PACKAGE / MONOREPO / UNKNOWN `type`, classification `evidence` |
| `languages` | Known language `name` and nonnegative `fileCount` |
| `manifests` | Safe `relativePath`, known manifest `type`, SHA-256 `contentHash` or null when not inspected |
| `packages` | Stable `id`, extracted/fallback `name`, parent `relativePath` (`.` for root), known `kind`, `manifestPath` |
| `frameworks` | Known `name` and manifest `evidence` |
| `testing` | Known `frameworks` and filename-based `testFileCount` |
| `tooling` | `packageManager: {name, conflict, evidence}` and known `buildTools` |
| `git` | `{available: false}` or `{available: true, branch, headCommit, dirty}`; branch/commit may be null for detached/unborn HEAD |
| `importantFiles` | Ranked candidate `relativePath` and a fixed detector `reason` |
| `statistics` | `discoveredFiles`, `consideredFiles`, `ignoredFiles` within the bounded search result |
| `scan` | `truncated`, sorted `truncationReasons`, effective five-field `limits` |

Evidence is `{relativePath, signal}`: a safe manifest path plus a fixed detector description, never arbitrary script/configuration values. Package IDs are `PKG-` plus the first 16 hexadecimal characters of SHA-256 of the manifest path. They survive package-name changes but change on manifest moves. Multiple ecosystem manifests in one folder can represent separate package records; V1 does not reconcile them semantically.

Validation also enforces unique identities/paths, package/manifest parent relationships, evidence references, recognized enums, timestamps, Git hashes, counter consistency, safe integers, configured hard caps and the relationship between truncation flags/reasons. Absolute paths, traversal, encoded/ambiguous paths, control characters and excluded/secret paths are rejected. Validation establishes structural integrity, not the truth of manually edited facts.

## Discovery and bounds

Discovery uses `workspace.findFiles` scoped to the selected root, followed by asynchronous `workspace.fs.stat` calls in batches of 32. A single operation performs one bounded search. Results are deduplicated and lexically ordered. Ordinary source contents are never read: only paths, extensions and sizes are needed. Search requests one additional sentinel result to detect file-count truncation.

Resource-scoped settings have minimum 1:

| Setting suffix under `devpilot.inventory` | Default | Hard maximum |
| --- | ---: | ---: |
| `maxFiles` | 5,000 | 20,000 |
| `maxManifests` | 200 | 500 |
| `maxImportantFiles` | 100 | 300 |
| `maxMetadataBytes` | 131,072 | 524,288 |
| `maxPackages` | 100 | 200 |

Constants are centralized in the domain module. Invalid settings fall back to the complete default configuration. Additional fixed protections are 4 MiB aggregate metadata reads, path depth 32, and 2 MiB serialized inventory. Root manifests precede nested manifests; ties use lexical paths. Important candidates use fixed scores then lexical paths. Bounds and skipped unsafe/unreadable/invalid metadata produce visible incomplete coverage with reason codes. A successful scan with incomplete coverage is not a complete repository census.

`discoveredFiles` is the number returned by the capped search, including its possible sentinel. `consideredFiles` counts accepted files; `ignoredFiles` is the difference. Files excluded by VS Code before results are returned cannot be counted and are not represented as a claimed total. When search truncates, providers can return different subsets across runs; fingerprint stability is guaranteed for identical bounded snapshots, not arbitrary incomplete search orderings.

Required directory exclusions at every depth: `.git`, `.devpilot`, `node_modules`, `dist`, `build`, `coverage`, `.next`, `.nuxt`, `out`, `target`, `vendor`, `__pycache__`, `.venv`, `venv`. Enabled `files.exclude` and `search.exclude` patterns are also passed to search. Conditional exclusion objects are conservatively treated as enabled. Literal path checks independently enforce required exclusions after search. Search-provider ignore behavior may further reduce coverage.

## Metadata and detection

The manifest catalog recognizes package/lock/workspace/TypeScript configs, pyproject/requirements, Maven/Gradle, Go/Cargo, Docker/Compose and GitHub workflows. Only selected small package/requirements manifests and TypeScript/workspace/tool configs are read and hashed. Lockfiles, Docker files and CI workflows are inventoried by path only. Source, shell-script, test and workflow execution never occurs.

JavaScript/TypeScript, Python, Java, Go and Rust are counted from extensions. NPM dependency keys identify NestJS, React, Next.js, Angular, Vue, Vitest, Jest and build tools; `engines.vscode` signals VS Code Extension. Python uses constrained dependency-line inspection for FastAPI/Django/Pytest, and Java uses known dependency/plugin coordinates for Spring Boot/JUnit. Go/Cargo manifests identify packages and tools. V1 does not execute configuration or fully parse every TOML/Gradle dialect, resolve dependencies, or claim semantic understanding. Framework names require manifest evidence rather than folder names.

Package-manager lockfile and `packageManager` declarations are combined deterministically. Multiple distinct managers produce `UNKNOWN` with `conflict: true` and all evidence; this is deliberately conservative, including mixed-ecosystem repositories. No evidence produces UNKNOWN without conflict.

MONOREPO requires a workspace declaration, root pnpm/Turbo/Nx configuration, or at least two package records directly under conventional `apps`, `packages` or `services` directories. One package without workspace evidence is SINGLE_PACKAGE; ambiguous multiple manifests are UNKNOWN. Presence of a workspace config is an indicator, not proof it is operational.

Tests are filename indicators (`*.spec/test` JS/TS variants, Python `test_*` / `*_test`, Go `*_test`, Java `*Test(s)`) plus known dependency/config signals for frameworks. Important files rank root manifests, entry points, nested manifests/configuration, bootstrap/modules/routes and schema candidates. No source body is read to verify their role.

## Secrets and filesystem safety

`.env`, `.env.*`, `*.pem`, `*.key`, `id_rsa` and `id_ed25519` are excluded entirely, including from persisted paths. Ordinary metadata can still contain sensitive values; readers retain only bounded transient text, hashes, constrained package names and fixed dependency indicators. Full manifests, script values, credentials, remote URLs and arbitrary configuration fields are never copied into inventory. No repository input is sent to a model.

URI construction remains in infrastructure. Parent directories and final files must have ordinary provider-reported types; symlinks and outside-root results are rejected. Metadata size is checked before and after reading, including a stat/read size consistency check, UTF-8 decoding and binary-control rejection. VS Code has no streaming `readFile` or race-free no-follow open: a changing file can be allocated before post-read rejection, and provider symlink guarantees cannot eliminate filesystem races. This is bounded best-effort inspection, not an OS sandbox.

## Git and fingerprint

The Git adapter reads only cached metadata from an already active built-in VS Code Git extension using API version 1. It reads bounded repository entries and requires an exact selected-root match. It does not activate Git, call status, spawn commands, inspect remotes or read credentials. Missing/inactive Git, unmatched nested roots or malformed data yields `available: false` without failing the scan. Cached state may lag external Git changes. API reference: [VS Code Git declarations](https://github.com/microsoft/vscode/blob/main/extensions/git/src/api/git.d.ts).

Fingerprint = SHA-256 of stable JSON containing algorithm version 1, sorted considered `[relativePath, sizeBytes]` pairs, selected manifest path/type/hash records, effective limits, sorted coverage reasons and Git HEAD (or null). It excludes generation time, project identity, absolute root, workspace display name, branch and dirty state. Excluding dirty state prevents DevPilot's own metadata writes from invalidating inventory. `.devpilot` and other exclusions never enter discovery.

Unchanged bounded metadata yields the same fingerprint; added/removed/renamed files, size changes, inspected configuration changes and HEAD changes normally alter it. Same-size edits to ordinary source or uninspected lock/CI/Docker contents are intentionally undetectable. Changes outside the bounded set are also invisible. This is a likely-staleness signal, not a whole-repository content checksum.

## State, cancellation and persistence

Without an artifact the state is NOT_SCANNED. A valid saved artifact is SCANNED, with a notice when freshness has not been checked this session. **Refresh Project** explicitly discovers one snapshot to compare fingerprints without overwriting inventory; mismatches become STALE. **Rescan Codebase** writes a fresh artifact. Artifact watchers only reload saved state. No polling, model calls or implicit scans occur. PRD + Existing Code retains its separate requirements state.

The application rejects duplicate operations and rechecks trust, selected workspace, project source/status, cancellation and unchanged project identity before committing. Cancellation sources/subscriptions are disposed. A cancelled operation retains the previous artifact and valid prior state; a failure produces a concise FAILED state and retains any previous artifact. Errors and labels are escaped; raw exceptions/stacks are never rendered. The webview remains script-free with its existing CSP and allowlisted static commands.

Complete validated YAML is written to a temporary sibling and renamed after destination digest and application precommit checks. Read/write sizes are bounded, YAML aliases and duplicate keys are rejected, and best-effort cleanup removes temporary files. Invalid generated data never replaces valid inventory. `project.yaml` is never written by scanning and remains INITIALIZING.

Filesystem providers determine rename atomicity. VS Code offers no compare-and-swap, leaving a narrow external-write race after the last check. Cancellation after rename begins cannot undo a completed commit. These limitations match the existing artifact persistence approach; avoid simultaneous external edits during replacement.
