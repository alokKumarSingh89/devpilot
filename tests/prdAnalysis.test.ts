import type { ModelState } from '../src/domain/reasoningModel';
import { describe, expect, it, vi } from 'vitest';
import { PrdAnalysisService } from '../src/application/analysis/PrdAnalysisService';
import { ModelFailure } from '../src/application/models/ModelFailure';
import { DocumentFailure } from '../src/domain/DocumentFailure';
import { AnalysisFailure } from '../src/domain/requirements/AnalysisFailure';
import type { RequirementsArtifact } from '../src/domain/requirements/requirements';
import type { ProjectManifest } from '../src/domain/project';
import type { ProjectWorkspace } from '../src/application/projects/ports';
import { renderAnalysis } from '../src/presentation/controlCenter/renderAnalysis';
import { analysisModel, importedPrd, prdText, requirementsArtifact, rawRequirementsContent } from './requirementsFixture';
import { projectFixture } from './projectFixture';

function token() {
  const listeners = new Set<() => void>();
  return { isCancellationRequested: false,
    onCancellationRequested: (listener: () => void) => { listeners.add(listener); return { dispose: () => { listeners.delete(listener); } }; },
    cancel() { this.isCancellationRequested = true; listeners.forEach((listener) => listener()); }, listeners,
  };
}
function setup() {
  const workspace = { key: 'file:///repo', name: 'repo', folderName: 'repo' };
  const context = { current: vi.fn<() => ProjectWorkspace | undefined>(() => workspace), isTrusted: vi.fn(() => true), needsSelection: vi.fn(() => false) };
  const manifest: ProjectManifest = { ...projectFixture(), inputs: { prd: importedPrd } };
  const projects = { read: vi.fn<() => Promise<ProjectManifest | undefined>>().mockResolvedValue(manifest) };
  const reader = { read: vi.fn().mockResolvedValue({ ...importedPrd, text: prdText }) };
  const models = { state: { status: 'READY', models: [analysisModel], selected: analysisModel } as ModelState, requireReady: vi.fn().mockResolvedValue({ status: 'READY' as const, models: [analysisModel], selected: analysisModel }) };
  const gateway = { sendRequest: vi.fn().mockResolvedValue(JSON.stringify(rawRequirementsContent())) };
  let saved: RequirementsArtifact | undefined;
  const storage = {
    read: vi.fn(async () => saved),
    write: vi.fn(async (_workspace: ProjectWorkspace, artifact: RequirementsArtifact, beforeCommit: () => Promise<void>) => { await beforeCommit(); saved = artifact; }),
  };
  const log = vi.fn();
  const service = new PrdAnalysisService(context, projects, reader, models, gateway, storage, () => new Date('2026-09-21T12:00:00.000Z'), log);
  return { service, log, workspace, context, manifest, projects, reader, models, gateway, storage, token: token(), saved: () => saved, setSaved: (value: RequirementsArtifact) => { saved = value; } };
}

