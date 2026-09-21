import type { RequirementsArtifact } from '../../domain/requirements/requirements';
import type { ProjectWorkspace } from '../projects/ports';

export interface RequirementsStorage {
  read(workspace: ProjectWorkspace): Promise<RequirementsArtifact | undefined>;
  /** Validate before writing. Invoke beforeCommit immediately before publishing the complete replacement. */
  write(workspace: ProjectWorkspace, artifact: RequirementsArtifact, beforeCommit: () => Promise<void>): Promise<void>;
}
