import { describe, expect, it, vi } from 'vitest';
import { rankDocuments } from '../src/application/documents/rankDocuments';
import { PrdStateService } from '../src/application/documents/PrdStateService';
import { PrdImportService } from '../src/application/documents/PrdImportService';
import { DocumentFailure } from '../src/domain/DocumentFailure';
import { validateProjectManifest } from '../src/domain/validateProjectManifest';
import { projectFixture } from './projectFixture';

const workspace = { key: 'file:///repo', name: 'repo', folderName: 'repo' };
const input = { relativePath: 'docs/PRD.md', format: 'markdown' as const, sizeBytes: 12, importedAt: '2026-09-21T11:00:00.000Z', contentHash: 'a'.repeat(64) };
const document = { ...input, text: 'private requirements' };

describe('deterministic document ranking', () => {
  it('prefers exact PRD and requirements over unrelated Markdown, omitting README fallback', () => {
    const results = rankDocuments(['notes.md', 'README.md', 'docs/requirements.md', 'PRD.md']);
    expect(results.map((item) => item.relativePath)).toEqual(['PRD.md', 'docs/requirements.md', 'notes.md']);
    expect(results[0]?.reasons.length).toBeGreaterThan(0);
  });
  it('recognizes normalized product requirements and spec filenames', () => {
    const results = rankDocuments(['notes.md', 'PRODUCT_REQUIREMENTS.md', 'product-spec.md', 'functional-requirements.md']);
    expect(results.at(-1)?.relativePath).toBe('notes.md');
    expect(results[0]?.relativePath).toBe('PRODUCT_REQUIREMENTS.md');
  });
  it('offers README only as an explicit low-confidence fallback', () => {
    expect(rankDocuments(['README.md'])[0]?.score).toBeLessThan(200);
  });
  it('filters generated, unsupported, absolute and traversal paths', () => {
    expect(rankDocuments(['node_modules/PRD.md', '.devpilot/spec.md', 'dist/spec.md', 'build/prd.txt', '../PRD.md', '/PRD.md', 'spec.pdf', 'docs/PRD.md']).map((item) => item.relativePath)).toEqual(['docs/PRD.md']);
  });
  it('has deterministic ties and removes duplicate paths', () => {
    const paths = ['b/spec.md', 'a/spec.md', 'PRD.md'];
    expect(rankDocuments([...paths].reverse())).toEqual(rankDocuments([...paths, 'PRD.md']));
  });
  it('caps candidate results', () => {
    expect(rankDocuments(Array.from({ length: 600 }, (_, i) => `docs/spec-${i}.md`))).toHaveLength(50);
  });
});

describe('optional V1 PRD metadata', () => {
  it('accepts legacy and valid metadata without changing schema', () => {
    expect(validateProjectManifest(projectFixture())).toEqual(projectFixture());
    expect(validateProjectManifest({ ...projectFixture(), inputs: { prd: input } }).inputs?.prd).toEqual(input);
  });
  it.each([
    ['contentHash', 'xyz'], ['contentHash', 'A'.repeat(64)], ['relativePath', '/Users/person/PRD.md'],
    ['relativePath', '../../PRD.md'], ['relativePath', 'docs/../PRD.md'], ['relativePath', 'docs\\PRD.md'],
    ['format', 'pdf'], ['sizeBytes', 0], ['sizeBytes', 1.2], ['importedAt', 'yesterday'],
  ])('rejects malformed metadata %s=%s', (key, value) => {
    expect(() => validateProjectManifest({ ...projectFixture(), inputs: { prd: { ...input, [key]: value } } })).toThrow();
  });
});

describe('PRD state independent from project lifecycle', () => {
  it('does not read when not selected', async () => {
    const read = vi.fn();
    expect(await new PrdStateService({ read }).evaluate(workspace)).toEqual({ status: 'NOT_SELECTED' });
    expect(read).not.toHaveBeenCalled();
  });
  it.each([['a'.repeat(64), 'SELECTED'], ['b'.repeat(64), 'CHANGED']])('compares content hash %s', async (contentHash, status) => {
    const service = new PrdStateService({ read: vi.fn().mockResolvedValue({ ...document, contentHash }) });
    expect(await service.evaluate(workspace, input)).toEqual({ status, input });
  });
  it('distinguishes missing documents from access failures and hides provider detail', async () => {
    const read = vi.fn().mockRejectedValue(new DocumentFailure('MISSING'));
    const service = new PrdStateService({ read });
    expect((await service.evaluate(workspace, input)).status).toBe('MISSING');
    read.mockRejectedValue(new Error('private stack and path'));
    const state = await service.evaluate(workspace, input);
    expect(state.status).toBe('ERROR');
    expect(JSON.stringify(state)).not.toContain('private stack');
  });
});

function importer() {
  const manifest = projectFixture();
  const context = { current: vi.fn(() => workspace), isTrusted: () => true };
  const storage = { read: vi.fn().mockResolvedValue(manifest), update: vi.fn().mockResolvedValue(undefined) };
  const discovery = { discover: vi.fn().mockResolvedValue({ candidates: [], limited: false }) };
  const reader = { read: vi.fn().mockResolvedValue(document) };
  const service = new PrdImportService(context, storage, discovery, reader, () => new Date(input.importedAt));
  return { service, manifest, context, storage, reader };
}

