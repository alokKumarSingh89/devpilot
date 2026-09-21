import * as vscode from 'vscode';
import type { DocumentDiscovery } from '../../application/documents/ports';
import { rankDocuments } from '../../application/documents/rankDocuments';
import type { ProjectWorkspace } from '../../application/projects/ports';
import { EXCLUDED_DOCUMENT_DIRECTORIES, MAX_DISCOVERY_FILES, MAX_DOCUMENT_CANDIDATES } from '../../domain/document';
import { DocumentFailure } from '../../domain/DocumentFailure';
import { relativeDocumentPath } from './workspaceDocumentPath';

const extensions = '{[mM][dD],[mM][aA][rR][kK][dD][oO][wW][nN],[tT][xX][tT]}';
const terms = '{[pP][rR][dD],[rR][eE][qQ][uU][iI][rR][eE],[sS][pP][eE][cC],[pP][rR][oO][dD][uU][cC][tT]}';

export class VscodeDocumentDiscovery implements DocumentDiscovery {
  async discover(workspace: ProjectWorkspace): ReturnType<DocumentDiscovery['discover']> {
    try {
      const root = vscode.Uri.parse(workspace.key);
      const excluded = EXCLUDED_DOCUMENT_DIRECTORIES.map((part) => `**/${part}/**`);
      // Explicit exclusions replace findFiles defaults, so include enabled editor exclusions too.
      for (const section of ['files', 'search']) {
        const configured = vscode.workspace.getConfiguration(section, root).get<Record<string, unknown>>('exclude', {});
        for (const [pattern, value] of Object.entries(configured)) {
          if (value === true || (typeof value === 'object' && value !== null)) excluded.push(pattern);
        }
      }
      const exclude = `{${[...new Set(excluded)].join(',')}}`;
      const likely = await vscode.workspace.findFiles(new vscode.RelativePattern(root, `**/*${terms}*.${extensions}`), exclude, MAX_DISCOVERY_FILES + 1);
      const other = likely.length > MAX_DISCOVERY_FILES ? [] : await vscode.workspace.findFiles(
        new vscode.RelativePattern(root, `**/*.${extensions}`), exclude, MAX_DISCOVERY_FILES - likely.length + 1,
      );
      const paths = [...likely, ...other].flatMap((uri) => {
        try { return [relativeDocumentPath(workspace, uri)]; } catch { return []; }
      });
      const unique = [...new Set(paths)].slice(0, MAX_DISCOVERY_FILES);
      const candidates = rankDocuments(unique);
      return { candidates, limited: likely.length + other.length > MAX_DISCOVERY_FILES || candidates.length === MAX_DOCUMENT_CANDIDATES };
    } catch { throw new DocumentFailure('DISCOVERY_FAILED'); }
  }
}
