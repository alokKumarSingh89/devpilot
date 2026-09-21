import type { ProjectManifest } from '../src/domain/project';

export function projectFixture(): ProjectManifest {
  return {
    schemaVersion: 1,
    project: {
      id: 'ba0d745e-2e08-45cc-a5b9-bbe34932e46c', name: 'example', status: 'INITIALIZING', source: 'PRD',
      createdAt: '2026-09-21T10:00:00.000Z', updatedAt: '2026-09-21T10:00:00.000Z',
    },
    workspace: { relativeRoot: '.' },
    ai: { reasoningModel: { id: 'reasoner', vendor: 'copilot', family: 'reasoning' } },
  };
}