describe('analysis application preconditions', () => {
  it('blocks no workspace or unselected multi-root before reading or sending', async () => {
    const ctx = setup(); ctx.context.current.mockReturnValue(undefined);
    await expect(ctx.service.analyze(ctx.token)).rejects.toMatchObject({ code: 'NO_WORKSPACE' });
    ctx.context.needsSelection.mockReturnValue(true);
    await expect(ctx.service.analyze(ctx.token)).rejects.toMatchObject({ code: 'WORKSPACE_SELECTION_REQUIRED' });
    expect(ctx.projects.read).not.toHaveBeenCalled(); expect(ctx.gateway.sendRequest).not.toHaveBeenCalled();
  });
  it('blocks untrusted workspaces', async () => {
    const ctx = setup(); ctx.context.isTrusted.mockReturnValue(false);
    await expect(ctx.service.analyze(ctx.token)).rejects.toMatchObject({ code: 'UNTRUSTED' });
    expect(ctx.gateway.sendRequest).not.toHaveBeenCalled();
  });
  it('blocks uninitialized projects', async () => {
    const ctx = setup(); ctx.projects.read.mockResolvedValue(undefined);
    await expect(ctx.service.analyze(ctx.token)).rejects.toMatchObject({ code: 'PROJECT_REQUIRED' });
    expect(ctx.gateway.sendRequest).not.toHaveBeenCalled();
  });
  it.each(['CODEBASE', 'READY'])('blocks unsupported source/lifecycle %s', async (condition) => {
    const ctx = setup();
    ctx.projects.read.mockResolvedValue({ ...ctx.manifest, project: { ...ctx.manifest.project, ...(condition === 'CODEBASE' ? { source: 'CODEBASE' as const } : { status: 'READY' as const }) } });
    await expect(ctx.service.analyze(ctx.token)).rejects.toMatchObject({ code: 'SOURCE_NOT_ALLOWED' });
    expect(ctx.gateway.sendRequest).not.toHaveBeenCalled();
  });
  it('blocks no selected PRD', async () => {
    const ctx = setup(); ctx.projects.read.mockResolvedValue(projectFixture());
    await expect(ctx.service.analyze(ctx.token)).rejects.toMatchObject({ code: 'NOT_SELECTED' });
    expect(ctx.gateway.sendRequest).not.toHaveBeenCalled();
  });
  it.each(['MISSING', 'EMPTY', 'TOO_LARGE', 'READ_FAILED'] as const)('blocks document failure %s', async (code) => {
    const ctx = setup(); ctx.reader.read.mockRejectedValue(new DocumentFailure(code));
    await expect(ctx.service.analyze(ctx.token)).rejects.toMatchObject({ code });
    expect(ctx.gateway.sendRequest).not.toHaveBeenCalled(); expect(ctx.storage.write).not.toHaveBeenCalled();
  });
  it('blocks an edited PRD until explicitly reimported', async () => {
    const ctx = setup(); ctx.reader.read.mockResolvedValue({ ...importedPrd, text: 'new contents', contentHash: 'b'.repeat(64) });
    await expect(ctx.service.analyze(ctx.token)).rejects.toMatchObject({ code: 'CHANGED' });
    expect(ctx.gateway.sendRequest).not.toHaveBeenCalled();
  });
  it.each(['NO_MODEL', 'SELECTION_REQUIRED', 'NOT_FOUND', 'ACCESS'] as const)('blocks model gate failure %s', async (code) => {
    const ctx = setup(); ctx.models.requireReady.mockRejectedValue(new ModelFailure(code));
    await expect(ctx.service.analyze(ctx.token)).rejects.toMatchObject({ code });
    expect(ctx.gateway.sendRequest).not.toHaveBeenCalled();
  });
});

