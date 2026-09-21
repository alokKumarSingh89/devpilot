import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { VscodeDocumentReader } from '../src/infrastructure/documents/VscodeDocumentReader';
import { VscodeDocumentDiscovery } from '../src/infrastructure/documents/VscodeDocumentDiscovery';
import { relativeDocumentPath } from '../src/infrastructure/documents/workspaceDocumentPath';
import { VscodeProjectWorkspace } from '../src/infrastructure/projects/VscodeProjectWorkspace';
import { Uri } from 'vscode';

const host = vi.hoisted(() => {
  class FsError extends Error { constructor(readonly code: string) { super('private provider error'); } }
  class MockUri {
    readonly scheme: string; readonly authority: string; readonly path: string; readonly query: string; readonly fragment: string;
    constructor(readonly value: string) {
      const url = new URL(value); this.scheme = url.protocol.slice(0, -1); this.authority = url.host;
      this.path = decodeURIComponent(url.pathname); this.query = url.search.slice(1); this.fragment = url.hash.slice(1);
    }
    static parse(value: string) { return new MockUri(value); }
    static joinPath(base: MockUri, ...parts: string[]) {
      return new MockUri(`${base.scheme}://${base.authority}${base.path.replace(/\/$/, '')}/${parts.map(encodeURIComponent).join('/')}`);
    }
    toString() { return this.value; }
  }
  return { FsError, MockUri, fs: { stat: vi.fn(), readFile: vi.fn() }, findFiles: vi.fn(), limit: 1048576,
    workspace: { workspaceFolders: [] as { name: string; uri: MockUri }[], name: undefined, isTrusted: true } };
});
vi.mock('vscode', () => ({
  Uri: host.MockUri, FileSystemError: host.FsError, FileType: { File: 1, Directory: 2, SymbolicLink: 64 },
  RelativePattern: class { constructor(readonly baseUri: unknown, readonly pattern: string) {} },
  workspace: Object.assign(host.workspace, { fs: host.fs, findFiles: host.findFiles,
    getConfiguration: (section: string) => ({ get: () => section === 'devpilot' ? host.limit : { '**/ignored/**': true, '**/allowed/**': false } }),
  }),
}));
const workspace = { key: 'vscode-remote://host/repo', name: 'repo', folderName: 'repo' };
const entries = new Map<string, { bytes: Uint8Array; type: number; size?: number }>();
const encode = (text: string) => new TextEncoder().encode(text);
function file(path: string, content = '# Requirements', type = 1) { entries.set(`/repo/${path}`, { bytes: encode(content), type }); }
const reader = new VscodeDocumentReader();
beforeEach(() => {
  vi.clearAllMocks(); entries.clear(); host.limit = 1048576; host.workspace.workspaceFolders = [];
  host.fs.stat.mockImplementation(async (uri: { path: string }) => {
    const entry = entries.get(uri.path); if (!entry) throw new host.FsError('FileNotFound');
    return { type: entry.type, size: entry.size ?? entry.bytes.byteLength };
  });
  host.fs.readFile.mockImplementation(async (uri: { path: string }) => {
    const entry = entries.get(uri.path); if (!entry) throw new host.FsError('FileNotFound'); return entry.bytes;
  });
  host.findFiles.mockResolvedValue([]);
});

