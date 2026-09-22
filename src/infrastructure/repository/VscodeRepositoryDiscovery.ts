import { awaitCancellation } from '../../application/models/awaitCancellation';
import * as vscode from 'vscode';
import { createHash } from 'node:crypto';
import type { RepositoryDiscovery, RepositorySnapshot, RepositoryFile } from '../../application/repository/ports';
import type { RequestCancellation } from '../../application/models/ports';
import type { ProjectWorkspace } from '../../application/projects/ports';
import { DEFAULT_SCAN_LIMITS, MAX_TOTAL_METADATA_BYTES, MAX_REPOSITORY_PATH_DEPTH, type ScanLimits, type TruncationReason } from '../../domain/repository/inventory';
import { validateScanLimits } from '../../domain/repository/validateInventory';
import { REPOSITORY_EXCLUSIONS, SECRET_GLOBS, ignoredRepositoryPath } from '../../domain/repository/repositoryPaths';
import { InventoryFailure } from '../../domain/repository/InventoryFailure';
import { documentUri, relativeDocumentPath } from '../documents/workspaceDocumentPath';
import { inspectMetadata, isPackageManifest, manifestType } from '../../application/repository/detection/fileSignals';
const check = (token: RequestCancellation): void => { if (token.isCancellationRequested) throw new InventoryFailure('CANCELLED'); };
const compare = (a: string, b: string): number => a < b ? -1 : a > b ? 1 : 0;

export class VscodeRepositoryDiscovery implements RepositoryDiscovery {
  async discover(workspace: ProjectWorkspace, token: RequestCancellation): Promise<RepositorySnapshot> {
    const source = new vscode.CancellationTokenSource();
    const subscription = token.onCancellationRequested(() => source.cancel());
    try {
      check(token);
      return await awaitCancellation(this.discoverFiles(workspace, source.token), source.token);
    } catch (error) {
      check(token);
      throw error instanceof InventoryFailure ? error : new InventoryFailure('SCAN_FAILED');
    } finally { source.cancel(); subscription.dispose(); source.dispose(); }
  }

