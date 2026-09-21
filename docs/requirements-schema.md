# Requirements artifact V1

TASK-DP-005 stores `.devpilot/product/requirements.yaml` independently from `project.yaml`. The latter is never written by analysis, and its lifecycle remains `INITIALIZING`. DevPilot owns the schema; raw model responses and full prompts are not saved or logged.

## Structure

| Field | Required value |
| --- | --- |
| `schemaVersion` | Integer `1` |
| `generated.generatedAt` | UTC ISO timestamp with milliseconds |
| `generated.projectId` | Existing project's UUID, supplied by DevPilot |
| `generated.model` | Selected model's `id`, `vendor`, `family` strings |
| `generated.source` | Imported workspace-relative `relativePath` and lowercase SHA-256 `contentHash` |
| `product` | Nonempty `name` (160 characters), `summary` (3,000 characters) |
| `actors` | Array of `{ id, name, description }` |
| `functionalRequirements` | Array of `{ id, title, description, priority, actorIds, acceptanceCriteria, sourceReferences, confidence }` |
| `nonFunctionalRequirements` | Array of `{ id, category, title, description, measurableTarget, sourceReferences, confidence }` |
| `constraints` | Array of `{ id, category, description, sourceReferences }` |
| `outOfScope` | Array of `{ id, description, sourceReferences }` |
| `openQuestions` | Array of `{ id, question, sourceReferences }` |

All fields are required, including arrays that happen to be empty. Unknown fields are rejected at every level. Each top-level array permits 0–200 entries. Titles and actor names are limited to 160 characters; descriptions and questions to 2,000. Nonempty strings are trimmed and unsafe control characters are rejected. Limits count JavaScript UTF-16 code units.

Priorities are `MUST`, `SHOULD`, `COULD`; confidence is `HIGH`, `MEDIUM`, `LOW`. Confidence describes support in the PRD, not predicted implementation success. NFR categories are `SECURITY`, `PERFORMANCE`, `RELIABILITY`, `SCALABILITY`, `USABILITY`, `OPERABILITY`, `MAINTAINABILITY`, `COMPLIANCE`, `OTHER`. Constraint categories are `TECHNOLOGY`, `BUSINESS`, `REGULATORY`, `RESOURCE`, `OTHER`.

Every functional requirement has 1–20 acceptance criteria (each at most 1,000 characters). `actorIds` has at most 50 unique references to defined actors; it may be empty for behavior without a specified actor. `measurableTarget` is a nonempty string of at most 1,000 characters, or `null` when the PRD states no numeric/verifiable target. DevPilot does not invent a target to fill that field.

## Traceability and identifiers

Every requirement, constraint, out-of-scope item, and question needs 1–5 references. Each reference contains a nonempty `section` of at most 200 characters and nonempty `evidence` of at most **300 characters**. Oversized evidence is rejected, never truncated. On new analysis, every evidence excerpt must occur in the PRD after collapsing whitespace. Section labels may describe unheaded locations; their semantic accuracy still needs developer review. Loading a saved artifact validates structure and provenance fields without automatically requesting a model or re-analyzing source text.

Proposed IDs must use the appropriate `ACTOR-`, `FR-`, `NFR-`, `CONSTRAINT-`, `OOS-`, or `QUESTION-` prefix followed by uppercase letters/digits/hyphens, at most 100 characters. Duplicate IDs and dangling actor references are rejected before canonicalization.

DevPilot replaces proposed IDs with `PREFIX-SEMANTIC-SLUG-HASH`, using up to 40 ASCII slug characters and the first 12 uppercase SHA-256 hexadecimal characters. Identity inputs are normalized with Unicode NFKC, lowercase, and collapsed whitespace:

- Actors: name.
- Functional requirements: title.
- NFRs: category and title.
- Constraints: category and description.
- Out-of-scope items: description.
- Questions: question.

Actor references are remapped. Canonical duplicates/collisions are rejected, not silently merged. IDs survive array reordering, proposed-ID changes, and normalized formatting changes; semantic rewording may change them. They do not provide cross-run reconciliation or stable identity across arbitrary model paraphrases. That is a later task.

## Prompt and response boundaries