describe('validated requirements pipeline', () => {
  it('sends through the gateway, canonicalizes output, persists trusted provenance and never updates project status', async () => {
    const ctx = setup(); await ctx.service.analyze(ctx.token);
    expect(ctx.gateway.sendRequest).toHaveBeenCalledWith(analysisModel.id, expect.stringContaining('UNTRUSTED_PRD_JSON'), expect.anything(), expect.objectContaining({ purpose: 'prdAnalysis', maxResponseCharacters: 262144, outputHeadroomTokens: 8192 }));
    expect(ctx.storage.write).toHaveBeenCalledOnce();
    expect(ctx.saved()?.generated).toEqual(requirementsArtifact().generated);
    expect(ctx.saved()?.functionalRequirements[0]?.id).not.toBe('FR-AUTH-001');
    expect(ctx.manifest.project.status).toBe('INITIALIZING');
    expect(ctx.saved()).not.toHaveProperty('project');
    expect(JSON.stringify(ctx.saved())).not.toContain('file:///repo');
    expect(ctx.token.listeners.size).toBe(0);
  });
  it.each(['not JSON', JSON.stringify({ product: { name: 'Opaque summary' } })])('invalid output never overwrites previous valid requirements', async (raw) => {
    const ctx = setup(); const old = requirementsArtifact(); ctx.setSaved(old); ctx.gateway.sendRequest.mockResolvedValue(raw);
    await expect(ctx.service.analyze(ctx.token)).rejects.toMatchObject({ code: 'INVALID_OUTPUT' });
    expect(ctx.storage.write).not.toHaveBeenCalled(); expect(ctx.saved()).toEqual(old);
    expect(await ctx.service.evaluate(ctx.workspace, ctx.manifest)).toMatchObject({ status: 'FAILED', artifact: old });
  });
  it('failure is retryable and a successful retry replaces the complete artifact', async () => {
    const ctx = setup(); ctx.gateway.sendRequest.mockRejectedValueOnce(new Error('private provider stack'));
    await expect(ctx.service.analyze(ctx.token)).rejects.toMatchObject({ code: 'PROVIDER' });
    expect(JSON.stringify(await ctx.service.evaluate(ctx.workspace, ctx.manifest))).not.toContain('private provider');
    await ctx.service.analyze(ctx.token);
    expect((await ctx.service.evaluate(ctx.workspace, ctx.manifest)).status).toBe('ANALYZED');
  });
  it('blocks source mutation while the model is responding', async () => {
    const ctx = setup(); ctx.setSaved(requirementsArtifact());
    ctx.gateway.sendRequest.mockImplementation(async () => {
      ctx.reader.read.mockResolvedValue({ ...importedPrd, text: 'edited', contentHash: 'b'.repeat(64) });
      return JSON.stringify(rawRequirementsContent());
    });
    await expect(ctx.service.analyze(ctx.token)).rejects.toMatchObject({ code: 'CHANGED' });
    expect(ctx.storage.write).not.toHaveBeenCalled(); expect(ctx.saved()).toEqual(requirementsArtifact());
  });
  it('rejects project/root changes and reimport while awaiting a response', async () => {
    for (const change of ['project', 'root', 'input']) {
      const ctx = setup(); ctx.gateway.sendRequest.mockImplementation(async () => {
        if (change === 'root') ctx.context.current.mockReturnValue({ ...ctx.workspace, key: 'file:///elsewhere' });
        else if (change === 'project') ctx.projects.read.mockResolvedValue({ ...ctx.manifest, project: { ...ctx.manifest.project, name: 'changed' } });
        else ctx.projects.read.mockResolvedValue({ ...ctx.manifest, inputs: { prd: { ...importedPrd, importedAt: '2026-09-21T13:00:00.000Z' } } });
        return JSON.stringify(rawRequirementsContent());
      });
      await expect(ctx.service.analyze(ctx.token)).rejects.toMatchObject({ code: 'CONFLICT' });
      expect(ctx.storage.write).not.toHaveBeenCalled();
    }
  });
  it('validates again at storage commit, preventing late source changes', async () => {
    const ctx = setup(); ctx.setSaved(requirementsArtifact());
    ctx.storage.write.mockImplementation(async (_root, _artifact, beforeCommit) => {
      ctx.reader.read.mockRejectedValue(new DocumentFailure('MISSING'));
      await beforeCommit();
    });
    await expect(ctx.service.analyze(ctx.token)).rejects.toMatchObject({ code: 'MISSING' });
    expect(ctx.saved()).toEqual(requirementsArtifact());
  });
});

