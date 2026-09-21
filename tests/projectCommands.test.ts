import { beforeEach, expect, it, vi } from 'vitest';
import { registerProjectCommands } from '../src/presentation/commands/projectCommands';
import type { ProjectService } from '../src/application/projects/ProjectService';
import { ProjectFailure } from '../src/domain/ProjectFailure';
import { projectFixture } from './projectFixture';

const host = vi.hoisted(() => ({
  register: vi.fn(), picker: vi.fn(), info: vi.fn(), warning: vi.fn(),
}));
vi.mock('vscode', () => ({
  commands: { registerCommand: host.register },
  window: { showQuickPick: host.picker, showInformationMessage: host.info, showWarningMessage: host.warning },
}));
const workspace = { key: 'remote://host/repo', name: 'repo', folderName: 'repo' };
const service = { prepare: vi.fn(), initialize: vi.fn(), refresh: vi.fn(async () => undefined) };
let command: () => Promise<void>;
beforeEach(() => {
  vi.resetAllMocks();
  service.prepare.mockResolvedValue(workspace);
  service.initialize.mockResolvedValue(projectFixture());
  registerProjectCommands(service as unknown as ProjectService, vi.fn());
  command = host.register.mock.calls[0]?.[1] as () => Promise<void>;
});
it('offers all three sources without starting analysis, and cancels without writing', async () => {
  host.picker.mockResolvedValue(undefined); await command();
  expect(host.picker).toHaveBeenCalledWith([
    expect.objectContaining({ label: 'Import PRD', source: 'PRD' }),
    expect.objectContaining({ label: 'Analyze Existing Code', source: 'CODEBASE' }),
    expect.objectContaining({ label: 'PRD + Existing Code', source: 'PRD_AND_CODEBASE', detail: expect.stringContaining('Recommended') }),
  ], expect.anything());
  expect(service.initialize).not.toHaveBeenCalled(); expect(host.info).not.toHaveBeenCalled();
});
it('passes the explicitly chosen source and captured workspace and notifies success', async () => {
  host.picker.mockResolvedValue({ source: 'PRD' }); await command();
  expect(service.initialize).toHaveBeenCalledExactlyOnceWith('PRD', workspace);
  expect(host.info).toHaveBeenCalledWith(expect.stringContaining('Project intelligence has not been generated yet'));
});
it('does not open the picker if application preconditions fail', async () => {
  service.prepare.mockRejectedValue(new ProjectFailure('NO_WORKSPACE')); await command();
  expect(host.picker).not.toHaveBeenCalled();
  expect(host.warning).toHaveBeenCalledWith('Open a workspace folder before initializing DevPilot.');
});
it('sanitizes unexpected errors and refreshes after failure', async () => {
  host.picker.mockResolvedValue({ source: 'PRD' }); service.initialize.mockRejectedValue(new Error('raw private stack'));
  await command();
  expect(host.warning).toHaveBeenCalledWith(expect.not.stringContaining('raw private stack'));
  expect(service.refresh).toHaveBeenCalledOnce(); expect(host.info).not.toHaveBeenCalled();
});