describe('workspace document reader', () => {
  it.each([['PRD.md', 'markdown'], ['PRD.markdown', 'markdown'], ['requirements.txt', 'text']])('reads UTF-8 %s through the provider', async (path, format) => {
    file(path, 'Requirements café');
    expect(await reader.read(workspace, path)).toMatchObject({ relativePath: path, format, text: 'Requirements café', sizeBytes: encode('Requirements café').length });
  });
  it('hashes original bytes deterministically, including a UTF-8 BOM', async () => {
    file('PRD.md', '\uFEFF# PRD');
    const first = await reader.read(workspace, 'PRD.md');
    expect(first.contentHash).toBe(createHash('sha256').update(encode('\uFEFF# PRD')).digest('hex'));
    expect((await reader.read(workspace, 'PRD.md')).contentHash).toBe(first.contentHash);
    file('PRD.md', '# Changed');
    expect((await reader.read(workspace, 'PRD.md')).contentHash).not.toBe(first.contentHash);
  });
  it.each(['spec.pdf', 'PRD.docx'])('rejects unsupported %s before reading', async (path) => {
    await expect(reader.read(workspace, path)).rejects.toMatchObject({ code: 'UNSUPPORTED' });
    expect(host.fs.readFile).not.toHaveBeenCalled();
  });
  it.each(['', ' \n\t '])('rejects empty or whitespace-only content', async (text) => {
    file('PRD.md', text);
    await expect(reader.read(workspace, 'PRD.md')).rejects.toMatchObject({ code: 'EMPTY' });
  });
  it('rejects oversized files before reading and files which grow after stat', async () => {
    host.limit = 5; file('PRD.md', 'too large');
    await expect(reader.read(workspace, 'PRD.md')).rejects.toMatchObject({ code: 'TOO_LARGE' });
    expect(host.fs.readFile).not.toHaveBeenCalled();
    entries.set('/repo/PRD.md', { bytes: encode('too large'), type: 1, size: 3 });
    await expect(reader.read(workspace, 'PRD.md')).rejects.toMatchObject({ code: 'TOO_LARGE' });
  });
  it.each(['../PRD.md', '/PRD.md', 'docs/../PRD.md', 'docs\\PRD.md', '%2e%2e/PRD.md', 'file:///repo/PRD.md'])('rejects unsafe path %s before filesystem access', async (path) => {
    await expect(reader.read(workspace, path)).rejects.toMatchObject({ code: 'INVALID_PATH' });
    expect(host.fs.stat).not.toHaveBeenCalled();
  });
  it.each(['vscode-remote://host/repo-other/PRD.md', 'vscode-remote://other/repo/PRD.md', 'file:///repo/PRD.md'])('rejects outside-root selection %s', (uri) => {
    expect(() => relativeDocumentPath(workspace, Uri.parse(uri))).toThrow();
  });
  it('normalizes an in-root selection to a portable path', () => {
    expect(relativeDocumentPath(workspace, Uri.parse(`${workspace.key}/docs/product%20requirements.md`))).toBe('docs/product requirements.md');
  });
  it('rejects symlinked files and parent directories', async () => {
    file('PRD.md', 'secret', 65);
    await expect(reader.read(workspace, 'PRD.md')).rejects.toMatchObject({ code: 'SYMLINK' });
    file('docs', '', 66); file('docs/PRD.md');
    await expect(reader.read(workspace, 'docs/PRD.md')).rejects.toMatchObject({ code: 'SYMLINK' });
    expect(host.fs.readFile).not.toHaveBeenCalled();
  });
  it('rejects invalid UTF-8, binary text, and directories', async () => {
    entries.set('/repo/PRD.md', { bytes: new Uint8Array([255]), type: 1 });
    await expect(reader.read(workspace, 'PRD.md')).rejects.toMatchObject({ code: 'INVALID_TEXT' });
    file('PRD.md', 'binary\0content');
    await expect(reader.read(workspace, 'PRD.md')).rejects.toMatchObject({ code: 'INVALID_TEXT' });
    file('PRD.md', 'directory', 2);
    await expect(reader.read(workspace, 'PRD.md')).rejects.toMatchObject({ code: 'UNSUPPORTED' });
  });
  it('maps missing and provider access errors without exposing raw detail', async () => {
    await expect(reader.read(workspace, 'PRD.md')).rejects.toMatchObject({ code: 'MISSING' });
    host.fs.stat.mockRejectedValue(new host.FsError('NoPermissions'));
    await expect(reader.read(workspace, 'PRD.md')).rejects.toMatchObject({ code: 'READ_FAILED' });
  });
});

describe('bounded VS Code discovery', () => {
  it('uses selected-root search, editor exclusions, relative results, and never reads contents', async () => {
    host.findFiles.mockResolvedValueOnce([Uri.parse(`${workspace.key}/docs/PRD.md`)]).mockResolvedValueOnce([Uri.parse(`${workspace.key}/README.md`), Uri.parse(`${workspace.key}/node_modules/spec.md`)]);
    const result = await new VscodeDocumentDiscovery().discover(workspace);
    expect(result.candidates.map((item) => item.relativePath)).toEqual(['docs/PRD.md']);
    const [pattern, exclusions, limit] = host.findFiles.mock.calls[0] ?? [];
    expect(pattern.baseUri.toString()).toBe(workspace.key);
    for (const directory of ['node_modules', '.git', 'dist', 'build', 'coverage', '.next', 'out', 'vendor', '.devpilot', 'ignored']) expect(exclusions).toContain(`**/${directory}/**`);
    expect(exclusions).not.toContain('allowed');
    expect(limit).toBe(501);
    expect(host.fs.readFile).not.toHaveBeenCalled();
  });
  it('caps huge searches and reports the limit', async () => {
    host.findFiles.mockResolvedValue(Array.from({ length: 501 }, (_, i) => Uri.parse(`${workspace.key}/spec-${i}.md`)));
    const result = await new VscodeDocumentDiscovery().discover(workspace);
    expect(host.findFiles).toHaveBeenCalledOnce();
    expect(result.limited).toBe(true);
    expect(result.candidates).toHaveLength(50);
  });
});

describe('explicit multi-root project context', () => {
  it('requires selection, preserves it across reordering, and never guesses another root', () => {
    const a = { name: 'a', uri: host.MockUri.parse('file:///a') };
    const b = { name: 'b', uri: host.MockUri.parse('file:///b') };
    const c = { name: 'c', uri: host.MockUri.parse('file:///c') };
    host.workspace.workspaceFolders = [a, b];
    const context = new VscodeProjectWorkspace();
    expect(context.current()).toBeUndefined(); expect(context.needsSelection()).toBe(true);
    context.select(b.uri.toString());
    host.workspace.workspaceFolders = [b, a];
    expect(context.current()?.key).toBe('file:///b');
    host.workspace.workspaceFolders = [a, c];
    expect(context.current()).toBeUndefined(); expect(context.needsSelection()).toBe(true);
    expect(() => context.select('file:///outside')).toThrow();
  });
});
