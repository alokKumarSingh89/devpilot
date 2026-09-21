import { beforeEach, expect, it, vi } from 'vitest';
import { registerAnalysisCommands } from '../src/presentation/commands/analysisCommands';
import type { PrdAnalysisService } from '../src/application/analysis/PrdAnalysisService';
import type { ProjectService } from '../src/application/projects/ProjectService';
import { AnalysisFailure } from '../src/domain/requirements/AnalysisFailure';
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
const service = { analyze: vi.fn(), requirementsWorkspace: vi.fn() };
const projects = { refresh: vi.fn() }; const choose = vi.fn(); const log = vi.fn();
let disposables: { dispose(): void }[];
beforeEach(() => {
  vi.resetAllMocks(); host.callbacks.clear(); choose.mockResolvedValue(true);
  host.progress.mockImplementation(async (_options, callback: (progress: unknown, cancellation: typeof token) => Promise<void>) => callback({}, token));
  service.requirementsWorkspace.mockResolvedValue({ key: 'vscode-remote://host/selected-root' });
  host.open.mockResolvedValue({ content: 'validated YAML' });
  disposables = registerAnalysisCommands(service as unknown as PrdAnalysisService, projects as unknown as ProjectService, choose, log);
});
it('runs only on explicit invocation and forwards the notification cancellation token', async () => {
  expect(service.analyze).not.toHaveBeenCalled();
  await host.callbacks.get('devpilot.analyzePrd')?.();
  expect(host.progress).toHaveBeenCalledWith({ location: 15, title: 'DevPilot: Analyze PRD', cancellable: true }, expect.any(Function));
  expect(service.analyze).toHaveBeenCalledWith(token);
  expect(host.information).toHaveBeenCalledWith(expect.stringContaining('project remains Initializing'));
});
it('cancelling root selection does not start analysis', async () => {
  choose.mockResolvedValue(false); await host.callbacks.get('devpilot.analyzePrd')?.();
  expect(host.progress).not.toHaveBeenCalled(); expect(service.analyze).not.toHaveBeenCalled();
});
it('opens only the fixed requirements path in the validated selected workspace', async () => {
  await host.callbacks.get('devpilot.openRequirements')?.();
  expect(host.open).toHaveBeenCalledWith({ key: 'vscode-remote://host/selected-root/.devpilot/product/requirements.yaml' });
  expect(host.show).toHaveBeenCalledWith({ content: 'validated YAML' }, { preview: false });
  expect(service.analyze).not.toHaveBeenCalled();
});
it('does not open a missing or invalid artifact', async () => {
  service.requirementsWorkspace.mockRejectedValue(new AnalysisFailure('INVALID_ARTIFACT'));
  await host.callbacks.get('devpilot.openRequirements')?.();
  expect(host.open).not.toHaveBeenCalled(); expect(host.warning).toHaveBeenCalledOnce();
});
it('reports cancellation without success or raw provider errors and refreshes state', async () => {
  service.analyze.mockRejectedValue(new AnalysisFailure('CANCELLED'));
  await host.callbacks.get('devpilot.analyzePrd')?.();
  expect(host.information).toHaveBeenCalledExactlyOnceWith('PRD analysis cancelled.');
  expect(host.warning).not.toHaveBeenCalled(); expect(projects.refresh).toHaveBeenCalledOnce();
});
it('sanitizes unexpected errors and disposes both registered commands', async () => {
  service.analyze.mockRejectedValue(new Error('private endpoint and stack'));
  await host.callbacks.get('devpilot.analyzePrd')?.();
  expect(host.warning.mock.calls.flat().join()).not.toContain('private endpoint');
  expect(log).toHaveBeenCalledWith('PRD analysis: PROVIDER');
  disposables.forEach((item) => item.dispose()); expect(host.callbacks.size).toBe(0);
});
