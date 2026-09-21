import * as vscode from 'vscode';
import { createHash } from 'node:crypto';
import type { DocumentReader, ReadDocument } from '../../application/documents/ports';
import type { ProjectWorkspace } from '../../application/projects/ports';
import { documentSizeLimit } from '../../domain/document';
import { documentFormat, validateDocumentPath } from '../../domain/documentPath';
import { DocumentFailure } from '../../domain/DocumentFailure';
import { documentUri } from './workspaceDocumentPath';

export class VscodeDocumentReader implements DocumentReader {
  async read(workspace: ProjectWorkspace, path: string): Promise<ReadDocument> {
    const relativePath = validateDocumentPath(path);
    const format = documentFormat(relativePath);
    const uri = documentUri(workspace, relativePath);
    const limit = documentSizeLimit(vscode.workspace.getConfiguration('devpilot', uri).get<unknown>('documents.maxBytes'));
    try {
      const parts = relativePath.split('/');
      for (let index = 1; index < parts.length; index++) {
        const parent = await vscode.workspace.fs.stat(documentUri(workspace, parts.slice(0, index).join('/')));
        if (parent.type & vscode.FileType.SymbolicLink) throw new DocumentFailure('SYMLINK');
        if (parent.type !== vscode.FileType.Directory) throw new DocumentFailure('READ_FAILED');
      }
      const stat = await vscode.workspace.fs.stat(uri);
      if (stat.type & vscode.FileType.SymbolicLink) throw new DocumentFailure('SYMLINK');
      if (stat.type !== vscode.FileType.File) throw new DocumentFailure('UNSUPPORTED');
      if (stat.size > limit) throw new DocumentFailure('TOO_LARGE');
      if (stat.size === 0) throw new DocumentFailure('EMPTY');
      const bytes = await vscode.workspace.fs.readFile(uri);
      if (bytes.byteLength > limit) throw new DocumentFailure('TOO_LARGE');
      let text: string;
      try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
      catch { throw new DocumentFailure('INVALID_TEXT'); }
      if (!text.trim()) throw new DocumentFailure('EMPTY');
      if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text)) throw new DocumentFailure('INVALID_TEXT');
      return { relativePath, format, text, sizeBytes: bytes.byteLength, contentHash: createHash('sha256').update(bytes).digest('hex') };
    } catch (error) {
      if (error instanceof DocumentFailure) throw error;
      if (error instanceof vscode.FileSystemError && error.code === 'FileNotFound') throw new DocumentFailure('MISSING');
      throw new DocumentFailure('READ_FAILED');
    }
  }
}