describe('explicit PRD import', () => {
  it('discovery does not import; import persists metadata only and remains INITIALIZING', async () => {
    const { service, manifest, storage, reader } = importer();
    await service.discover();
    expect(reader.read).not.toHaveBeenCalled();
    expect(storage.update).not.toHaveBeenCalled();
    await service.import(workspace, manifest, input.relativePath);
    const saved = storage.update.mock.calls[0]?.[2];
    expect(saved.inputs.prd).toEqual(input);
    expect(saved.project.status).toBe('INITIALIZING');
    expect(saved.project.id).toBe(manifest.project.id);
    expect(JSON.stringify(saved)).not.toContain(document.text);
    expect(JSON.stringify(saved)).not.toContain('file:///');
  });
  it.each(['CODEBASE', 'READY'])('rejects disallowed project condition %s', async (condition) => {
    const { service, storage, manifest, reader } = importer();
    storage.read.mockResolvedValue({ ...manifest, project: { ...manifest.project, ...(condition === 'CODEBASE' ? { source: condition } : { status: condition }) } });
    await expect(service.import(workspace, manifest, input.relativePath)).rejects.toMatchObject({ code: 'SOURCE_NOT_ALLOWED' });
    expect(reader.read).not.toHaveBeenCalled();
    expect(storage.update).not.toHaveBeenCalled();
  });
  it('rejects a stale picker snapshot', async () => {
    const { service, storage, manifest } = importer();
    storage.read.mockResolvedValue({ ...manifest, project: { ...manifest.project, name: 'Changed elsewhere' } });
    await expect(service.import(workspace, manifest, input.relativePath)).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(storage.update).not.toHaveBeenCalled();
  });
  it('rejects root changes while reading and leaves the manifest intact', async () => {
    const { service, storage, manifest, context, reader } = importer();
    reader.read.mockImplementation(async () => { context.current.mockReturnValue({ ...workspace, key: 'file:///other' }); return document; });
    await expect(service.import(workspace, manifest, input.relativePath)).rejects.toMatchObject({ code: 'WORKSPACE_CHANGED' });
    expect(storage.update).not.toHaveBeenCalled();
  });
  it('read failure leaves existing metadata intact and releases the import guard', async () => {
    const { service, storage, manifest, reader } = importer();
    reader.read.mockRejectedValueOnce(new DocumentFailure('EMPTY'));
    await expect(service.import(workspace, manifest, input.relativePath)).rejects.toMatchObject({ code: 'EMPTY' });
    expect(storage.update).not.toHaveBeenCalled();
    await service.import(workspace, manifest, input.relativePath);
    expect(storage.update).toHaveBeenCalledOnce();
  });
});

import { renderProject } from '../src/presentation/controlCenter/renderProject';
import { ProjectService } from '../src/application/projects/ProjectService';
import { parseProjectYaml, serializeProjectYaml } from '../src/infrastructure/projects/projectYaml';

it('escapes untrusted PRD display paths and exposes corrective actions without enabling CODEBASE import', () => {
  const manifest = { ...projectFixture(), inputs: { prd: { ...input, relativePath: 'docs/<script>.md' } } };
  const html = renderProject({ status: 'INITIALIZING', manifest, prd: { status: 'CHANGED', input: manifest.inputs.prd } });
  expect(html).toContain('&lt;script&gt;.md'); expect(html).not.toContain('<script>');
  expect(html).toContain('Re-import PRD'); expect(html).toContain('Initializing');
  const codebase = { ...projectFixture(), project: { ...projectFixture().project, source: 'CODEBASE' as const } };
  expect(renderProject({ status: 'INITIALIZING', manifest: codebase })).not.toContain('command:devpilot.selectPrd');
  expect(renderProject({ status: 'INITIALIZING', manifest, prd: { status: 'MISSING', input } })).toContain('Select PRD');
});

it('restores persisted metadata and reevaluates changes and deletion through project refresh', async () => {
  const persisted = serializeProjectYaml({ ...projectFixture(), inputs: { prd: input } });
  const read = vi.fn().mockResolvedValue(document);
  const projects = new ProjectService(
    { current: () => workspace, isTrusted: () => true },
    { state: { status: 'NO_MODEL', models: [] }, requireReady: vi.fn() },
    { read: async () => parseProjectYaml(persisted), write: vi.fn(), exists: async () => true },
    () => projectFixture().project.id, () => new Date(input.importedAt), new PrdStateService({ read }),
  );
  await projects.refresh(); expect(projects.state).toMatchObject({ status: 'INITIALIZING', prd: { status: 'SELECTED', input } });
  read.mockResolvedValue({ ...document, contentHash: 'b'.repeat(64) });
  await projects.refresh(); expect(projects.state).toMatchObject({ status: 'INITIALIZING', prd: { status: 'CHANGED' } });
  read.mockRejectedValue(new DocumentFailure('MISSING'));
  await projects.refresh(); expect(projects.state).toMatchObject({ status: 'INITIALIZING', prd: { status: 'MISSING' } });
  projects.dispose();
});
