import type { ModelState } from '../domain/reasoningModel';
import type { ModelTestResult } from './models/ReasoningModelService';

export interface ControlCenterState {
  readonly workspacePaths: readonly string[];
  readonly workspaceFolderNames: readonly string[];
  readonly reasoning?: {
    readonly state: ModelState;
    readonly notice: string | undefined;
    readonly testResult: ModelTestResult | undefined;
    readonly testing: boolean;
  };
  readonly projectStatus: 'No project initialized';
}

/** TASK-DP-001 has no project persistence or initialization workflow. */
export function getControlCenterState(
  workspaceFolders: readonly { readonly name: string; readonly path?: string | undefined }[] | undefined,
): ControlCenterState {
  return {
    workspacePaths: workspaceFolders?.flatMap((folder) => folder.path ? [folder.path] : []) ?? [],
    workspaceFolderNames: workspaceFolders?.map((folder) => folder.name) ?? [],
    projectStatus: 'No project initialized',
  };
}