describe('analysis state and control center', () => {
  it('loads NOT_ANALYZED, ANALYZED and STALE without invoking the model', async () => {
    const ctx = setup(); expect(await ctx.service.evaluate(ctx.workspace, ctx.manifest)).toEqual({ status: 'NOT_ANALYZED' });
    ctx.setSaved(requirementsArtifact());
    expect((await ctx.service.evaluate(ctx.workspace, ctx.manifest)).status).toBe('ANALYZED');
    expect((await ctx.service.evaluate(ctx.workspace, { ...ctx.manifest, inputs: { prd: { ...importedPrd, contentHash: 'b'.repeat(64) } } })).status).toBe('STALE');
    expect((await ctx.service.evaluate(ctx.workspace, projectFixture())).status).toBe('STALE');
    expect(ctx.gateway.sendRequest).not.toHaveBeenCalled();
  });
  it('treats an artifact for a different project as stale', async () => {
    const ctx = setup(); const artifact = requirementsArtifact(); ctx.setSaved({ ...artifact, generated: { ...artifact.generated, projectId: 'ba0d745e-2e08-45cc-a5b9-bbe34932e46d' } });
    expect((await ctx.service.evaluate(ctx.workspace, ctx.manifest)).status).toBe('STALE');
  });
  it('exposes safe artifact read failures and validates before opening the editor', async () => {
    const ctx = setup();
    await expect(ctx.service.requirementsWorkspace()).rejects.toMatchObject({ code: 'NO_ARTIFACT' });
    ctx.storage.read.mockRejectedValue(new AnalysisFailure('INVALID_ARTIFACT'));
    expect((await ctx.service.evaluate(ctx.workspace, ctx.manifest)).status).toBe('FAILED');
    await expect(ctx.service.requirementsWorkspace()).rejects.toMatchObject({ code: 'INVALID_ARTIFACT' });
  });
  it('renders counts and actions with escaped metadata and safe gated actions', () => {
    const artifact = requirementsArtifact();
    const html = renderAnalysis({ status: 'ANALYZED', artifact: { ...artifact, generated: { ...artifact.generated, model: { ...artifact.generated.model, family: '<script>bad</script>' } } } }, true);
    expect(html).toContain('Functional requirements</dt><dd>2'); expect(html).toContain('View Requirements'); expect(html).toContain('Re-analyze PRD');
    expect(html).not.toContain('<script>'); expect(html).toContain('&lt;script&gt;');
    expect(renderAnalysis({ status: 'ANALYZING' }, true)).not.toContain('command:devpilot.analyzePrd');
    expect(renderAnalysis({ status: 'NOT_ANALYZED' }, false)).not.toContain('command:devpilot.analyzePrd');
    expect(renderAnalysis({ status: 'FAILED', message: '<private>' }, true)).toContain('Retry Analysis');
  });
});

describe('analysis concurrency and cancellation', () => {
  it('rejects duplicate operations at the application boundary', async () => {
    const ctx = setup(); let finish: (text: string) => void = () => undefined;
    ctx.gateway.sendRequest.mockImplementation(() => new Promise<string>((resolve) => { finish = resolve; }));
    const running = ctx.service.analyze(ctx.token);
    await vi.waitFor(() => expect(ctx.gateway.sendRequest).toHaveBeenCalledOnce());
    expect((await ctx.service.evaluate(ctx.workspace, ctx.manifest)).status).toBe('ANALYZING');
    await expect(ctx.service.analyze(token())).rejects.toMatchObject({ code: 'BUSY' });
    finish(JSON.stringify(rawRequirementsContent())); await running;
    expect(ctx.storage.write).toHaveBeenCalledOnce();
  });
  it.each([false, true])('cancelled response restores prior state; existing artifact=%s', async (existing) => {
    const ctx = setup(); if (existing) ctx.setSaved(requirementsArtifact());
    ctx.gateway.sendRequest.mockImplementation(async () => { ctx.token.cancel(); return JSON.stringify(rawRequirementsContent()); });
    await expect(ctx.service.analyze(ctx.token)).rejects.toMatchObject({ code: 'CANCELLED' });
    expect(ctx.storage.write).not.toHaveBeenCalled();
    expect((await ctx.service.evaluate(ctx.workspace, ctx.manifest)).status).toBe(existing ? 'ANALYZED' : 'NOT_ANALYZED');
    expect(ctx.token.listeners.size).toBe(0);
  });
  it('pre-cancellation sends nothing and cancellation at commit preserves the artifact', async () => {
    const ctx = setup(); ctx.token.cancel();
    await expect(ctx.service.analyze(ctx.token)).rejects.toMatchObject({ code: 'CANCELLED' });
    expect(ctx.gateway.sendRequest).not.toHaveBeenCalled();
    const next = setup(); next.setSaved(requirementsArtifact());
    next.storage.write.mockImplementation(async (_root, _artifact, beforeCommit) => { next.token.cancel(); await beforeCommit(); });
    await expect(next.service.analyze(next.token)).rejects.toMatchObject({ code: 'CANCELLED' });
    expect(next.saved()).toEqual(requirementsArtifact());
  });
  it('disposal cancels active work and disposes subscriptions', async () => {
    const ctx = setup(); const listener = vi.fn(); ctx.service.onDidChange(listener);
    ctx.gateway.sendRequest.mockImplementation(async () => { ctx.service.dispose(); return JSON.stringify(rawRequirementsContent()); });
    await expect(ctx.service.analyze(ctx.token)).rejects.toMatchObject({ code: 'CANCELLED' });
    expect(ctx.storage.write).not.toHaveBeenCalled(); expect(ctx.token.listeners.size).toBe(0);
    expect(listener).toHaveBeenCalledOnce();
  });
});