  private async discoverFiles(workspace: ProjectWorkspace, token: vscode.CancellationToken): Promise<RepositorySnapshot> {
    check(token);
    const root = vscode.Uri.parse(workspace.key);
    const configured = vscode.workspace.getConfiguration('devpilot', root);
    let limits: ScanLimits;
    try { limits = validateScanLimits(Object.fromEntries(Object.entries(DEFAULT_SCAN_LIMITS).map(([key, value]) => [key, configured.get<unknown>(`inventory.${key}`, value)]))); }
    catch { limits = DEFAULT_SCAN_LIMITS; }
    const exclusions: string[] = [...REPOSITORY_EXCLUSIONS.map((directory) => `**/${directory}/**`), ...SECRET_GLOBS];
    for (const section of ['files', 'search']) {
      const patterns = vscode.workspace.getConfiguration(section, root).get<Record<string, unknown>>('exclude', {});
      for (const [pattern, value] of Object.entries(patterns)) if (value === true || typeof value === 'object' && value !== null) exclusions.push(pattern);
    }
    const reasons = new Set<TruncationReason>();
    try {
      const uris = await vscode.workspace.findFiles(new vscode.RelativePattern(root, '**/*'), `{${[...new Set(exclusions)].join(',')}}`, limits.maxFiles + 1, token);
      check(token);
      if (uris.length > limits.maxFiles) reasons.add('MAX_FILE_COUNT');
      const paths = [...new Set(uris.flatMap((uri) => {
        try { const path = relativeDocumentPath(workspace, uri); if (ignoredRepositoryPath(path)) return []; if (path.split('/').length > MAX_REPOSITORY_PATH_DEPTH) { reasons.add('UNSAFE_PATH'); return []; } return [path]; }
        catch { reasons.add('UNSAFE_PATH'); return []; }
      }))].sort(compare).slice(0, limits.maxFiles);
      const parents = new Map<string, Promise<boolean>>();
      const safe = async (path: string, cache = true): Promise<boolean> => {
        const parts = path.split('/');
        for (let i = 1; i < parts.length; i++) {
          const parent = parts.slice(0, i).join('/');
          let pending = cache ? parents.get(parent) : undefined;
          if (!pending) { pending = Promise.resolve(vscode.workspace.fs.stat(documentUri(workspace, parent))).then((stat) => stat.type === vscode.FileType.Directory); if (cache) parents.set(parent, pending); }
          if (!await pending) return false;
        }
        return true;
      };
      const files: RepositoryFile[] = [];
      for (let offset = 0; offset < paths.length; offset += 32) {
        check(token);
        const batch = await Promise.all(paths.slice(offset, offset + 32).map(async (path): Promise<RepositoryFile | undefined> => {
          try {
            if (!await safe(path)) { reasons.add('UNSAFE_PATH'); return undefined; }
            const stat = await vscode.workspace.fs.stat(documentUri(workspace, path));
            if (stat.type !== vscode.FileType.File || !Number.isSafeInteger(stat.size) || stat.size < 0) { reasons.add('UNSAFE_PATH'); return undefined; }
            return { relativePath: path, sizeBytes: stat.size };
          } catch { reasons.add('UNREADABLE_FILE'); return undefined; }
        }));
        files.push(...batch.filter((file): file is RepositoryFile => file !== undefined));
      }
      const manifests = files.filter((file) => manifestType(file.relativePath)).sort((a, b) => Number(a.relativePath.includes('/')) - Number(b.relativePath.includes('/')) || compare(a.relativePath, b.relativePath));
      if (manifests.length > limits.maxManifests) reasons.add('MAX_MANIFEST_COUNT');
      const metadata = new Map<string, { text: string; contentHash: string }>(); let packages = 0; let bytesRead = 0;
      for (const file of manifests.slice(0, limits.maxManifests)) {
        check(token);
        if (isPackageManifest(file.relativePath) && ++packages > limits.maxPackages) { reasons.add('MAX_PACKAGE_COUNT'); continue; }
        // Lockfiles, workflow and Docker contents are never needed for these V1 signals.
        if (file.relativePath.split('/').pop()?.toLowerCase() === 'gradlew') continue;
        const type = manifestType(file.relativePath);
        if (!inspectMetadata(file.relativePath) && !['TYPESCRIPT_CONFIG', 'WORKSPACE_CONFIG', 'TOOL_CONFIG'].includes(type ?? '')) continue;
        if (file.sizeBytes > limits.maxMetadataBytes || bytesRead + file.sizeBytes > MAX_TOTAL_METADATA_BYTES) { reasons.add('METADATA_SIZE_LIMIT'); continue; }
        try {
          if (!await safe(file.relativePath, false)) { reasons.add('UNSAFE_PATH'); continue; }
          const uri = documentUri(workspace, file.relativePath); const stat = await vscode.workspace.fs.stat(uri);
          if (stat.type !== vscode.FileType.File || stat.size !== file.sizeBytes) { reasons.add('UNREADABLE_FILE'); continue; }
          const bytes = await vscode.workspace.fs.readFile(uri); check(token);
          if (bytes.byteLength > limits.maxMetadataBytes || bytesRead + bytes.byteLength > MAX_TOTAL_METADATA_BYTES) { reasons.add('METADATA_SIZE_LIMIT'); continue; }
          bytesRead += bytes.byteLength;
          if (bytes.byteLength !== stat.size) { reasons.add('UNREADABLE_FILE'); continue; }
          const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
          if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(text)) { reasons.add('INVALID_METADATA'); continue; }
          metadata.set(file.relativePath, { text, contentHash: createHash('sha256').update(bytes).digest('hex') });
        } catch (error) { check(token); reasons.add(error instanceof TypeError ? 'INVALID_METADATA' : 'UNREADABLE_FILE'); }
      }
      check(token);
      return { files, metadata, discoveredFiles: uris.length, ignoredFiles: uris.length - files.length, reasons: [...reasons].sort(), limits };
    } catch (error) { check(token); throw error instanceof InventoryFailure ? error : new InventoryFailure('SCAN_FAILED'); }
  }
}
