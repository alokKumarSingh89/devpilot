import { beforeEach, describe, expect, it, vi } from 'vitest';
import { VscodeInventoryStorage } from '../src/infrastructure/repository/VscodeInventoryStorage';
import { serializeInventoryYaml } from '../src/infrastructure/repository/inventoryYaml';
import { InventoryFailure } from '../src/domain/repository/InventoryFailure';
import { INVENTORY_PATH } from '../src/domain/repository/inventory';
import { inventoryFixture } from './repositoryFixture';

const host = vi.hoisted(() => {
  class FsError extends Error { constructor(readonly code: string) { super('private path and provider detail'); } }
  return { FsError, fs: { stat: vi.fn(), readFile: vi.fn(), writeFile: vi.fn(), createDirectory: vi.fn(), rename: vi.fn(), delete: vi.fn() } };
});
vi.mock('vscode', () => ({
  FileSystemError: host.FsError, FileType: { File: 1, Directory: 2, SymbolicLink: 64 }, workspace: { fs: host.fs },
  Uri: { parse: (key: string) => ({ key }), joinPath: (base: { key: string }, ...parts: string[]) => ({ key: [base.key, ...parts].join('/') }) },
}));
type Uri = { key: string };
const entries = new Map<string, { type: number; bytes: Uint8Array }>();
const workspace = { key: 'vscode-remote://host/repo', name: 'repo', folderName: 'repo' };
const destination = `${workspace.key}/${INVENTORY_PATH}`;
const encode = (text: string) => new TextEncoder().encode(text);
const logger = vi.fn(); const storage = new VscodeInventoryStorage(logger);
const commit = vi.fn(async () => undefined);
function saved() { return new TextDecoder().decode(entries.get(destination)?.bytes); }
function seed() { entries.set(destination, { type: 1, bytes: encode(serializeInventoryYaml(inventoryFixture())) }); }

beforeEach(() => {
  vi.resetAllMocks(); entries.clear();
  entries.set(`${workspace.key}/.devpilot`, { type: 2, bytes: encode('') });
  host.fs.stat.mockImplementation(async (uri: Uri) => { const entry = entries.get(uri.key); if (!entry) throw new host.FsError('FileNotFound'); return { type: entry.type, size: entry.bytes.byteLength }; });
  host.fs.readFile.mockImplementation(async (uri: Uri) => { const entry = entries.get(uri.key); if (!entry) throw new host.FsError('FileNotFound'); return entry.bytes; });
  host.fs.createDirectory.mockImplementation(async (uri: Uri) => { entries.set(uri.key, { type: 2, bytes: encode('') }); });
  host.fs.writeFile.mockImplementation(async (uri: Uri, bytes: Uint8Array) => { entries.set(uri.key, { type: 1, bytes }); });
  host.fs.rename.mockImplementation(async (from: Uri, to: Uri, options: { overwrite: boolean }) => {
    if (entries.has(to.key) && !options.overwrite) throw new host.FsError('FileExists');
    const entry = entries.get(from.key); if (!entry) throw new host.FsError('FileNotFound');
    entries.set(to.key, entry); entries.delete(from.key);
  });
  host.fs.delete.mockImplementation(async (uri: Uri) => { if (!entries.delete(uri.key)) throw new host.FsError('FileNotFound'); });
});

