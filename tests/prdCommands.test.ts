import { beforeEach, expect, it, vi } from 'vitest';
import { registerPrdCommands } from '../src/presentation/commands/prdCommands';
import type { PrdImportService } from '../src/application/documents/PrdImportService';
import type { ProjectService } from '../src/application/projects/ProjectService';
import { rankDocuments } from '../src/application/documents/rankDocuments';
import { projectFixture } from './projectFixture';
const host = vi.hoisted(() => ({ commands: new Map<string, () => Promise<void>>(), pick: vi.fn(), open: vi.fn(), warning: vi.fn(), info: vi.fn() }));
vi.mock('vscode', () => ({
  commands: { registerCommand: (id: string, callback: () => Promise<void>) => { host.commands.set(id, callback); return { dispose() { host.commands.delete(id); } }; } },
  window: { showQuickPick: host.pick, showOpenDialog: host.open, showWarningMessage: host.warning, showInformationMessage: host.info },
  Uri: { parse: (key: string) => { const u = new URL(key); return { scheme: u.protocol.slice(0, -1), authority: u.host, path: u.pathname, query: '', fragment: '' }; } },
}));
const workspace = { key: 'file:///repo', name: 'repo', folderName: 'repo' };
const result = { workspace, manifest: projectFixture(), candidates: rankDocuments(['PRD.md']), limited: false };
const prds = { discover: vi.fn(), import: vi.fn() };
const projects = { refresh: vi.fn() };
const choose = vi.fn();
beforeEach(() => {
  vi.resetAllMocks(); host.commands.clear(); choose.mockResolvedValue(true); prds.discover.mockResolvedValue(result);
  registerPrdCommands(prds as unknown as PrdImportService, projects as unknown as ProjectService, choose, vi.fn());
});
async function select() { await host.commands.get('devpilot.selectPrd')?.(); }
it('requires an explicit selection and cancellation writes nothing', async () => {
  host.pick.mockResolvedValue(undefined); await select();
  expect(host.pick).toHaveBeenCalledOnce(); expect(prds.import).not.toHaveBeenCalled();
});
it('imports the chosen relative path and refreshes', async () => {
  host.pick.mockResolvedValue({ action: 'select', relativePath: 'PRD.md' }); await select();
  expect(prds.import).toHaveBeenCalledWith(workspace, result.manifest, 'PRD.md');
  expect(projects.refresh).toHaveBeenCalledOnce();
});
it('always offers browse even without candidates and cancelling browse changes nothing', async () => {
  prds.discover.mockResolvedValue({ ...result, candidates: [] }); host.pick.mockResolvedValue({ action: 'browse' }); host.open.mockResolvedValue(undefined);
  await select();
  expect(host.pick.mock.calls[0]?.[0]).toEqual([expect.objectContaining({ action: 'browse' })]);
  expect(host.open).toHaveBeenCalledOnce(); expect(prds.import).not.toHaveBeenCalled();
});
it('rejects browsing outside the root before importing', async () => {
  host.pick.mockResolvedValue({ action: 'browse' });
  host.open.mockResolvedValue([{ scheme: 'file', authority: '', path: '/other/PRD.md', query: '', fragment: '' }]);
  await select(); expect(prds.import).not.toHaveBeenCalled(); expect(host.warning).toHaveBeenCalledOnce();
});
it('cancelling root selection prevents discovery or file changes', async () => {
  choose.mockResolvedValue(false); await select();
  expect(prds.discover).not.toHaveBeenCalled(); expect(prds.import).not.toHaveBeenCalled();
});
it('manual refresh evaluates state and choosing a root forces selection', async () => {
  await host.commands.get('devpilot.refreshProject')?.(); expect(projects.refresh).toHaveBeenCalledOnce();
  await host.commands.get('devpilot.selectProjectWorkspace')?.(); expect(choose).toHaveBeenLastCalledWith(true);
});
it('hides unexpected provider detail', async () => {
  prds.discover.mockRejectedValue(new Error('private stack trace'));
  await select(); expect(host.warning.mock.calls.flat().join()).not.toContain('private stack');
});
