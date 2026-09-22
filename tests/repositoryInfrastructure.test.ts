import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Uri } from 'vscode';
import { VscodeRepositoryDiscovery } from '../src/infrastructure/repository/VscodeRepositoryDiscovery';
import { VscodeGitMetadata } from '../src/infrastructure/repository/VscodeGitMetadata';
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
  return { FsError, MockUri, fs: { stat: vi.fn(), readFile: vi.fn() }, findFiles: vi.fn(), extension: vi.fn(), limits: {} as Record<string, number>, sources: [] as { dispose: ReturnType<typeof vi.fn>; token: { isCancellationRequested: boolean } }[],
    workspace: { workspaceFolders: [] as { name: string; uri: MockUri }[], name: undefined, isTrusted: true } };
});
vi.mock('vscode', () => ({
  CancellationTokenSource: class {
    private listeners = new Set<() => void>();
    token = { isCancellationRequested: false, onCancellationRequested: (listener: () => void) => { this.listeners.add(listener); return { dispose: () => this.listeners.delete(listener) }; } };
    cancel() { this.token.isCancellationRequested = true; this.listeners.forEach((listener) => listener()); }
    dispose = vi.fn();
    constructor() { host.sources.push(this); }
  },
  extensions: { getExtension: host.extension },
  Uri: host.MockUri, FileSystemError: host.FsError, FileType: { File: 1, Directory: 2, SymbolicLink: 64 },
  RelativePattern: class { constructor(readonly baseUri: unknown, readonly pattern: string) {} },
  workspace: Object.assign(host.workspace, { fs: host.fs, findFiles: host.findFiles,
    getConfiguration: (section: string) => ({ get: (key: string, fallback: unknown) => section === 'devpilot' ? host.limits[key] ?? fallback : { '**/ignored/**': true, '**/allowed/**': false } }),
  }),
}));
const workspace = { key: 'vscode-remote://host/repo', name: 'repo', folderName: 'repo' };
const entries = new Map<string, { bytes: Uint8Array; type: number; size?: number }>();
const encode = (text: string) => new TextEncoder().encode(text);
function file(path: string, content = '# Requirements', type = 1) { entries.set(`/repo/${path}`, { bytes: encode(content), type }); }
const discovery = new VscodeRepositoryDiscovery();
const token = { isCancellationRequested: false, onCancellationRequested: () => ({ dispose() {} }) };
beforeEach(() => {
  vi.clearAllMocks(); entries.clear(); host.limits = {}; host.sources.length = 0; host.extension.mockReturnValue(undefined); host.workspace.workspaceFolders = [];
  host.fs.stat.mockImplementation(async (uri: { path: string }) => {
    const entry = entries.get(uri.path); if (!entry) throw new host.FsError('FileNotFound');
    return { type: entry.type, size: entry.size ?? entry.bytes.byteLength };
  });
  host.fs.readFile.mockImplementation(async (uri: { path: string }) => {
    const entry = entries.get(uri.path); if (!entry) throw new host.FsError('FileNotFound'); return entry.bytes;
  });
  host.findFiles.mockImplementation(async (_include: unknown, _exclude: unknown, max: number) => [...entries].filter(([, entry]) => entry.type !== 2).slice(0, max).map(([path]) => Uri.parse(`vscode-remote://host${path}`)));
});


