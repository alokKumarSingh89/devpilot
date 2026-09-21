import { beforeEach, describe, expect, it, vi } from 'vitest';
import { VscodeProjectStorage } from '../src/infrastructure/projects/VscodeProjectStorage';
import { projectFixture } from './projectFixture';
import { serializeProjectYaml } from '../src/infrastructure/projects/projectYaml';

const host = vi.hoisted(() => {
  class FsError extends Error { constructor(readonly code: string) { super('private provider detail'); } }
  return { FsError, fs: { stat: vi.fn(), readFile: vi.fn(), writeFile: vi.fn(), createDirectory: vi.fn(), rename: vi.fn(), delete: vi.fn() } };
});
vi.mock('vscode', () => ({
  FileSystemError: host.FsError,
  FileType: { File: 1, Directory: 2, SymbolicLink: 64 },
  workspace: { fs: host.fs },
  Uri: {
    parse: (key: string) => ({ key }),
    joinPath: (base: { key: string }, ...parts: string[]) => ({ key: [base.key, ...parts].join('/') }),
  },
}));
type Uri = { key: string };
type Entry = { type: number; bytes: Uint8Array };
const entries = new Map<string, Entry>();
const workspace = { key: 'vscode-remote://host/repo', name: 'repo', folderName: 'repo' };
const directory = `${workspace.key}/.devpilot`;
const destination = `${directory}/project.yaml`;
const logger = vi.fn();
const storage = new VscodeProjectStorage(logger);
const bytes = (text: string) => new TextEncoder().encode(text);

beforeEach(() => {
  entries.clear(); vi.clearAllMocks();
  host.fs.stat.mockImplementation(async (uri: Uri) => {
    const entry = entries.get(uri.key); if (!entry) throw new host.FsError('FileNotFound');
    return { type: entry.type, size: entry.bytes.byteLength };
  });
  host.fs.readFile.mockImplementation(async (uri: Uri) => {
    const entry = entries.get(uri.key); if (!entry) throw new host.FsError('FileNotFound'); return entry.bytes;
  });
  host.fs.createDirectory.mockImplementation(async (uri: Uri) => { entries.set(uri.key, { type: 2, bytes: bytes('') }); });
  host.fs.writeFile.mockImplementation(async (uri: Uri, data: Uint8Array) => { entries.set(uri.key, { type: 1, bytes: data }); });
  host.fs.rename.mockImplementation(async (from: Uri, to: Uri, options: { overwrite: boolean }) => {
    if (entries.has(to.key) && !options.overwrite) throw new host.FsError('FileExists');
    const entry = entries.get(from.key); if (!entry) throw new host.FsError('FileNotFound');
    entries.set(to.key, entry); entries.delete(from.key);
  });
  host.fs.delete.mockImplementation(async (uri: Uri) => {
    if (!entries.delete(uri.key)) throw new host.FsError('FileNotFound');
  });
});

describe('VS Code project filesystem adapter', () => {
  it('writes YAML through a temporary URI and create-only rename, then restores it', async () => {
    await storage.write(workspace, projectFixture());
    expect(host.fs.writeFile).toHaveBeenCalledOnce();
    expect(host.fs.writeFile.mock.calls[0]?.[0].key).toMatch(/\.project-.*\.tmp$/);
    expect(host.fs.rename).toHaveBeenCalledWith(expect.anything(), { key: destination }, { overwrite: false });
    expect(await storage.exists(workspace)).toBe(true);
    expect(await storage.read(workspace)).toEqual(projectFixture());
    expect([...entries.keys()]).toEqual([directory, destination]);
  });
  it('does not infer initialization from the directory', async () => {
    entries.set(directory, { type: 2, bytes: bytes('') });
    expect(await storage.exists(workspace)).toBe(false);
    expect(await storage.read(workspace)).toBeUndefined();
  });
  it('never overwrites even an invalid existing manifest', async () => {
    entries.set(destination, { type: 1, bytes: bytes('broken YAML') });
    await expect(storage.write(workspace, projectFixture())).rejects.toMatchObject({ code: 'ALREADY_EXISTS' });
    expect(host.fs.writeFile).not.toHaveBeenCalled();
    expect(new TextDecoder().decode(entries.get(destination)?.bytes)).toBe('broken YAML');
    await expect(storage.read(workspace)).rejects.toMatchObject({ code: 'INVALID_MANIFEST' });
  });
  it('protects a manifest created by another writer before rename', async () => {
    host.fs.rename.mockImplementation(async (_from: Uri, to: Uri) => {
      entries.set(to.key, { type: 1, bytes: bytes('other writer') }); throw new host.FsError('FileExists');
    });
    await expect(storage.write(workspace, projectFixture())).rejects.toMatchObject({ code: 'ALREADY_EXISTS' });
    expect([...entries.keys()]).toEqual([directory, destination]);
    expect(new TextDecoder().decode(entries.get(destination)?.bytes)).toBe('other writer');
  });
  it('cleans up partial temporary writes without publishing a project', async () => {
    host.fs.writeFile.mockImplementation(async (uri: Uri) => {
      entries.set(uri.key, { type: 1, bytes: bytes('partial') }); throw new host.FsError('NoPermissions');
    });
    await expect(storage.write(workspace, projectFixture())).rejects.toMatchObject({ code: 'WRITE_FAILED' });
    expect([...entries.keys()]).toEqual([directory]);
    expect(host.fs.rename).not.toHaveBeenCalled();
  });
  it('cleans up after a rename failure', async () => {
    host.fs.rename.mockRejectedValue(new host.FsError('Unavailable'));
    await expect(storage.write(workspace, projectFixture())).rejects.toMatchObject({ code: 'WRITE_FAILED' });
    expect([...entries.keys()]).toEqual([directory]);
  });
  it('does not confuse access failures with a missing project', async () => {
    host.fs.stat.mockRejectedValue(new host.FsError('NoPermissions'));
    await expect(storage.exists(workspace)).rejects.toMatchObject({ code: 'READ_FAILED' });
    await expect(storage.read(workspace)).rejects.toMatchObject({ code: 'READ_FAILED' });
    expect(logger).toHaveBeenCalledWith('read: NoPermissions');
    expect(logger.mock.calls.flat().join()).not.toContain('private provider detail');
  });
  it('rejects unsupported schemas and invalid UTF-8', async () => {
    entries.set(destination, { type: 1, bytes: bytes(serializeProjectYaml(projectFixture()).replace('schemaVersion: 1', 'schemaVersion: 2')) });
    await expect(storage.read(workspace)).rejects.toMatchObject({ code: 'UNSUPPORTED_SCHEMA' });
    entries.set(destination, { type: 1, bytes: new Uint8Array([255]) });
    await expect(storage.read(workspace)).rejects.toMatchObject({ code: 'INVALID_MANIFEST' });
  });
  it('rejects symlinked metadata directories', async () => {
    entries.set(directory, { type: 66, bytes: bytes('') });
    await expect(storage.write(workspace, projectFixture())).rejects.toMatchObject({ code: 'INVALID_MANIFEST' });
    expect(host.fs.writeFile).not.toHaveBeenCalled();
  });
  it('serializes before touching the filesystem', async () => {
    await expect(storage.write(workspace, { ...projectFixture(), schemaVersion: 2 } as unknown as ReturnType<typeof projectFixture>)).rejects.toMatchObject({ code: 'SERIALIZATION_FAILED' });
    expect(host.fs.createDirectory).not.toHaveBeenCalled();
    expect(host.fs.writeFile).not.toHaveBeenCalled();
  });
});
