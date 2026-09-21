import { describe, expect, it } from 'vitest';
import { validateProjectManifest } from '../src/domain/validateProjectManifest';
import { parseProjectYaml, serializeProjectYaml } from '../src/infrastructure/projects/projectYaml';
import { projectFixture } from './projectFixture';

function modified(path: string, value: unknown): unknown {
  const root: Record<string, unknown> = JSON.parse(JSON.stringify(projectFixture()));
  const keys = path.split('.'); const last = keys.pop();
  let current = root;
  for (const key of keys) current = current[key] as Record<string, unknown>;
  if (last) current[last] = value;
  return root;
}

describe('project YAML and runtime validation', () => {
  it('round trips valid YAML using the library', () => {
    const data = projectFixture(); const yaml = serializeProjectYaml(data);
    expect(yaml).toContain('schemaVersion: 1');
    expect(yaml).toContain('status: INITIALIZING');
    expect(parseProjectYaml(yaml)).toEqual(data);
    expect(yaml).not.toContain('absolute');
  });
  it.each([
    ['project.id', 'not-a-uuid'], ['project.name', ''], ['project.status', 'ANALYZING'],
    ['project.source', 'UNKNOWN'], ['project.createdAt', 'yesterday'],
    ['project.updatedAt', '2026-02-30T00:00:00.000Z'], ['workspace.relativeRoot', '/Users/person/project'],
    ['ai.reasoningModel.id', null], ['ai.reasoningModel.vendor', 12], ['ai.reasoningModel.family', ''],
    ['project.updatedAt', '2025-01-01T00:00:00.000Z'], ['schemaVersion', '1'],
    ['ai.apiKey', 'secret'], ['workspace.absolutePath', '/private/path'],
  ])('rejects invalid %s', (path, value) => {
    expect(() => validateProjectManifest(modified(path, value))).toThrow();
  });
  it('rejects unsupported versions distinctly', () => {
    expect(() => validateProjectManifest(modified('schemaVersion', 2))).toThrow(expect.objectContaining({ code: 'UNSUPPORTED_SCHEMA' }));
  });
  it.each(['', 'project: [', 'schemaVersion: 1\nschemaVersion: 1', 'schemaVersion: 1\n---\nproject: {}', 'project: &p { name: a }\nworkspace: *p', 'project: !custom x'])('rejects unsafe or malformed YAML %j', (text) => {
    expect(() => parseProjectYaml(text)).toThrow(expect.objectContaining({ code: 'INVALID_MANIFEST' }));
  });
  it('rejects oversized input and incomplete manifests', () => {
    expect(() => parseProjectYaml('x'.repeat(65537))).toThrow();
    expect(() => validateProjectManifest({ schemaVersion: 1 })).toThrow();
  });
  it('maps serialization failures to a safe error', () => {
    const invalid = { ...projectFixture(), schemaVersion: 2 };
    expect(() => serializeProjectYaml(invalid as unknown as ReturnType<typeof projectFixture>)).toThrow(expect.objectContaining({ code: 'SERIALIZATION_FAILED' }));
  });
});

it('rejects aliases and unknown tags even when their scalar values would form a valid manifest', () => {
  const yaml = serializeProjectYaml(projectFixture());
  const aliased = yaml.replace('name: example', 'name: &name example').replace('id: reasoner', 'id: *name');
  expect(() => parseProjectYaml(aliased)).toThrow(expect.objectContaining({ code: 'INVALID_MANIFEST' }));
  const tagged = yaml.replace('name: example', 'name: !custom example');
  expect(() => parseProjectYaml(tagged)).toThrow(expect.objectContaining({ code: 'INVALID_MANIFEST' }));
});