it('does not send after the model preference is cleared during source preflight', async () => {
  const ctx = setup();
  ctx.reader.read.mockResolvedValueOnce({ ...importedPrd, text: prdText }).mockImplementationOnce(async () => {
    ctx.models.state = { status: 'SELECTION_REQUIRED', models: [analysisModel] };
    return { ...importedPrd, text: prdText };
  });
  await expect(ctx.service.analyze(ctx.token)).rejects.toMatchObject({ code: 'SELECTION_REQUIRED' });
  expect(ctx.gateway.sendRequest).not.toHaveBeenCalled();
});

it.each([false, true])('reports the actual artifact outcome and precise safe diagnostics; existing=%s', async (existing) => {
  const ctx = setup(); if (existing) ctx.setSaved(requirementsArtifact());
  const raw = rawRequirementsContent();
  ctx.gateway.sendRequest.mockResolvedValue(JSON.stringify({ ...raw, functionalRequirements: raw.functionalRequirements.map((item, index) => index === 0 ? { ...item, priority: 'HIGH' } : item) }));
  await expect(ctx.service.analyze(ctx.token)).rejects.toMatchObject({ message: expect.stringContaining(existing ? 'The previous requirements artifact was preserved.' : 'No requirements artifact was created.') });
  expect(ctx.storage.write).not.toHaveBeenCalled();
  const logs = ctx.log.mock.calls.flat().join('\n');
  for (const expected of ['started', 'modelId', 'prdBytes', 'promptCharacters', 'responseCharacters', 'raw validation', 'functionalRequirements[0].priority', 'MUST | SHOULD | COULD', 'HIGH']) expect(logs).toContain(expected);
  expect(logs).not.toContain(prdText); expect(logs).not.toContain('Users must be able to create an account');
  expect(await ctx.service.evaluate(ctx.workspace, ctx.manifest)).toMatchObject({ status: 'FAILED', message: expect.stringContaining(existing ? 'preserved' : 'No requirements artifact was created') });
});

it('does not recreate a project deleted while a response is in flight', async () => {
  const ctx = setup();
  ctx.gateway.sendRequest.mockImplementation(async () => { ctx.projects.read.mockResolvedValue(undefined); return JSON.stringify(rawRequirementsContent()); });
  await expect(ctx.service.analyze(ctx.token)).rejects.toMatchObject({ code: 'PROJECT_REQUIRED' });
  expect(ctx.storage.write).not.toHaveBeenCalled();
});

it('logs a distinct source-verification failure and preserves the previous artifact', async () => {
  const ctx = setup(); ctx.setSaved(requirementsArtifact());
  const raw = rawRequirementsContent();
  const valid = { section: 'Tasks', quote: 'Users must be able to create tasks with a title.' };
  ctx.gateway.sendRequest.mockResolvedValue(JSON.stringify({ ...raw, functionalRequirements: raw.functionalRequirements.map((item, index) => index === 1 ? { ...item, sourceReferences: [valid, valid, valid, { section: 'Tasks', quote: 'Unsupported private paraphrase.' }] } : item) }));
  await expect(ctx.service.analyze(ctx.token)).rejects.toMatchObject({ code: 'INVALID_OUTPUT' });
  const logs = ctx.log.mock.calls.flat().join('\n');
  for (const expected of ['source quote verification', 'functionalRequirements[1].sourceReferences[3].quote', 'quoteLength', 'normalizedQuoteLength', 'NOT_FOUND']) expect(logs).toContain(expected);
  expect(logs).not.toContain('Unsupported private paraphrase');
  expect(logs).not.toContain('YAML persistence'); expect(ctx.storage.write).not.toHaveBeenCalled();
  expect(ctx.saved()).toEqual(requirementsArtifact());
});