describe('bounded VS Code repository discovery', () => {
  it('honors editor/hard exclusions and never reads source, scripts, secrets, lockfiles, CI or Docker contents', async () => {
    for (const path of ['src', '.github', '.github/workflows']) file(path, '', 2);
    for (const path of ['src/main.ts', '.env', 'private.key', 'id_rsa', 'Dockerfile', '.github/workflows/ci.yml', 'package-lock.json', 'install.sh', 'node_modules/x/package.json', '.git/config', '.devpilot/project.yaml']) file(path, 'SECRET_NEVER_READ');
    file('package.json', '{"name":"sample"}'); file('tsconfig.json', '{}');
    const result = await discovery.discover(workspace, token);
    expect(result.files.map((item) => item.relativePath)).not.toContain('.env');
    expect(host.fs.readFile.mock.calls.map((call) => call[0].path).sort()).toEqual(['/repo/package.json', '/repo/tsconfig.json']);
    const args = host.findFiles.mock.calls[0];
    expect(args?.[0].baseUri.toString()).toBe(workspace.key);
    expect(args?.[1]).toContain('**/ignored/**'); expect(args?.[1]).not.toContain('**/allowed/**');
    for (const path of ['node_modules', '.git', '.devpilot', 'dist', 'build', 'coverage', '.nuxt', '.venv']) expect(args?.[1]).toContain(`**/${path}/**`);
    expect(args?.[2]).toBe(5001); expect(host.sources[0]?.dispose).toHaveBeenCalledOnce();
  });
  it('bounds discovery and reports an incomplete scan', async () => {
    host.limits['inventory.maxFiles'] = 2;
    for (const path of ['a.ts', 'b.ts', 'c.ts', 'd.ts']) file(path);
    const result = await discovery.discover(workspace, token);
    expect(result.files).toHaveLength(2); expect(result.reasons).toContain('MAX_FILE_COUNT');
    expect(result.discoveredFiles).toBe(3); expect(result.ignoredFiles).toBe(1);
  });
  it('skips oversized metadata before reading and reports coverage', async () => {
    host.limits['inventory.maxMetadataBytes'] = 5; file('package.json', 'too large');
    const result = await discovery.discover(workspace, token);
    expect(result.reasons).toContain('METADATA_SIZE_LIMIT'); expect(host.fs.readFile).not.toHaveBeenCalled();
  });
  it('rejects metadata changed between stat and read', async () => {
    file('package.json', '{}');
    host.fs.readFile.mockResolvedValue(encode('{\"name\":\"changed\"}'));
    const result = await discovery.discover(workspace, token);
    expect(result.metadata.size).toBe(0); expect(result.reasons).toContain('UNREADABLE_FILE');
  });
  it('bounds manifest/package inspections', async () => {
    host.limits['inventory.maxPackages'] = 1;
    file('package.json', '{}'); file('app', '', 2); file('app/package.json', '{}');
    const result = await discovery.discover(workspace, token);
    expect(result.reasons).toContain('MAX_PACKAGE_COUNT'); expect(host.fs.readFile).toHaveBeenCalledOnce();
  });
  it('rejects symlinked parents/files and outside-root search results before reading', async () => {
    file('linked', '', 66); file('linked/package.json', '{}'); file('package.json', '{}', 65);
    host.findFiles.mockResolvedValue([Uri.parse(`${workspace.key}/linked/package.json`), Uri.parse(`${workspace.key}/package.json`), Uri.parse('vscode-remote://host/outside/package.json')]);
    const result = await discovery.discover(workspace, token);
    expect(result.files).toHaveLength(0); expect(result.reasons).toContain('UNSAFE_PATH'); expect(host.fs.readFile).not.toHaveBeenCalled();
  });
  it('records invalid UTF-8 as incomplete without propagating raw contents', async () => {
    entries.set('/repo/package.json', { bytes: new Uint8Array([255]), type: 1 });
    const result = await discovery.discover(workspace, token);
    expect(result.metadata.size).toBe(0); expect(result.reasons).toContain('INVALID_METADATA');
  });
  it('maps search failure safely and disposes its cancellation source', async () => {
    host.findFiles.mockRejectedValue(new Error('private provider location'));
    await expect(discovery.discover(workspace, token)).rejects.toMatchObject({ code: 'SCAN_FAILED', message: expect.not.stringContaining('private') });
    expect(host.sources[0]?.dispose).toHaveBeenCalledOnce();
  });
  it('cancels a stalled search promptly and never inspects late results', async () => {
    let listener: () => void = () => undefined;
    const cancellation = { isCancellationRequested: false, onCancellationRequested: (callback: () => void) => { listener = callback; return { dispose: vi.fn() }; } };
    host.findFiles.mockImplementation(() => new Promise(() => undefined));
    const running = discovery.discover(workspace, cancellation);
    const failure = expect(running).rejects.toMatchObject({ code: 'CANCELLED' });
    await vi.waitFor(() => expect(host.findFiles).toHaveBeenCalledOnce()); cancellation.isCancellationRequested = true; listener(); await failure;
    expect(host.fs.readFile).not.toHaveBeenCalled(); expect(host.sources[0]?.dispose).toHaveBeenCalledOnce();
  });
});

describe('read-only Git metadata adapter', () => {
  it('succeeds without Git, an active extension or a matching root', async () => {
    const adapter = new VscodeGitMetadata();
    expect(await adapter.read(workspace)).toEqual({ available: false });
    host.extension.mockReturnValue({ isActive: false, activate: () => { throw new Error('must not activate'); } });
    expect(await adapter.read(workspace)).toEqual({ available: false });
    host.extension.mockReturnValue({ isActive: true, exports: { getAPI: () => ({ repositories: [] }) } });
    expect(await adapter.read(workspace)).toEqual({ available: false });
  });
  it('reads only bounded cached HEAD/dirty fields without commands, remote URLs or credentials', async () => {
    const status = vi.fn();
    host.extension.mockReturnValue({ isActive: true, exports: { getAPI: () => ({ repositories: [{ rootUri: Uri.parse(workspace.key), status, state: {
      HEAD: { name: 'feat/example', commit: 'a'.repeat(40) }, indexChanges: [], workingTreeChanges: [{}], mergeChanges: [],
      get remotes() { throw new Error('must not read remote credentials'); },
    } }] }) } });
    expect(await new VscodeGitMetadata().read(workspace)).toEqual({ available: true, branch: 'feat/example', headCommit: 'a'.repeat(40), dirty: true });
    expect(status).not.toHaveBeenCalled();
  });
  it('fails closed for malformed Git metadata', async () => {
    host.extension.mockReturnValue({ isActive: true, exports: { getAPI: () => ({ repositories: [{ rootUri: Uri.parse(workspace.key), state: { HEAD: { commit: 'invalid' }, indexChanges: [], workingTreeChanges: [], mergeChanges: [] } }] }) } });
    expect(await new VscodeGitMetadata().read(workspace)).toEqual({ available: false });
  });
});
