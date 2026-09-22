import { describe, expect, it, vi } from 'vitest';
import { RepositoryInventoryService } from '../src/application/repository/RepositoryInventoryService';
import { InventoryFailure } from '../src/domain/repository/InventoryFailure';
import type { Inventory } from '../src/domain/repository/inventory';
import type { ProjectManifest } from '../src/domain/project';
import type { ProjectWorkspace } from '../src/application/projects/ports';
import { renderInventory } from '../src/presentation/controlCenter/renderInventory';
import { inventoryFixture, repositoryFixture, repositorySnapshot } from './repositoryFixture';
import { projectFixture } from './projectFixture';
function setup() {
  const workspace = { key: 'file:///repo', name: 'test', folderName: 'test' };
  const context = { current: vi.fn<() => ProjectWorkspace | undefined>(() => workspace), isTrusted: vi.fn(() => true), needsSelection: vi.fn(() => false) };
  const project: ProjectManifest = { ...projectFixture(), project: { ...projectFixture().project, source: 'CODEBASE' } };
  const projects = { read: vi.fn<() => Promise<ProjectManifest | undefined>>().mockResolvedValue(project) };
  const discovery = { discover: vi.fn().mockResolvedValue(repositorySnapshot(repositoryFixture('nestjs'))) };
  const git = { read: vi.fn().mockResolvedValue({ available: false }) };
  let saved: Inventory | undefined;
  const storage = { read: vi.fn(async () => saved), write: vi.fn(async (_root: ProjectWorkspace, inventory: Inventory, beforeCommit: () => Promise<void>) => { await beforeCommit(); saved = inventory; }) };
  const service = new RepositoryInventoryService(context, projects, discovery, git, storage, () => new Date('2026-09-21T12:00:00.000Z'));
  const callbacks = new Set<() => void>();
  const token = { isCancellationRequested: false, onCancellationRequested: (listener: () => void) => { callbacks.add(listener); return { dispose: () => callbacks.delete(listener) }; }, cancel() { this.isCancellationRequested = true; callbacks.forEach((callback) => callback()); } };
  return { service, workspace, context, project, projects, discovery, git, storage, token, callbacks, saved: () => saved, seed: (inventory = inventoryFixture()) => { saved = inventory; } };
}