The prompt compiler owns trusted role, schema, and behavior instructions. The document is placed in a separate `<UNTRUSTED_PRD_JSON>` block as a JSON string. Angle brackets inside document data are escaped, so text cannot close the literal delimiter. Instructions inside the PRD remain data. Only this explicit analysis command sends its contents to the selected reasoning model; discovery, import, refresh, and reload do not.

The model is asked for a single JSON object, without fences or commentary. The parser tolerates surrounding whitespace and exactly one `json` Markdown fence. It rejects prose wrappers, multiple objects/fences, duplicate JSON keys (including escaped equivalents), excessive nesting (over 32 levels), and malformed JSON. It does not repair JSON. Runtime validation reconstructs the owned fields, checks evidence, canonicalizes IDs, and validates the final artifact again before serialization.

The stable VS Code API used by this extension supports user/assistant messages, not a privileged system-message channel. Delimiters are a prompt defense, not a security guarantee. The enforcement boundary is that output is inert, strictly validated data: no tools are provided, no commands are executed, and no output controls file locations. Structural validity and excerpt matching do not prove semantic correctness, completeness, or absence of misleading interpretation. Developer review remains necessary.

## Limits, cancellation, and persistence

The existing safe PRD reader checks UTF-8, extension, size, workspace boundary, and provider-reported symlinks. Analysis rejects changed/missing PRDs and requires explicit re-import; it checks the document and manifest again after model selection and before commit. Existing project source/lifecycle, workspace trust, explicit multi-root selection, and the reasoning-model gate are enforced in the application layer.

At request time, the gateway resolves the selected model ID again and verifies vendor/family against the generating metadata. It counts the complete prompt message with `countTokens`. Input tokens plus 256 tokens of framing allowance must fit both 75% of `maxInputTokens` and `maxInputTokens - 4096`. Unknown/invalid capacity or counts fail closed. This deliberately reserves slack and output headroom; `maxInputTokens` is not a guarantee of the model's full context or output limit. No provider-specific output options or chunked analysis are added. Analysis responses are bounded to 262,144 characters; the existing Test Model limit remains 8,192. YAML is bounded to 1 MiB before parsing or writing. No text is silently truncated.

A single application operation guard prevents overlapping analyses in this extension instance, including while switching roots. Progress is cancellable. Cancellation is forwarded through the gateway and stops waiting for discovery, token counting, request setup, and stream fragments even if a provider is slow to acknowledge it. Cancellation sources, listeners, and iterator cleanup are disposed; extension shutdown cancels analysis. Partial output is never persisted. Before rename, cancellation discards temporary output and restores state from the previous artifact (or Not analyzed). Once the final rename has started, it is the commit point and cannot be cancelled transactionally.

Persistence serializes a fully validated artifact, checks destination/parent types, writes a unique temporary file in `.devpilot/product`, and then renames it into place. Creation uses `overwrite: false`; explicit re-analysis replaces a previous artifact only after validation. Source/project/cancellation are rechecked immediately before publishing, and artifact changes detected during the write phase cause a conflict. A valid previous artifact survives parsing, validation, preflight, or temporary-write failures. Temporary files are cleaned up where the filesystem permits it.

VS Code providers do not expose compare-and-swap transactions. Concurrent external edits between checks and rename and filesystem symlink races cannot be eliminated; rename atomicity depends on the provider. A user edit made during the model request, before the storage write phase begins, can be replaced by successful explicit re-analysis. Avoid external artifact edits during analysis. Invalid/oversized or symlinked artifact paths fail safely; no automatic destructive repair is attempted.

## Analysis state

| State | Meaning |
| --- | --- |
| `NOT_ANALYZED` | No artifact exists |
| `ANALYZING` | Explicit analysis is running; no duplicate action |
| `ANALYZED` | Valid artifact's project ID, source path and hash match imported metadata |
| `STALE` | Valid artifact no longer matches current project/imported metadata |
| `FAILED` | Safe last-operation or artifact-validation/read error; previous valid artifact remains reviewable when available |

Transient running/failure states are not persisted. Reload derives state from validated files. Failures are associated with project ID and imported metadata so re-importing does not retain an unrelated failure. Requirements file events and manual project refresh update the view; they do not call AI. Changing the PRD without re-importing is shown by the separate PRD `CHANGED` state and blocks analysis even if the artifact still matches the old imported hash. After re-import, that artifact becomes `STALE`.
