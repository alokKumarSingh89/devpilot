import type { PrdInput, PrdState } from '../../domain/document';
import { DocumentFailure } from '../../domain/DocumentFailure';
import type { ProjectWorkspace } from '../projects/ports';
import type { DocumentReader } from './ports';

export class PrdStateService {
  constructor(private readonly reader: DocumentReader) {}
  async evaluate(workspace: ProjectWorkspace, input?: PrdInput): Promise<PrdState> {
    if (!input) return { status: 'NOT_SELECTED' };
    try {
      const current = await this.reader.read(workspace, input.relativePath);
      return { status: current.contentHash === input.contentHash ? 'SELECTED' : 'CHANGED', input };
    } catch (error) {
      if (error instanceof DocumentFailure && error.code === 'MISSING') return { status: 'MISSING', input };
      return { status: 'ERROR', input, message: error instanceof DocumentFailure ? error.message : new DocumentFailure('READ_FAILED').message };
    }
  }
}
