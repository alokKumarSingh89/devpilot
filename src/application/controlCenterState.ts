export interface ControlCenterState {
  readonly workspaceFolderNames: readonly string[];
  readonly projectStatus: 'No project initialized';
}

/** TASK-DP-001 has no project persistence or initialization workflow. */
export function getControlCenterState(
  workspaceFolders: readonly { readonly name: string }[] | undefined,
): ControlCenterState {
  return {
    workspaceFolderNames: workspaceFolders?.map((folder) => folder.name) ?? [],
    projectStatus: 'No project initialized',
  };
}
