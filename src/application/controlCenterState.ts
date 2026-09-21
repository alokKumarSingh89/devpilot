import type { ProjectState } from '../domain/project';
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
  readonly project: ProjectState;
  readonly projectFolderName?: string | undefined;
}

/** Initial view state until the project storage service resolves the manifest. */
export function getControlCenterState(
  workspaceFolders: readonly { readonly name: string; readonly path?: string | undefined }[] | undefined,
): ControlCenterState {
  return {
    workspacePaths: workspaceFolders?.flatMap((folder) => folder.path ? [folder.path] : []) ?? [],
    workspaceFolderNames: workspaceFolders?.map((folder) => folder.name) ?? [],
    project: { status: workspaceFolders?.length ? 'LOADING' : 'NO_WORKSPACE' },
  };
}
