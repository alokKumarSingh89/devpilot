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

The raw model contract (`RawModelRequirementsAnalysis`) has **no final IDs and no provenance metadata**. Actors use a nonempty local `key` (up to 100 characters); functional `actorIds` refer to these exact keys. Duplicate keys and dangling/duplicate references are rejected. All other content fields match the artifact table, excluding `id`, with one deliberate source-reference difference: raw references use `{section, quote}`; persisted references use `{section, evidence}`. The model cannot supply `schemaVersion`, generation time, project/model metadata or source paths/hashes.

`analysisContract.ts` is the authoritative raw shape and limit definition embedded in the prompt and consumed by runtime validation. Every field is required; missing `measurableTarget` is rejected, while explicit null is valid. No optional fields, missing arrays, guessed actors or acceptance criteria are manufactured. Surrounding string whitespace and known enum casing are normalized. Unknown enum synonyms remain errors. Candidate quotes are trimmed, then checked against the 300-character limit and actual PRD with whitespace collapsed; oversized quotes are rejected with an exact path, never truncated. Section labels are descriptive: “4. Authentication” and “Authentication” are both accepted without exact heading comparison.

DevPilot assigns all canonical IDs as `PREFIX-SEMANTIC-SLUG-HASH`, using up to 40 ASCII slug characters and the first 12 uppercase SHA-256 hexadecimal characters. Identity inputs are normalized with Unicode NFKC, lowercase, and collapsed whitespace:

- Actors: name.
- Functional requirements: title.
- NFRs: category and title.
- Constraints: category and description.
- Out-of-scope items: description.
- Questions: question.

Actor references are remapped. Canonical duplicates/collisions are rejected, not silently merged. IDs survive array reordering, local actor-key changes, and normalized formatting changes; semantic rewording may change them. They do not provide cross-run reconciliation or stable identity across arbitrary model paraphrases. That is a later task.

## Prompt and response boundaries

The prompt compiler owns trusted role, schema, and behavior instructions. The document is placed in a separate `<UNTRUSTED_PRD_JSON>` block as a JSON string. Angle brackets inside document data are escaped, so text cannot close the literal delimiter. Instructions inside the PRD remain data. Only this explicit analysis command sends its contents to the selected reasoning model; discovery, import, refresh, and reload do not.

The model is asked for a single JSON object, without fences or commentary. The parser tolerates surrounding whitespace and exactly one `json` Markdown fence. It rejects prose wrappers, multiple objects/fences, duplicate JSON keys (including escaped equivalents), excessive nesting (over 32 levels), and malformed JSON. It does not repair JSON. Runtime validation reconstructs the owned fields, checks evidence, canonicalizes IDs, and validates the final artifact again before serialization.

The stable VS Code API used by this extension supports user/assistant messages, not a privileged system-message channel. Delimiters are a prompt defense, not a security guarantee. The enforcement boundary is that output is inert, strictly validated data: no tools are provided, no commands are executed, and no output controls file locations. Structural validity and excerpt matching do not prove semantic correctness, completeness, or absence of misleading interpretation. Developer review remains necessary.

## Limits, cancellation, and persistence

The existing safe PRD reader checks UTF-8, extension, size, workspace boundary, and provider-reported symlinks. Analysis rejects changed/missing PRDs and requires explicit re-import; it checks the document and manifest again after model selection and before commit. Existing project source/lifecycle, workspace trust, explicit multi-root selection, and the reasoning-model gate are enforced in the application layer.

At request time, the gateway resolves the selected model ID again and verifies vendor/family against the generating metadata. It counts the complete prompt message with `countTokens`. Input tokens plus 256 tokens of framing allowance must fit both 75% of `maxInputTokens` and `maxInputTokens - 8192`. Unknown/invalid capacity or counts fail closed. This deliberately reserves slack and output headroom; `maxInputTokens` is not a guarantee of the model's full context or output limit. No provider-specific output options or chunked analysis are added. Analysis responses are bounded to 262,144 characters; the existing Test Model limit remains 8,192. YAML is bounded to 1 MiB before parsing or writing. No text is silently truncated.

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

## Integration diagnostics and failure outcomes

Open **View → Output → DevPilot**. Each explicit analysis records start, selected model ID/vendor/family, imported relative path, PRD byte/character size, prompt character size, actual input token count/capacity/headroom, completed stream size/chunk count, extraction/parsing, raw validation/normalization, source quote verification, canonicalization, final validation, persistence and completion/failure stage.

Validation failures include a static schema path, expected type/enum/bound, received type/length and concise reason. Known enum words such as HIGH may be included; arbitrary model strings and unknown property names are withheld. Full PRDs, prompts, response previews, exceptions/stacks and credentials are never logged. Metadata strings are bounded, control-sanitized and common URL/token forms redacted. Diagnostic writes cannot break analysis.

An incomplete object/fence or malformed JSON records a possible incomplete/truncated-response diagnostic; this is a heuristic, not a provider finish reason. The stable VS Code API used here has no portable output-token-limit or finish-reason contract. Increased input headroom helps, but cannot guarantee the provider will produce a complete response. There is no speculative provider-specific `max_tokens`, retry/repair or multi-pass analysis.

On a failed request/pipeline, DevPilot reads the artifact state and reports either **“Analysis failed. The previous requirements artifact was preserved.”** or **“Analysis failed. No requirements artifact was created.”** If the artifact cannot be read/validated, it reports that its status could not be verified. Preflight failures retain actionable messages; changed-source failures still require re-import. Cancellation preserves the prior state and never persists partial output.

Project refresh reads `project.yaml` from storage. Its absence resolves to NOT_INITIALIZED independently of model readiness; the model gate still controls initialization. Deleting `.devpilot` never silently recreates it. Deletion during a model request fails the precommit project check. Reinitialization generates a fresh identity and requires explicit PRD import again.

