import { beforeEach, expect, it, vi } from 'vitest';
import { registerPrdCommands } from '../src/presentation/commands/prdCommands';
import type { PrdImportService } from '../src/application/documents/PrdImportService';
import { registerRepositoryCommands } from '../src/presentation/commands/repositoryCommands';
import type { RepositoryInventoryService } from '../src/application/repository/RepositoryInventoryService';
import type { ProjectService } from '../src/application/projects/ProjectService';
import { InventoryFailure } from '../src/domain/repository/InventoryFailure';
const host = vi.hoisted(() => ({
  callbacks: new Map<string, () => Promise<void>>(), warning: vi.fn(), information: vi.fn(), progress: vi.fn(), open: vi.fn(), show: vi.fn(),
}));
vi.mock('vscode', () => ({
  commands: { registerCommand: (id: string, callback: () => Promise<void>) => { host.callbacks.set(id, callback); return { dispose: () => host.callbacks.delete(id) }; } },
  window: { showWarningMessage: host.warning, showInformationMessage: host.information, withProgress: host.progress, showTextDocument: host.show },
  workspace: { openTextDocument: host.open }, ProgressLocation: { Notification: 15 },
  Uri: { parse: (key: string) => ({ key }), joinPath: (base: { key: string }, path: string) => ({ key: `${base.key}/${path}` }) },
}));
const token = { isCancellationRequested: false, onCancellationRequested: () => ({ dispose() {} }) };
const service = { scan: vi.fn(), inventoryWorkspace: vi.fn() };
const projects = { refresh: vi.fn() }; const choose = vi.fn(); const log = vi.fn();
let disposables: { dispose(): void }[];
beforeEach(() => {
  vi.resetAllMocks(); host.callbacks.clear(); choose.mockResolvedValue(true);
  host.progress.mockImplementation(async (_options, callback: (progress: unknown, cancellation: typeof token) => Promise<void>) => callback({}, token));
  service.inventoryWorkspace.mockResolvedValue({ key: 'vscode-remote://host/selected-root' });
  host.open.mockResolvedValue({ content: 'validated YAML' });
  disposables = registerRepositoryCommands(service as unknown as RepositoryInventoryService, projects as unknown as ProjectService, choose, log);
});
it('runs only on explicit invocation and forwards the notification cancellation token', async () => {
  expect(service.scan).not.toHaveBeenCalled();
  await host.callbacks.get('devpilot.scanCodebase')?.();
  expect(host.progress).toHaveBeenCalledWith({ location: 15, title: 'DevPilot: Scan Codebase', cancellable: true }, expect.any(Function));
  expect(service.scan).toHaveBeenCalledWith(token);
  expect(host.information).toHaveBeenCalledWith(expect.stringContaining('project remains Initializing'));
});
it('cancelling root selection does not start scanning', async () => {
  choose.mockResolvedValue(false); await host.callbacks.get('devpilot.scanCodebase')?.();
  expect(host.progress).not.toHaveBeenCalled(); expect(service.scan).not.toHaveBeenCalled();
});
it('opens only the fixed inventory path in the validated selected workspace', async () => {
  await host.callbacks.get('devpilot.openRepositoryInventory')?.();
  expect(host.open).toHaveBeenCalledWith({ key: 'vscode-remote://host/selected-root/.devpilot/codebase/inventory.yaml' });
  expect(host.show).toHaveBeenCalledWith({ content: 'validated YAML' }, { preview: false });
  expect(service.scan).not.toHaveBeenCalled();
});
it('does not open a missing or invalid artifact', async () => {
  service.inventoryWorkspace.mockRejectedValue(new InventoryFailure('INVALID_INVENTORY'));
  await host.callbacks.get('devpilot.openRepositoryInventory')?.();
  expect(host.open).not.toHaveBeenCalled(); expect(host.warning).toHaveBeenCalledOnce();
});
it('reports cancellation without success or raw provider errors and refreshes state', async () => {
  service.scan.mockRejectedValue(new InventoryFailure('CANCELLED'));
  await host.callbacks.get('devpilot.scanCodebase')?.();
  expect(host.information).toHaveBeenCalledExactlyOnceWith('Repository scan cancelled.');
  expect(host.warning).not.toHaveBeenCalled(); expect(projects.refresh).toHaveBeenCalledOnce();
});
it('sanitizes unexpected errors and disposes both registered commands', async () => {
  service.scan.mockRejectedValue(new Error('private endpoint and stack'));
  await host.callbacks.get('devpilot.scanCodebase')?.();
  expect(host.warning.mock.calls.flat().join()).not.toContain('private endpoint');
  expect(log).toHaveBeenCalledWith('Repository inventory: SCAN_FAILED');
  disposables.forEach((item) => item.dispose()); expect(host.callbacks.size).toBe(0);
});

it('checks freshness only on explicit Refresh Project and preserves inventory errors', async () => {
  const refreshInventory = vi.fn().mockRejectedValue(new InventoryFailure('SCAN_FAILED'));
  registerPrdCommands({} as PrdImportService, projects as unknown as ProjectService, choose, log, refreshInventory);
  expect(refreshInventory).not.toHaveBeenCalled();
  await host.callbacks.get('devpilot.refreshProject')?.();
  expect(refreshInventory).toHaveBeenCalledOnce();
  expect(host.warning).toHaveBeenCalledWith(new InventoryFailure('SCAN_FAILED').message);
  refreshInventory.mockResolvedValue(undefined);
  await host.callbacks.get('devpilot.refreshProject')?.();
  expect(projects.refresh).toHaveBeenCalledTimes(2);
});