describe('repository inventory application boundary', () => {
  it('scans once, validates/persists facts and leaves the project INITIALIZING without a model dependency', async () => {
    const ctx = setup(); await ctx.service.scan(ctx.token);
    expect(ctx.discovery.discover).toHaveBeenCalledOnce(); expect(ctx.saved()).toEqual(inventoryFixture());
    expect(ctx.project.project.status).toBe('INITIALIZING'); expect(ctx.callbacks.size).toBe(0);
    expect(await ctx.service.evaluate(ctx.workspace, ctx.project)).toMatchObject({ status: 'SCANNED', checked: true });
  });
  it.each(['PRD', 'READY', 'missing', 'untrusted', 'noWorkspace', 'multiRoot'])('blocks invalid precondition %s', async (condition) => {
    const ctx = setup();
    if (condition === 'PRD') ctx.projects.read.mockResolvedValue(projectFixture());
    if (condition === 'READY') ctx.projects.read.mockResolvedValue({ ...ctx.project, project: { ...ctx.project.project, status: 'READY' } });
    if (condition === 'missing') ctx.projects.read.mockResolvedValue(undefined);
    if (condition === 'untrusted') ctx.context.isTrusted.mockReturnValue(false);
    if (condition === 'noWorkspace' || condition === 'multiRoot') ctx.context.current.mockReturnValue(undefined);
    if (condition === 'multiRoot') ctx.context.needsSelection.mockReturnValue(true);
    await expect(ctx.service.scan(ctx.token)).rejects.toBeInstanceOf(Error);
    expect(ctx.discovery.discover).not.toHaveBeenCalled(); expect(ctx.storage.write).not.toHaveBeenCalled();
  });
  it('supports PRD_AND_CODEBASE and tolerates unavailable Git', async () => {
    const ctx = setup(); ctx.projects.read.mockResolvedValue({ ...ctx.project, project: { ...ctx.project.project, source: 'PRD_AND_CODEBASE' } });
    ctx.git.read.mockRejectedValue(new Error('git unavailable')); await ctx.service.scan(ctx.token);
    expect(ctx.saved()?.git).toEqual({ available: false });
  });
  it('returns NOT_SCANNED without scanning and loads saved state without background discovery', async () => {
    const ctx = setup(); expect(await ctx.service.evaluate(ctx.workspace, ctx.project)).toEqual({ status: 'NOT_SCANNED' });
    await ctx.service.refresh(ctx.token); expect(ctx.discovery.discover).not.toHaveBeenCalled();
    ctx.seed(); expect(await ctx.service.evaluate(ctx.workspace, ctx.project)).toMatchObject({ status: 'SCANNED', checked: false });
    expect(ctx.discovery.discover).not.toHaveBeenCalled();
  });
  it('explicit refresh compares fingerprints without overwriting; rescan publishes the change', async () => {
    const ctx = setup(); ctx.seed(); await ctx.service.refresh(ctx.token);
    expect(await ctx.service.evaluate(ctx.workspace, ctx.project)).toMatchObject({ status: 'SCANNED', checked: true });
    ctx.discovery.discover.mockResolvedValue(repositorySnapshot({ ...repositoryFixture('nestjs'), 'src/routes.ts': 'new' }));
    await ctx.service.refresh(ctx.token);
    expect((await ctx.service.evaluate(ctx.workspace, ctx.project)).status).toBe('STALE');
    expect(ctx.storage.write).not.toHaveBeenCalled(); expect(ctx.saved()).toEqual(inventoryFixture());
    await ctx.service.scan(ctx.token);
    expect((await ctx.service.evaluate(ctx.workspace, ctx.project)).status).toBe('SCANNED');
    expect(ctx.saved()?.generated.repositoryFingerprint).not.toBe(inventoryFixture().generated.repositoryFingerprint);
  });
  it('marks inventory belonging to a replaced project stale', async () => {
    const ctx = setup(); const inventory = inventoryFixture(); ctx.seed({ ...inventory, generated: { ...inventory.generated, projectId: 'ba0d745e-2e08-45cc-a5b9-bbe34932e46d' } });
    expect((await ctx.service.evaluate(ctx.workspace, ctx.project)).status).toBe('STALE');
  });
  it.each(['discovery', 'validation', 'persistence'])('preserves the last valid inventory on %s failure and supports retry', async (stage) => {
    const ctx = setup(); ctx.seed();
    if (stage === 'discovery') ctx.discovery.discover.mockRejectedValueOnce(new Error('private stack'));
    if (stage === 'validation') ctx.discovery.discover.mockResolvedValueOnce({ ...repositorySnapshot(repositoryFixture('nestjs')), discoveredFiles: -1 });
    if (stage === 'persistence') ctx.storage.write.mockRejectedValueOnce(new InventoryFailure('WRITE_FAILED'));
    await expect(ctx.service.scan(ctx.token)).rejects.toBeInstanceOf(Error);
    expect(ctx.saved()).toEqual(inventoryFixture());
    const state = await ctx.service.evaluate(ctx.workspace, ctx.project); expect(state.status).toBe('FAILED'); expect(JSON.stringify(state)).not.toContain('private stack');
    await ctx.service.scan(ctx.token); expect((await ctx.service.evaluate(ctx.workspace, ctx.project)).status).toBe('SCANNED');
  });
  it('rejects duplicate scans and refreshes while an operation is pending', async () => {
    const ctx = setup(); let finish: () => void = () => undefined;
    ctx.discovery.discover.mockImplementation(() => new Promise((resolve) => { finish = () => resolve(repositorySnapshot(repositoryFixture('nestjs'))); }));
    const running = ctx.service.scan(ctx.token);
    await vi.waitFor(() => expect(ctx.discovery.discover).toHaveBeenCalledOnce());
    expect((await ctx.service.evaluate(ctx.workspace, ctx.project)).status).toBe('SCANNING');
    await expect(ctx.service.scan(ctx.token)).rejects.toMatchObject({ code: 'BUSY' });
    await expect(ctx.service.refresh(ctx.token)).rejects.toMatchObject({ code: 'BUSY' }); finish(); await running;
    expect(ctx.storage.write).toHaveBeenCalledOnce();
  });
  it.each([false, true])('cancellation restores prior valid state; existing=%s', async (existing) => {
    const ctx = setup(); if (existing) ctx.seed();
    ctx.discovery.discover.mockImplementation(async () => { ctx.token.cancel(); return repositorySnapshot(repositoryFixture('nestjs')); });
    await expect(ctx.service.scan(ctx.token)).rejects.toMatchObject({ code: 'CANCELLED' });
    expect(ctx.storage.write).not.toHaveBeenCalled(); expect(ctx.saved()).toEqual(existing ? inventoryFixture() : undefined);
    expect((await ctx.service.evaluate(ctx.workspace, ctx.project)).status).toBe(existing ? 'SCANNED' : 'NOT_SCANNED');
    expect(ctx.callbacks.size).toBe(0);
  });
  it('rejects source/root changes at commit and cancellation during persistence', async () => {
    for (const mode of ['root', 'source', 'cancel']) {
      const ctx = setup(); ctx.seed(); ctx.storage.write.mockImplementation(async (_root, _inventory, beforeCommit) => {
        if (mode === 'root') ctx.context.current.mockReturnValue({ ...ctx.workspace, key: 'file:///other' });
        if (mode === 'source') ctx.projects.read.mockResolvedValue(projectFixture());
        if (mode === 'cancel') ctx.token.cancel();
        await beforeCommit();
      });
      await expect(ctx.service.scan(ctx.token)).rejects.toBeInstanceOf(Error); expect(ctx.saved()).toEqual(inventoryFixture());
    }
  });
  it('disposes listeners and cancels active work on extension shutdown', async () => {
    const ctx = setup(); const listener = vi.fn(); ctx.service.onDidChange(listener);
    ctx.discovery.discover.mockImplementation(async () => { ctx.service.dispose(); return repositorySnapshot(repositoryFixture('nestjs')); });
    await expect(ctx.service.scan(ctx.token)).rejects.toMatchObject({ code: 'CANCELLED' });
    expect(ctx.storage.write).not.toHaveBeenCalled(); expect(ctx.callbacks.size).toBe(0); expect(listener).toHaveBeenCalledOnce();
  });
  it('validates inventory before opening it', async () => {
    const ctx = setup(); await expect(ctx.service.inventoryWorkspace()).rejects.toMatchObject({ code: 'NO_INVENTORY' });
    ctx.seed(); expect(await ctx.service.inventoryWorkspace()).toEqual(ctx.workspace);
    ctx.storage.read.mockRejectedValue(new InventoryFailure('INVALID_INVENTORY'));
    await expect(ctx.service.inventoryWorkspace()).rejects.toMatchObject({ code: 'INVALID_INVENTORY' });
  });
});

it('escapes Git labels and renders bounded counts, coverage, state and gated actions', () => {
  const inventory = inventoryFixture();
  const html = renderInventory({ status: 'SCANNED', checked: false, inventory: { ...inventory, git: { available: true, branch: '<script>', headCommit: null, dirty: true }, scan: { ...inventory.scan, truncated: true, truncationReasons: ['MAX_FILE_COUNT'] } } }, true);
  expect(html).toContain('&lt;script&gt;'); expect(html).not.toContain('<script>'); expect(html).toContain('Incomplete coverage');
  expect(html).toContain('Rescan Codebase'); expect(html).toContain('View Inventory'); expect(html).toContain('2 files');
  expect(renderInventory({ status: 'SCANNING' }, true)).not.toContain('command:devpilot.scanCodebase');
  expect(renderInventory({ status: 'NOT_SCANNED' }, false)).not.toContain('command:devpilot.scanCodebase');
});
