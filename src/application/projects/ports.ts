import type { ProjectManifest } from '../../domain/project';

/** Runtime-only opaque location; never serialized into a project manifest. */
export interface ProjectWorkspace {
  readonly key: string;
  readonly name: string;
  readonly folderName: string;
}
export interface ProjectWorkspaceContext {
  needsSelection?(): boolean;
  current(): ProjectWorkspace | undefined;
  isTrusted(): boolean;
}
export interface ProjectStorage {
  exists(workspace: ProjectWorkspace): Promise<boolean>;
  read(workspace: ProjectWorkspace): Promise<ProjectManifest | undefined>;
  /** Create-only: must not overwrite an existing manifest, even if it is invalid. */
  write(workspace: ProjectWorkspace, project: ProjectManifest): Promise<void>;
}

export interface ProjectUpdateStorage extends Pick<ProjectStorage, 'read'> {
  /** Reject a stale expected manifest; preserve unrelated project metadata. */
  update(workspace: ProjectWorkspace, expected: ProjectManifest, next: ProjectManifest): Promise<void>;
}
