import { describe, expect, it } from 'vitest';
import { buildInventory } from '../src/application/repository/detection/buildInventory';
import { manifestType, isTestFile } from '../src/application/repository/detection/fileSignals';
import { manifestSignals } from '../src/application/repository/detection/manifestSignals';
import { ignoredRepositoryPath, REPOSITORY_EXCLUSIONS } from '../src/domain/repository/repositoryPaths';
import { DEFAULT_SCAN_LIMITS } from '../src/domain/repository/inventory';
import { validateInventory } from '../src/domain/repository/validateInventory';
import { inventoryFixture, repositoryFixture, repositorySnapshot } from './repositoryFixture';
import { projectFixture } from './projectFixture';
const build = (files: Record<string, string>) => buildInventory(repositorySnapshot(files), { available: false }, 'test', projectFixture().project.id, '2026-09-21T12:00:00.000Z');

describe('deterministic repository facts', () => {
  it.each(REPOSITORY_EXCLUSIONS)('ignores %s including nested occurrences', (directory) => {
    expect(ignoredRepositoryPath(`apps/a/${directory}/main.ts`)).toBe(true);
    expect(build({ [`${directory}/package.json`]: '{"dependencies":{"react":"1"}}' }).packages).toEqual([]);
  });
  it.each(['.env', '.env.local', 'private.pem', 'tls.key', 'id_rsa', 'id_ed25519'])('ignores secret-sensitive %s entirely', (path) => {
    const inventory = build({ [path]: 'SECRET_SENTINEL' });
    expect(inventory.statistics.consideredFiles).toBe(0);
    expect(JSON.stringify(inventory)).not.toContain('SECRET_SENTINEL');
    expect(inventory.importantFiles).toEqual([]);
  });
  it('detects six languages and deterministic counts independent of input order', () => {
    const files = { 'src/main.ts': '', 'src/App.tsx': '', 'script.cjs': '', 'app.py': '', 'Main.java': '', 'main.go': '', 'src/main.rs': '' };
    const first = build(files); const second = build(Object.fromEntries(Object.entries(files).reverse()));
    expect(first).toEqual(second);
    expect(first.languages).toEqual([{ name: 'Go', fileCount: 1 }, { name: 'Java', fileCount: 1 }, { name: 'JavaScript', fileCount: 1 }, { name: 'Python', fileCount: 1 }, { name: 'Rust', fileCount: 1 }, { name: 'TypeScript', fileCount: 2 }]);
  });
  it.each([['package.json', 'NPM_PACKAGE'], ['pyproject.toml', 'PYTHON_PROJECT'], ['Dockerfile', 'DOCKER'], ['.github/workflows/build.yaml', 'CI_WORKFLOW'], ['go.mod', 'GO_MODULE'], ['Cargo.toml', 'RUST_PACKAGE'], ['build.gradle.kts', 'GRADLE']])('recognizes %s', (path, type) => expect(manifestType(path)).toBe(type));
  it.each([['package-lock.json', 'npm'], ['pnpm-lock.yaml', 'pnpm'], ['yarn.lock', 'yarn']])('detects package manager from %s', (path, manager) => expect(build({ [path]: '' }).tooling.packageManager.name).toBe(manager));
  it('represents conflicting lockfiles and declarations explicitly', () => {
    const result = build({ 'package.json': '{"packageManager":"yarn@1"}', 'package-lock.json': '{}', 'pnpm-lock.yaml': '' });
    expect(result.tooling.packageManager).toMatchObject({ name: 'UNKNOWN', conflict: true });
    expect(result.tooling.packageManager.evidence).toHaveLength(3);
  });
  it.each(['workspaces', 'pnpm'])('detects monorepo using %s signals', (kind) => {
    expect(build(kind === 'workspaces' ? { 'package.json': '{"workspaces":["packages/*"]}' } : { 'pnpm-workspace.yaml': 'packages: [packages/*]' }).repository.type).toBe('MONOREPO');
  });
  it('does not infer monorepo from arbitrary nested example packages', () => {
    expect(build({ 'package.json': '{}', 'examples/tutorial/package.json': '{}' }).repository.type).toBe('UNKNOWN');
    expect(build({ 'package.json': '{}' }).repository.type).toBe('SINGLE_PACKAGE');
  });
  it('discovers NestJS, TypeScript tooling and test counts without copying scripts or contents', () => {
    const result = build(repositoryFixture('nestjs'));
    expect(validateInventory(result)).toEqual(result);
    expect(result.frameworks).toContainEqual(expect.objectContaining({ name: 'NestJS', evidence: [expect.objectContaining({ relativePath: 'package.json', signal: expect.stringContaining('@nestjs/core') })] }));
    expect(result.testing).toEqual({ frameworks: ['Vitest'], testFileCount: 2 });
    expect(result.tooling.buildTools).toEqual(['TypeScript', 'esbuild']);
    expect(result.packages[0]).toMatchObject({ name: 'tiny-api', kind: 'SERVICE', relativePath: '.' });
    expect(JSON.stringify(result)).not.toContain('NEVER_EXECUTE_THIS');
  });
  it('recognizes React in a monorepo and emits portable package paths', () => {
    const result = build(repositoryFixture('monorepo'));
    expect(result.repository.type).toBe('MONOREPO'); expect(result.packages).toHaveLength(3);
    expect(result.frameworks.map((item) => item.name)).toEqual(['Next.js', 'React']);
    expect(result.packages.map((item) => item.relativePath)).toEqual(['.', 'apps/web', 'packages/utils']);
    expect(validateInventory(result)).toEqual(result);
  });
  it('recognizes FastAPI/Pytest from dependencies, not arbitrary comments or folders', () => {
    const result = build(repositoryFixture('fastapi'));
    expect(result.frameworks[0]).toMatchObject({ name: 'FastAPI', evidence: [expect.objectContaining({ signal: expect.stringContaining('dependency fastapi') })] });
    expect(result.testing).toEqual({ frameworks: ['Pytest'], testFileCount: 2 });
    expect(manifestSignals('pyproject.toml', '# fastapi\n[project]\ndescription="fastapi"').frameworks).toEqual([]);
    expect(build({ 'react/main.ts': '' }).frameworks).toEqual([]);
  });
  it('recognizes Maven Spring/JUnit and Rust/Go package metadata without executing configurations', () => {
    expect(manifestSignals('pom.xml', '<dependency><groupId>org.springframework.boot</groupId></dependency><dependency><groupId>org.junit.jupiter</groupId></dependency>')).toMatchObject({ frameworks: ['Spring Boot'], testing: ['JUnit'] });
    expect(manifestSignals('Cargo.toml', '[package]\nname = "tiny"\nversion="1"\n').name).toBe('tiny');
    expect(manifestSignals('go.mod', 'module example.org/tiny\n').name).toBe('example.org/tiny');
  });
  it.each(['a.spec.ts', 'a.test.ts', 'a.test.tsx', 'test_api.py', 'api_test.py', 'api_test.go', 'ApiTest.java'])('detects test candidate %s', (path) => expect(isTestFile(path)).toBe(true));
  it('marks malformed manifests incomplete without persisting raw error content', () => {
    const result = build({ 'package.json': '{PRIVATE_INVALID_JSON' });
    expect(result.scan.truncationReasons).toContain('INVALID_METADATA');
    expect(JSON.stringify(result)).not.toContain('PRIVATE_INVALID');
  });
  it('caps files, packages, manifests, and important files and reports truncation', () => {
    const result = buildInventory(repositorySnapshot(repositoryFixture('monorepo'), { ...DEFAULT_SCAN_LIMITS, maxFiles: 6, maxManifests: 3, maxPackages: 1, maxImportantFiles: 1 }), { available: false }, 'test', projectFixture().project.id, '2026-09-21T12:00:00.000Z');
    expect(result.scan.truncated).toBe(true); expect(result.scan.truncationReasons).toContain('MAX_FILE_COUNT');
    expect(result.importantFiles).toHaveLength(1); expect(result.packages.length).toBeLessThanOrEqual(1); expect(result.manifests.length).toBeLessThanOrEqual(3);
    expect(validateInventory(result)).toEqual(result);
  });
  it('fingerprint ignores timestamp and Git dirty state but changes for structure, size, manifest contents and HEAD', () => {
    const snapshot = repositorySnapshot(repositoryFixture('nestjs')); const id = projectFixture().project.id;
    const a = buildInventory(snapshot, { available: true, branch: 'main', headCommit: 'a'.repeat(40), dirty: false }, 'test', id, '2026-09-21T12:00:00.000Z');
    const b = buildInventory(snapshot, { available: true, branch: 'other', headCommit: 'a'.repeat(40), dirty: true }, 'test', id, '2026-09-21T13:00:00.000Z');
    expect(a.generated.repositoryFingerprint).toBe(b.generated.repositoryFingerprint);
    expect(build({ ...repositoryFixture('nestjs'), 'src/route.ts': '' }).generated.repositoryFingerprint).not.toBe(inventoryFixture().generated.repositoryFingerprint);
    expect(build({ ...repositoryFixture('nestjs'), 'tsconfig.json': '{"compilerOptions":{"strict":null}}' }).generated.repositoryFingerprint).not.toBe(inventoryFixture().generated.repositoryFingerprint);
    expect(buildInventory(snapshot, { available: true, branch: 'main', headCommit: 'b'.repeat(40), dirty: false }, 'test', id, a.generated.generatedAt).generated.repositoryFingerprint).not.toBe(a.generated.repositoryFingerprint);
  });
});

describe('inventory runtime validation', () => {
  it.each(['/tmp/package.json', '../package.json', 'docs/../package.json', 'C:\\package.json', '.env'])('rejects unsafe persisted path %s', (relativePath) => {
    const value = inventoryFixture(); expect(() => validateInventory({ ...value, manifests: [{ ...value.manifests[0], relativePath }] })).toThrow();
  });
  it('rejects invalid versions/enums/hashes/statistics, unknown fields, and duplicate references', () => {
    const value = inventoryFixture();
    for (const invalid of [ { ...value, schemaVersion: 2 }, { ...value, token: 'secret' }, { ...value, repository: { ...value.repository, type: 'SMART' } }, { ...value, generated: { ...value.generated, repositoryFingerprint: 'bad' } }, { ...value, languages: [...value.languages, ...value.languages] }, { ...value, statistics: { ...value.statistics, consideredFiles: 9000 } }, { ...value, frameworks: [{ name: 'React', evidence: [{ relativePath: 'missing.json', signal: 'dependency' }] }] } ]) expect(() => validateInventory(invalid)).toThrow();
  });
});
