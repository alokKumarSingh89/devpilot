import { describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { ProjectService } from '../src/application/projects/ProjectService';
import type { ProjectWorkspace } from '../src/application/projects/ports';
import type { ProjectManifest } from '../src/domain/project';
import type { ModelState } from '../src/domain/reasoningModel';
import { ModelFailure } from '../src/application/models/ModelFailure';
import { ProjectFailure } from '../src/domain/ProjectFailure';
import { renderProject } from '../src/presentation/controlCenter/renderProject';
import { projectFixture } from './projectFixture';

const selected = { ...projectFixture().ai.reasoningModel, name: 'Reasoner' };
function setup() {
  let current: ProjectWorkspace | undefined = { key: 'remote://host/project', name: 'my workspace', folderName: 'root' };
  let manifest: ProjectManifest | undefined;
  const workspace = { current: () => current, isTrusted: vi.fn(() => true) };
  const models = {
    state: { status: 'READY', models: [selected], selected } as ModelState,
    requireReady: vi.fn(async () => {
      if (models.state.status !== 'READY') throw new ModelFailure(models.state.status);
      return models.state;
    }),
  };
  const storage = {
    exists: vi.fn(async () => manifest !== undefined), read: vi.fn(async () => manifest),
    write: vi.fn(async (_workspace: ProjectWorkspace, value: ProjectManifest) => { manifest = value; }),
  };
  return {
    service: new ProjectService(workspace, models, storage, randomUUID, () => new Date('2026-09-21T10:00:00.000Z')),
    storage, workspace, models,
    changeWorkspace: (value: ProjectWorkspace | undefined) => { current = value; },
    setManifest: (value: ProjectManifest | undefined) => { manifest = value; },
  };
}

describe('project initialization application rules', () => {
  it('rejects no workspace before touching storage or models', async () => {
    const ctx = setup(); ctx.changeWorkspace(undefined);
    await expect(ctx.service.initialize('PRD')).rejects.toMatchObject({ code: 'NO_WORKSPACE' });
    expect(ctx.storage.write).not.toHaveBeenCalled();
    expect(ctx.models.requireReady).not.toHaveBeenCalled();
  });
  it.each(['NO_MODEL', 'SELECTION_REQUIRED'] as const)('rejects AI %s', async (status) => {
    const ctx = setup(); ctx.models.state = { status, models: [] };
    await expect(ctx.service.initialize('CODEBASE')).rejects.toMatchObject({ code: status });
    expect(ctx.storage.write).not.toHaveBeenCalled();
  });
  it('revalidates a selected model that disappeared', async () => {
    const ctx = setup(); ctx.models.requireReady.mockRejectedValue(new ModelFailure('NOT_FOUND'));
    await expect(ctx.service.initialize('PRD')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(ctx.storage.write).not.toHaveBeenCalled();
  });
  it('rejects an existing valid project', async () => {
    const ctx = setup(); ctx.setManifest(projectFixture());
    await expect(ctx.service.initialize('PRD')).rejects.toMatchObject({ code: 'ALREADY_EXISTS' });
    expect(ctx.storage.write).not.toHaveBeenCalled();
  });
  it.each(['PRD', 'CODEBASE', 'PRD_AND_CODEBASE'] as const)('creates one portable INITIALIZING manifest for %s', async (source) => {
    const ctx = setup();
    const project = await ctx.service.initialize(source);
    expect(project).toEqual({
      ...projectFixture(), project: { ...projectFixture().project, id: expect.stringMatching(/^[a-f\d]{8}-[a-f\d]{4}-4[a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/), name: 'my workspace', source },
    });
    expect(ctx.storage.write).toHaveBeenCalledExactlyOnceWith(ctx.workspace.current(), project);
    expect(ctx.service.state.status).toBe('INITIALIZING');
    expect(JSON.stringify(project)).not.toContain('remote://');
    expect(renderProject(ctx.service.state)).not.toContain('No project initialized');
  });
  it('blocks writes in an untrusted workspace', async () => {
    const ctx = setup(); ctx.workspace.isTrusted.mockReturnValue(false);
    await expect(ctx.service.initialize('PRD')).rejects.toMatchObject({ code: 'UNTRUSTED' });
    expect(ctx.storage.write).not.toHaveBeenCalled();
  });
  it('does not publish initialization after a failed write', async () => {
    const ctx = setup(); ctx.storage.write.mockRejectedValue(new ProjectFailure('WRITE_FAILED'));
    await expect(ctx.service.initialize('PRD')).rejects.toMatchObject({ code: 'WRITE_FAILED' });
    await ctx.service.refresh();
    expect(ctx.service.state.status).toBe('NOT_INITIALIZED');
  });
  it('prevents concurrent duplicate writes', async () => {
    const ctx = setup();
    const first = ctx.service.initialize('PRD');
    await expect(ctx.service.initialize('CODEBASE')).rejects.toMatchObject({ code: 'BUSY' });
    await first;
    expect(ctx.storage.write).toHaveBeenCalledOnce();
  });
  it('rejects a workspace change while the source picker was open', async () => {
    const ctx = setup(); const original = await ctx.service.prepare();
    ctx.changeWorkspace({ ...original, key: 'remote://host/other' });
    await expect(ctx.service.initialize('PRD', original)).rejects.toMatchObject({ code: 'WORKSPACE_CHANGED' });
    expect(ctx.storage.write).not.toHaveBeenCalled();
  });
});

describe('project state', () => {
  it('resolves NO_WORKSPACE', async () => {
    const ctx = setup(); ctx.changeWorkspace(undefined); await ctx.service.refresh();
    expect(ctx.service.state.status).toBe('NO_WORKSPACE');
  });
  it.each(['NO_MODEL', 'SELECTION_REQUIRED'] as const)('keeps missing-project identity separate from model gate %s', async (status) => {
    const ctx = setup(); ctx.models.state = { status, models: [] }; await ctx.service.refresh();
    expect(ctx.service.state.status).toBe('NOT_INITIALIZED');
    expect(renderProject(ctx.service.state, undefined, false)).not.toContain('command:devpilot.initializeProject');
  });
  it('resolves NOT_INITIALIZED when the manifest is absent', async () => {
    const ctx = setup(); await ctx.service.refresh(); expect(ctx.service.state.status).toBe('NOT_INITIALIZED');
  });
  it.each(['INITIALIZING', 'READY'] as const)('restores %s from a valid manifest, even when AI is unselected', async (status) => {
    const ctx = setup(); const manifest = projectFixture();
    ctx.setManifest({ ...manifest, project: { ...manifest.project, status } });
    ctx.models.state = { status: 'SELECTION_REQUIRED', models: [selected] };
    await ctx.service.refresh(); expect(ctx.service.state.status).toBe(status);
    const html = renderProject(ctx.service.state);
    expect(html).toContain(status === 'READY' ? '>Ready<' : '>Initializing<');
    expect(html).not.toContain('command:devpilot.initializeProject');
  });
  it('shows safe errors and never treats a corrupt manifest as uninitialized', async () => {
    const ctx = setup(); ctx.storage.read.mockRejectedValue(new ProjectFailure('UNSUPPORTED_SCHEMA'));
    await ctx.service.refresh(); expect(ctx.service.state.status).toBe('ERROR');
    expect(renderProject(ctx.service.state)).toContain('unsupported manifest schema');
  });
  it('ignores late reads from a previous workspace and disposes listeners', async () => {
    const ctx = setup(); let finish: (value: ProjectManifest) => void = () => undefined;
    ctx.storage.read.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const pending = ctx.service.refresh();
    ctx.changeWorkspace(undefined); await ctx.service.refresh();
    finish(projectFixture()); await pending;
    expect(ctx.service.state.status).toBe('NO_WORKSPACE');
    const listener = vi.fn(); ctx.service.onDidChange(listener); ctx.service.dispose();
    await ctx.service.refresh(); expect(listener).not.toHaveBeenCalled();
  });
});

it('does not initialize over an existing malformed manifest', async () => {
  const ctx = setup();
  ctx.storage.exists.mockResolvedValue(true);
  ctx.storage.read.mockRejectedValue(new ProjectFailure('INVALID_MANIFEST'));
  await expect(ctx.service.initialize('PRD')).rejects.toMatchObject({ code: 'INVALID_MANIFEST' });
  expect(ctx.storage.write).not.toHaveBeenCalled();
});

it('sanitizes unexpected storage errors at the application boundary', async () => {
  const ctx = setup(); ctx.storage.write.mockRejectedValue(new Error('private stack'));
  await expect(ctx.service.initialize('PRD')).rejects.toMatchObject({ code: 'WRITE_FAILED' });
});

it('escapes loaded project names and displays the initializing lifecycle', () => {
  const manifest = projectFixture();
  const html = renderProject({ status: 'INITIALIZING', manifest: { ...manifest, project: { ...manifest.project, name: '<script>bad</script>' } } });
  expect(html).toContain('&lt;script&gt;bad&lt;/script&gt;');
  expect(html).not.toContain('<script>');
  expect(html).toContain('Initializing');
  expect(html).toContain('Project intelligence has not yet been generated');
});

it('external project deletion clears stale state without recreating metadata, and explicit initialization resumes', async () => {
  const ctx = setup(); ctx.setManifest(projectFixture()); await ctx.service.refresh();
  expect(ctx.service.state.status).toBe('INITIALIZING');
  ctx.setManifest(undefined); ctx.models.state = { status: 'NO_MODEL', models: [] };
  await ctx.service.refresh();
  expect(ctx.service.state).toEqual({ status: 'NOT_INITIALIZED' });
  expect(ctx.storage.write).not.toHaveBeenCalled();
  ctx.models.state = { status: 'READY', models: [selected], selected };
  await ctx.service.initialize('PRD');
  expect(ctx.service.state.status).toBe('INITIALIZING');
  expect(ctx.storage.write).toHaveBeenCalledOnce();
});