Regression fixtures `tests/fixtures/devtask-prd.md` and `devtask-analysis.json` exercise representative actors, authentication/projects/tasks, security/performance, NestJS/PostgreSQL, mobile exclusion and invitation ambiguity through extraction → JSON → raw validation/normalization → source quote verification → canonicalization → final artifact validation. They are representative fakes, not captured output from the failing provider.

## Source traceability correction

The real-model diagnostic identified a nonmatching fourth source reference at `functionalRequirements[1].sourceReferences[3].evidence`; transport, complete stream collection and JSON parsing had succeeded. The model-facing name `evidence` left room for interpretation as a paraphrase. The supplied diagnostic proves a normalized text mismatch; without the quote itself it does not establish whether the specific difference was paraphrasing, sentence splicing or punctuation. No transport/token-budget change is part of this correction.

Raw model references now require **`section` + `quote`**, consistently across functional requirements, NFRs, constraints, exclusions and questions. The shared schema and prompt use this contract. `description`/`question` hold interpretation; `quote` must be a short, contiguous, verbatim source excerpt. The prompt requests the smallest useful atomic quote, normally 1–3 materially supporting references, with the existing hard maximum of 5. Unsupported requirements must not be emitted; ambiguity can become a source-grounded question. No missing references are invented and no invalid reference is dropped to salvage an analysis.

`SourceTraceabilityVerifier` normalizes the PRD once, then verifies each candidate deterministically. It collapses consecutive JavaScript whitespace (including CRLF/LF, tabs and Markdown line-break spacing) into a single space and trims the ends. It performs a case-sensitive contiguous substring search. It does not change punctuation, list markers, meaningful words or synonyms; it has no fuzzy matching, embeddings or model dependency.

Results carry `VERIFIED` / `NOT_FOUND`, input/normalized quote lengths and occurrence information. A verified match produces normalized text sliced from the actual source, which becomes persisted `evidence`. Empty, oversized and nonmatching candidates fail. `occurrences: 2` means at least two matches: repeated literal text is valid provenance with a non-unique location, not a reason to reject it. No exact source offset or heading match is claimed; `section` remains navigation metadata. Quote presence proves provenance, not semantic support, completeness or authority. Instructions inside quotes remain untrusted data.

The analysis pipeline logs **source quote verification** separately after raw structure validation and **source quotes verified** only after every reference passes. Failures expose `.quote` paths, `quoteLength`, `normalizedQuoteLength`, `result`, expected text and concise reason. Quotes, section strings and PRD contents are deliberately withheld from diagnostics; no response preview is enabled. A failed quote leaves any existing artifact intact.

Artifact schema remains **1**, with unchanged `{section, evidence}` references and existing artifact readers. New analyses map verified candidate quotes to evidence before canonical IDs and final artifact validation. Legacy artifacts remain readable without migration; loading an artifact does not retroactively reverify it against a possibly changed PRD. The raw contract is intentionally changed: model responses using the old `evidence` field are rejected, not silently interpreted as the new contract.

The realistic DevTask response fixture now uses short `quote` values copied from `devtask-prd.md`. Dedicated verifier tests cover exact/whitespace/CRLF/Markdown matching, paraphrases, invented quotes, non-contiguous assembly, meaningful punctuation/case changes, repeated source text, section formatting, all five output collections, invalid fourth references, schema-v1 compatibility and the provenance-versus-authority boundary.

## Classification contract correction

The observed `constraints[4].category = OPERABILITY` failure is an invalid collection/category combination, not a transport, parsing or casing failure. OPERABILITY remains exclusively an NFR category; constraints retain TECHNOLOGY, BUSINESS, REGULATORY, RESOURCE and OTHER. The supplied diagnostic does not include the item's text, so the actual fifth item's meaning cannot be reconstructed from that report. It may be a misplaced operational-quality requirement or an incorrectly chosen category. No automatic interpretation or relocation is performed.

The prompt now defines functional requirements as observable behavior, NFRs as quality/operational attributes, and constraints as restrictions on implementation/design choices. It explains logging, health checks, readiness and monitoring as typical OPERABILITY NFRs; NestJS, PostgreSQL, React and Docker mandates as TECHNOLOGY constraints; and distinguishes CI tool/process restrictions from CI qualities. Independent concepts may be separated, but a single statement must not be duplicated indiscriminately. OTHER is not a fallback for misplaced NFRs.

Allowed lists in the prose prompt, shared raw schema, canonical validator and TypeScript types derive from `NFR_CATEGORIES`, `CONSTRAINT_CATEGORIES`, `PRIORITIES` and `CONFIDENCES` in `requirements.ts`. No enum values were added. A compact synthetic JSON example includes behavior, SECURITY and OPERABILITY NFRs, a TECHNOLOGY constraint, exclusion and question. It is tested through raw validation, exact quote verification, canonicalization and artifact validation, and is explicitly not a source of requirements for the user's PRD.

For a known NFR-only category used in constraints, diagnostics retain the exact field and expected values and add the constraint index and fixed operational keyword hints from at most 2,000 description characters. Only labels such as `logging` or `health/readiness` are emitted; no description, quote or credential preview is logged. These hints are diagnostic, not semantic classification. When the description contains no recognized terms the diagnostic says so. Unknown categories still fail normally. Lowercase valid categories normalize in their correct collection; invalid combinations never map to OTHER/TECHNOLOGY or move between collections.

The representative DevTask fixture now includes failure logging and health readiness as OPERABILITY NFRs and backend/frontend/container technology boundaries as TECHNOLOGY constraints, with exact source quotes. All previous evidence, cancellation, persistence and model-gate protections remain in place.