describe('inventory artifact persistence', () => {
  it('publishes a complete validated artifact through temporary-file rename then restores it', async () => {
    expect(await storage.read(workspace)).toBeUndefined();
    await storage.write(workspace, inventoryFixture(), commit);
    expect(await storage.read(workspace)).toEqual(inventoryFixture());
    expect(host.fs.rename).toHaveBeenCalledWith(expect.objectContaining({ key: expect.stringMatching(/\.inventory-.*\.tmp$/) }), { key: destination }, { overwrite: false });
    expect(commit).toHaveBeenCalledTimes(2);
    expect([...entries.keys()].some((key) => key.endsWith('.tmp'))).toBe(false);
    expect(saved()).toContain('contentHash:'); expect(saved()).not.toContain(workspace.key);
  });
  it('does not touch the filesystem for invalid output', async () => {
    seed(); const before = saved();
    await expect(storage.write(workspace, { ...inventoryFixture(), schemaVersion: 2 } as unknown as ReturnType<typeof inventoryFixture>, commit)).rejects.toMatchObject({ code: 'INVALID_INVENTORY' });
    expect(host.fs.writeFile).not.toHaveBeenCalled(); expect(host.fs.createDirectory).not.toHaveBeenCalled(); expect(saved()).toBe(before);
  });
  it('replaces a previous artifact only after successful validation and write', async () => {
    seed(); const next = { ...inventoryFixture(), repository: { ...inventoryFixture().repository, workspaceName: 'Revised' } };
    await storage.write(workspace, next, commit);
    expect(await storage.read(workspace)).toEqual(next);
    expect(host.fs.rename).toHaveBeenCalledWith(expect.anything(), { key: destination }, { overwrite: true });
  });
  it.each(['write', 'rename', 'cancel', 'source'])('preserves valid requirements after %s failure and removes temporary output', async (stage) => {
    seed(); const before = saved();
    if (stage === 'write') host.fs.writeFile.mockImplementation(async (uri: Uri, bytes: Uint8Array) => { entries.set(uri.key, { type: 1, bytes }); throw new host.FsError('NoPermissions'); });
    if (stage === 'rename') host.fs.rename.mockRejectedValue(new host.FsError('Unavailable'));
    if (stage === 'cancel') commit.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new InventoryFailure('CANCELLED'));
    if (stage === 'source') commit.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new InventoryFailure('CONFLICT'));
    await expect(storage.write(workspace, inventoryFixture(), commit)).rejects.toBeInstanceOf(Error);
    expect(saved()).toBe(before);
    expect([...entries.keys()].some((key) => key.endsWith('.tmp'))).toBe(false);
  });
  it('detects competing artifact edits during write and leaves them intact', async () => {
    seed(); host.fs.writeFile.mockImplementation(async (uri: Uri, bytes: Uint8Array) => {
      entries.set(uri.key, { type: 1, bytes }); entries.set(destination, { type: 1, bytes: encode('another writer') });
    });
    await expect(storage.write(workspace, inventoryFixture(), commit)).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(saved()).toBe('another writer'); expect(host.fs.rename).not.toHaveBeenCalled();
  });
  it.each(['.devpilot', '.devpilot/codebase', INVENTORY_PATH])('rejects symlinked metadata path %s', async (path) => {
    entries.set(`${workspace.key}/${path}`, { type: 65, bytes: encode('data') });
    await expect(storage.read(workspace)).rejects.toMatchObject({ code: 'INVALID_INVENTORY' });
    await expect(storage.write(workspace, inventoryFixture(), commit)).rejects.toMatchObject({ code: 'INVALID_INVENTORY' });
    expect(host.fs.writeFile).not.toHaveBeenCalled();
  });
  it('rejects corrupt UTF-8 and oversized persisted artifacts', async () => {
    entries.set(destination, { type: 1, bytes: new Uint8Array([255]) });
    await expect(storage.read(workspace)).rejects.toMatchObject({ code: 'INVALID_INVENTORY' });
    entries.set(destination, { type: 1, bytes: new Uint8Array(2097153) });
    host.fs.readFile.mockClear();
    await expect(storage.read(workspace)).rejects.toMatchObject({ code: 'INVALID_INVENTORY' }); expect(host.fs.readFile).not.toHaveBeenCalled();
  });
  it('reports safe access errors, not missing artifacts or raw paths', async () => {
    host.fs.stat.mockRejectedValue(new host.FsError('NoPermissions'));
    await expect(storage.read(workspace)).rejects.toMatchObject({ code: 'READ_FAILED', message: expect.not.stringContaining('private path') });
  });
});
