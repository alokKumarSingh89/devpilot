import * as vscode from 'vscode';
import type { ProjectWorkspace } from '../../application/projects/ports';
import { validateDocumentPath } from '../../domain/documentPath';
import { DocumentFailure } from '../../domain/DocumentFailure';

export function relativeDocumentPath(workspace: ProjectWorkspace, uri: vscode.Uri): string {
  const root = vscode.Uri.parse(workspace.key);
  const prefix = `${root.path.replace(/\/$/, '')}/`;
  if (uri.scheme !== root.scheme || uri.authority !== root.authority || uri.query || uri.fragment || !uri.path.startsWith(prefix)) {
    throw new DocumentFailure('INVALID_PATH');
  }
  return validateDocumentPath(uri.path.slice(prefix.length));
}
export function documentUri(workspace: ProjectWorkspace, path: string): vscode.Uri {
  const relativePath = validateDocumentPath(path);
  const uri = vscode.Uri.joinPath(vscode.Uri.parse(workspace.key), ...relativePath.split('/'));
  if (relativeDocumentPath(workspace, uri) !== relativePath) throw new DocumentFailure('INVALID_PATH');
  return uri;
}
