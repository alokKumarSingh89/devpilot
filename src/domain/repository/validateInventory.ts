import { validateDocumentPath } from '../documentPath';
import { ignoredRepositoryPath } from './repositoryPaths';
import { InventoryFailure } from './InventoryFailure';
import { BUILD_TOOLS, FRAMEWORKS, HARD_SCAN_LIMITS, LANGUAGES, MANIFEST_TYPES, PACKAGE_MANAGERS, TEST_FRAMEWORKS, TRUNCATION_REASONS, type Evidence, type Inventory, type ScanLimits, type GitMetadata } from './inventory';
function invalid(): never { throw new InventoryFailure('INVALID_INVENTORY'); }
function record(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return invalid();
  const data = value as Record<string, unknown>;
  if (Object.keys(data).length !== keys.length || keys.some((key) => !Object.hasOwn(data, key))) return invalid();
  return data;
}
function text(value: unknown, max = 1024): string { if (typeof value !== 'string' || !value.trim() || value.length > max || /[\u0000-\u001f\u007f]/.test(value)) return invalid(); return value; }
function number(value: unknown, max = 20001): number { if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value > max) return invalid(); return value; }
function bool(value: unknown): boolean { if (typeof value !== 'boolean') return invalid(); return value; }
function choice<T extends string>(value: unknown, choices: readonly T[]): T { return choices.find((item) => item === value) ?? invalid(); }
function list<T>(value: unknown, parse: (item: unknown) => T, max = 500): T[] { if (!Array.isArray(value) || value.length > max) return invalid(); return value.map(parse); }
function unique<T>(items: readonly T[], key: (item: T) => string): void { if (new Set(items.map(key)).size !== items.length) invalid(); }
function path(value: unknown): string { const result = validateDocumentPath(value); if (ignoredRepositoryPath(result)) return invalid(); return result; }
function hash(value: unknown): string { const result = text(value, 64); return /^[a-f0-9]{64}$/.test(result) ? result : invalid(); }
function evidence(value: unknown): Evidence[] { return list(value, (item) => { const data = record(item, ['relativePath', 'signal']); return { relativePath: path(data.relativePath), signal: text(data.signal) }; }, 1000); }
export function validateScanLimits(value: unknown): ScanLimits {
  const keys = Object.keys(HARD_SCAN_LIMITS) as (keyof ScanLimits)[];
  const data = record(value, keys);
  const result = Object.fromEntries(keys.map((key) => { const limit = number(data[key], HARD_SCAN_LIMITS[key]); if (limit < 1) invalid(); return [key, limit]; })) as unknown as ScanLimits;
  return result;
}
export function validateGitMetadata(value: unknown): GitMetadata {
  if (typeof value !== 'object' || value === null || !('available' in value)) return invalid();
  if (value.available === false) { record(value, ['available']); return { available: false }; }
  const data = record(value, ['available', 'branch', 'headCommit', 'dirty']);
  if (data.available !== true) return invalid();
  const branch = data.branch === null ? null : text(data.branch, 200);
  const headCommit = data.headCommit === null ? null : text(data.headCommit, 64);
  if (headCommit && !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(headCommit)) return invalid();
  return { available: true, branch, headCommit, dirty: bool(data.dirty) };
}
export function validateInventory(value: unknown): Inventory {
  try {
    const root = record(value, ['schemaVersion', 'generated', 'repository', 'languages', 'manifests', 'packages', 'frameworks', 'testing', 'tooling', 'git', 'importantFiles', 'statistics', 'scan']);
    if (root.schemaVersion !== 1) return invalid();
    const g = record(root.generated, ['generatedAt', 'projectId', 'repositoryFingerprint']);
    const generatedAt = text(g.generatedAt, 24); if (new Date(generatedAt).toISOString() !== generatedAt) return invalid();
    const projectId = text(g.projectId, 36); if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(projectId)) return invalid();
    const r = record(root.repository, ['workspaceName', 'type', 'evidence']);
    const languages = list(root.languages, (item) => { const data = record(item, ['name', 'fileCount']); return { name: choice(data.name, LANGUAGES), fileCount: number(data.fileCount) }; }, LANGUAGES.length);
    const manifests = list(root.manifests, (item) => { const data = record(item, ['relativePath', 'type', 'contentHash']); return { relativePath: path(data.relativePath), type: choice(data.type, MANIFEST_TYPES), contentHash: data.contentHash === null ? null : hash(data.contentHash) }; });
    const packages = list(root.packages, (item) => {
      const data = record(item, ['id', 'name', 'relativePath', 'kind', 'manifestPath']);
      const id = text(data.id, 20); if (!/^PKG-[a-f0-9]{16}$/.test(id)) return invalid();
      const relativePath = data.relativePath === '.' ? '.' : path(data.relativePath); const manifestPath = path(data.manifestPath);
      if ((manifestPath.includes('/') ? manifestPath.slice(0, manifestPath.lastIndexOf('/')) : '.') !== relativePath) return invalid();
      return { id, name: text(data.name, 160), relativePath, kind: choice(data.kind, ['APPLICATION', 'LIBRARY', 'SERVICE', 'PACKAGE', 'UNKNOWN'] as const), manifestPath };
    }, 200);
    const frameworks = list(root.frameworks, (item) => { const data = record(item, ['name', 'evidence']); const refs = evidence(data.evidence); if (!refs.length) return invalid(); return { name: choice(data.name, FRAMEWORKS), evidence: refs }; }, FRAMEWORKS.length);
    const t = record(root.testing, ['frameworks', 'testFileCount']);
    const tooling = record(root.tooling, ['packageManager', 'buildTools']); const pm = record(tooling.packageManager, ['name', 'conflict', 'evidence']);
    const pmName = choice(pm.name, PACKAGE_MANAGERS); const conflict = bool(pm.conflict); if (conflict && pmName !== 'UNKNOWN') return invalid();
    const importantFiles = list(root.importantFiles, (item) => { const data = record(item, ['relativePath', 'reason']); return { relativePath: path(data.relativePath), reason: text(data.reason, 200) }; }, 300);
    const stats = record(root.statistics, ['discoveredFiles', 'consideredFiles', 'ignoredFiles']);
    const statistics = { discoveredFiles: number(stats.discoveredFiles), consideredFiles: number(stats.consideredFiles), ignoredFiles: number(stats.ignoredFiles) };
    if (statistics.consideredFiles + statistics.ignoredFiles !== statistics.discoveredFiles || languages.reduce((total, item) => total + item.fileCount, 0) > statistics.consideredFiles) return invalid();
    const scan = record(root.scan, ['truncated', 'truncationReasons', 'limits']); const limits = validateScanLimits(scan.limits);
    const truncationReasons = list(scan.truncationReasons, (item) => choice(item, TRUNCATION_REASONS), TRUNCATION_REASONS.length);
    const truncated = bool(scan.truncated); if (truncated !== (truncationReasons.length > 0)) return invalid();
    if (statistics.consideredFiles > limits.maxFiles || manifests.length > limits.maxManifests || packages.length > limits.maxPackages || importantFiles.length > limits.maxImportantFiles) return invalid();
    const testing = { frameworks: list(t.frameworks, (item) => choice(item, TEST_FRAMEWORKS), TEST_FRAMEWORKS.length), testFileCount: number(t.testFileCount) };
    if (testing.testFileCount > statistics.consideredFiles) return invalid();
    const buildTools = list(tooling.buildTools, (item) => choice(item, BUILD_TOOLS), BUILD_TOOLS.length);
    unique(languages, (item) => item.name); unique(manifests, (item) => item.relativePath); unique(packages, (item) => item.id); unique(packages, (item) => item.manifestPath); unique(frameworks, (item) => item.name); unique(importantFiles, (item) => item.relativePath); unique(testing.frameworks, (item) => item); unique(buildTools, (item) => item); unique(truncationReasons, (item) => item);
    const manifestPaths = new Set(manifests.map((item) => item.relativePath));
    const repositoryEvidence = evidence(r.evidence); const managerEvidence = evidence(pm.evidence);
    if ([...repositoryEvidence, ...managerEvidence, ...frameworks.flatMap((item) => item.evidence)].some((item) => !manifestPaths.has(item.relativePath)) || packages.some((item) => !manifestPaths.has(item.manifestPath))) return invalid();
    return { schemaVersion: 1, generated: { generatedAt, projectId, repositoryFingerprint: hash(g.repositoryFingerprint) },
      repository: { workspaceName: text(r.workspaceName, 160), type: choice(r.type, ['SINGLE_PACKAGE', 'MONOREPO', 'UNKNOWN'] as const), evidence: repositoryEvidence },
      languages, manifests, packages, frameworks, testing, tooling: { packageManager: { name: pmName, conflict, evidence: managerEvidence }, buildTools }, git: validateGitMetadata(root.git), importantFiles, statistics,
      scan: { truncated, truncationReasons, limits } };
  } catch { throw new InventoryFailure('INVALID_INVENTORY'); }
}
