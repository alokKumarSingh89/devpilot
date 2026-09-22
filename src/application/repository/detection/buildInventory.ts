import { projectStructure } from './projectStructure';
import { LANGUAGE_CATALOG, FRAMEWORK_CATALOG } from '../../../domain/repository/technology';
import { detectTechnologies } from './detectTechnologies';
import { packageManagers } from './packageManagers';
import { createHash } from 'node:crypto';
import type { Inventory, GitMetadata, TruncationReason } from '../../../domain/repository/inventory';
import { ignoredRepositoryPath } from '../../../domain/repository/repositoryPaths';
import type { RepositorySnapshot } from '../ports';
import { importantReason, isPackageManifest, isTestFile, language, manifestType } from './fileSignals';
import { manifestSignals, type ManifestSignals } from './manifestSignals';
const compare = (a: string, b: string): number => a < b ? -1 : a > b ? 1 : 0;
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
  const technologies = detectTechnologies(manifests.map((manifest) => {
    const text = snapshot.metadata.get(manifest.relativePath)?.text;
    return { path: manifest.relativePath, type: manifest.type, ...(text !== undefined ? { text } : {}) };
  }), () => reasons.add('INVALID_METADATA'));
  const packageManifests = selectedManifests.filter((file) => isPackageManifest(file.relativePath));
  if (packageManifests.length > snapshot.limits.maxPackages) reasons.add('MAX_PACKAGE_COUNT');
  const packages: Inventory['packages'][number][] = packageManifests.slice(0, snapshot.limits.maxPackages).map(({ relativePath: path }) => {
    const root = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '.';
    const data = signals.get(path);
    const detected = technologies.filter((item) => item.kind === 'FRAMEWORK' && item.evidence.some((ref) => ref.relativePath === path));
    const inferredKind = detected.some((item) => ['FRONTEND', 'FULL_STACK', 'MOBILE', 'EXTENSION'].includes(FRAMEWORK_CATALOG.find((definition) => definition.id === item.id)?.category ?? '')) ? 'APPLICATION'
      : detected.length ? 'SERVICE' : data?.kind ?? 'UNKNOWN';
    return { id: `PKG-${createHash('sha256').update(path).digest('hex').slice(0, 16)}`, name: data?.name ?? (root === '.' ? workspaceName : root.split('/').pop() ?? root), relativePath: root, kind: inferredKind, manifestPath: path };
  });
  const frameworks: Inventory['frameworks'][number][] = technologies.filter((item) => item.kind === 'FRAMEWORK').map((item) => ({
    id: item.id, category: FRAMEWORK_CATALOG.find((definition) => definition.id === item.id)?.category ?? 'BACKEND',
    name: item.name as Inventory['frameworks'][number]['name'],
    evidence: item.evidence.map((ref) => ({ relativePath: ref.relativePath, signal: `${ref.type === 'DEPENDENCY' ? 'dependency' : 'declaration'} ${ref.value}` })),
  })).sort((a, b) => compare(a.name, b.name));
  const testing: Inventory['testing']['frameworks'][number][] = [];
  testing.push(...technologies.filter((item) => item.kind === 'TEST_FRAMEWORK').map((item) => item.name as Inventory['testing']['frameworks'][number]));
  const buildTools: Inventory['tooling']['buildTools'][number][] = [];
  buildTools.push(...technologies.filter((item) => item.kind === 'BUILD_TOOL').map((item) => item.name as Inventory['tooling']['buildTools'][number]));
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
  const repositoryFingerprint = createHash('sha256').update(JSON.stringify({ version: 2, files: considered.map((file) => [file.relativePath, file.sizeBytes]), manifests, limits: snapshot.limits, reasons: unique([...reasons]), head: git.available ? git.headCommit : null })).digest('hex');
  return {
    schemaVersion: 1, generated: { generatedAt, projectId, repositoryFingerprint },
    repository: { workspaceName, ...projectStructure(manifests, packages, signals) },
    languages: [...counts].sort(([a], [b]) => compare(a, b)).map(([name, fileCount]) => ({ id: LANGUAGE_CATALOG.find((item) => item.name === name)?.id ?? name.toLowerCase(), name, fileCount })), manifests, packages, frameworks,
    testing: { frameworks: unique(testing), testFileCount: considered.filter((file) => isTestFile(file.relativePath)).length },
    tooling: { ...packageManagers(technologies), buildTools: unique(buildTools) },
    technologies,
    git, importantFiles: important.slice(0, snapshot.limits.maxImportantFiles).map(({ relativePath, reason }) => ({ relativePath, reason })),
    statistics: { discoveredFiles: snapshot.discoveredFiles, consideredFiles: considered.length, ignoredFiles: snapshot.ignoredFiles + snapshot.files.length - considered.length },
    scan: { truncated: reasons.size > 0, truncationReasons: unique([...reasons]), limits: snapshot.limits },
  };
}
