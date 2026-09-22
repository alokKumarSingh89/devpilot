import { createHash } from 'node:crypto';
import type { Inventory, GitMetadata, Evidence, TruncationReason } from '../../../domain/repository/inventory';
import { ignoredRepositoryPath } from '../../../domain/repository/repositoryPaths';
import type { RepositorySnapshot } from '../ports';
import { importantReason, isPackageManifest, isTestFile, language, manifestType } from './fileSignals';
import { manifestSignals, type ManifestSignals } from './manifestSignals';
const compare = (a: string, b: string): number => a < b ? -1 : a > b ? 1 : 0;
const LOCKFILE_MANAGERS: Readonly<Record<string, Inventory['tooling']['packageManager']['name']>> = {
  'package-lock.json': 'npm', 'pnpm-lock.yaml': 'pnpm', 'yarn.lock': 'yarn',
  'bun.lock': 'bun', 'poetry.lock': 'poetry', 'uv.lock': 'uv',
};
const unique = <T extends string>(items: readonly T[]): T[] => [...new Set(items)].sort(compare);

export function buildInventory(snapshot: RepositorySnapshot, git: GitMetadata, workspaceName: string, projectId: string, generatedAt: string): Inventory {
  const reasons = new Set<TruncationReason>(snapshot.reasons);
  const files = [...new Map(snapshot.files.filter((file) => !ignoredRepositoryPath(file.relativePath)).map((file) => [file.relativePath, file])).values()].sort((a, b) => compare(a.relativePath, b.relativePath));
  if (files.length > snapshot.limits.maxFiles) reasons.add('MAX_FILE_COUNT');
  const considered = files.slice(0, snapshot.limits.maxFiles);
  const allManifests = considered.filter((file) => manifestType(file.relativePath));
  if (allManifests.length > snapshot.limits.maxManifests) reasons.add('MAX_MANIFEST_COUNT');
  const selectedManifests = allManifests.sort((a, b) => Number(a.relativePath.includes('/')) - Number(b.relativePath.includes('/')) || compare(a.relativePath, b.relativePath)).slice(0, snapshot.limits.maxManifests);
  const signals = new Map<string, ManifestSignals>();
  const manifests: Inventory['manifests'][number][] = selectedManifests.map((file) => {
    const metadata = snapshot.metadata.get(file.relativePath);
    if (metadata) {
      try { signals.set(file.relativePath, manifestSignals(file.relativePath, metadata.text)); } catch { reasons.add('INVALID_METADATA'); }
    }
    return { relativePath: file.relativePath, type: manifestType(file.relativePath) ?? 'TOOL_CONFIG', contentHash: metadata?.contentHash ?? null };
  });
  const packageManifests = selectedManifests.filter((file) => isPackageManifest(file.relativePath));
  if (packageManifests.length > snapshot.limits.maxPackages) reasons.add('MAX_PACKAGE_COUNT');
  const packages: Inventory['packages'][number][] = packageManifests.slice(0, snapshot.limits.maxPackages).map(({ relativePath: path }) => {
    const root = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '.';
    const data = signals.get(path);
    return { id: `PKG-${createHash('sha256').update(path).digest('hex').slice(0, 16)}`, name: data?.name ?? (root === '.' ? workspaceName : root.split('/').pop() ?? root), relativePath: root, kind: data?.kind ?? 'UNKNOWN', manifestPath: path };
  });
  const repositoryEvidence: Evidence[] = [];
  for (const file of selectedManifests) {
    if (['pnpm-workspace.yaml', 'turbo.json', 'nx.json'].includes(file.relativePath)) repositoryEvidence.push({ relativePath: file.relativePath, signal: 'root workspace configuration' });
    if (signals.get(file.relativePath)?.workspace) repositoryEvidence.push({ relativePath: file.relativePath, signal: 'workspace declaration' });
  }
  const structuredPackages = packages.filter((item) => /^(apps|packages|services)\/[^/]+$/.test(item.relativePath));
  if (structuredPackages.length >= 2) for (const item of structuredPackages) repositoryEvidence.push({ relativePath: item.manifestPath, signal: 'package under conventional apps/packages/services structure' });
  const packageManagerEvidence: Evidence[] = [];
  const managers: Inventory['tooling']['packageManager']['name'][] = [];
  for (const file of selectedManifests) {
    const lock = LOCKFILE_MANAGERS[file.relativePath.split('/').pop() ?? ''];
    const declared = signals.get(file.relativePath)?.packageManager;
    if (lock) { managers.push(lock); packageManagerEvidence.push({ relativePath: file.relativePath, signal: `lockfile ${lock}` }); }
    if (declared) { managers.push(declared); packageManagerEvidence.push({ relativePath: file.relativePath, signal: `packageManager ${declared}` }); }
  }
  const distinctManagers = unique(managers);
  const frameworks: Inventory['frameworks'][number][] = unique([...signals.values()].flatMap((signal) => signal.frameworks)).map((framework) => ({
    name: framework, evidence: [...signals.entries()].filter(([, signal]) => signal.frameworks.includes(framework)).map(([path, signal]) => ({ relativePath: path, signal: signal.evidence.filter((e) => e.signal.startsWith('dependency') || e.signal.includes('declaration') || e.signal.includes('coordinate')).map((e) => e.signal).join('; ') })),
  }));
  const testing = [...signals.values()].flatMap((signal) => signal.testing);
  const buildTools = [...signals.values()].flatMap((signal) => signal.buildTools);
  for (const file of selectedManifests) {
    if (/(^|\/)vitest\.config\./.test(file.relativePath)) testing.push('Vitest');
    if (/(^|\/)jest\.config\./.test(file.relativePath)) testing.push('Jest');
    if (/(^|\/)pytest\.ini$/.test(file.relativePath)) testing.push('Pytest');
    if (manifestType(file.relativePath) === 'TYPESCRIPT_CONFIG') buildTools.push('TypeScript');
    if (file.relativePath === 'turbo.json') buildTools.push('Turbo');
    if (file.relativePath === 'nx.json') buildTools.push('Nx');
  }
  const important = considered.flatMap((file) => { const reason = importantReason(file.relativePath); return reason ? [{ relativePath: file.relativePath, ...reason }] : []; }).sort((a, b) => b.score - a.score || compare(a.relativePath, b.relativePath));
  if (important.length > snapshot.limits.maxImportantFiles) reasons.add('MAX_IMPORTANT_FILES');
  const counts = new Map<NonNullable<ReturnType<typeof language>>, number>();
  for (const file of considered) { const name = language(file.relativePath); if (name) counts.set(name, (counts.get(name) ?? 0) + 1); }
  // No timestamp, Git dirty flag, absolute location or ordinary source contents enter this fingerprint.
  const repositoryFingerprint = createHash('sha256').update(JSON.stringify({ version: 1, files: considered.map((file) => [file.relativePath, file.sizeBytes]), manifests, limits: snapshot.limits, reasons: unique([...reasons]), head: git.available ? git.headCommit : null })).digest('hex');
  return {
    schemaVersion: 1, generated: { generatedAt, projectId, repositoryFingerprint },
    repository: { workspaceName, type: repositoryEvidence.length ? 'MONOREPO' : packages.length === 1 ? 'SINGLE_PACKAGE' : 'UNKNOWN', evidence: repositoryEvidence },
    languages: [...counts].sort(([a], [b]) => compare(a, b)).map(([name, fileCount]) => ({ name, fileCount })), manifests, packages, frameworks,
    testing: { frameworks: unique(testing), testFileCount: considered.filter((file) => isTestFile(file.relativePath)).length },
    tooling: { packageManager: { name: distinctManagers.length === 1 ? distinctManagers[0] ?? 'UNKNOWN' : 'UNKNOWN', conflict: distinctManagers.length > 1, evidence: packageManagerEvidence }, buildTools: unique(buildTools) },
    git, importantFiles: important.slice(0, snapshot.limits.maxImportantFiles).map(({ relativePath, reason }) => ({ relativePath, reason })),
    statistics: { discoveredFiles: snapshot.discoveredFiles, consideredFiles: considered.length, ignoredFiles: snapshot.ignoredFiles + snapshot.files.length - considered.length },
    scan: { truncated: reasons.size > 0, truncationReasons: unique([...reasons]), limits: snapshot.limits },
  };
}
