import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { DEFAULT_SCAN_LIMITS, type ScanLimits } from '../src/domain/repository/inventory';
import type { RepositorySnapshot } from '../src/application/repository/ports';
import { buildInventory } from '../src/application/repository/detection/buildInventory';
import { projectFixture } from './projectFixture';
export function repositoryFixture(name: 'nestjs' | 'monorepo' | 'fastapi'): Record<string, string> { return JSON.parse(readFileSync(`tests/fixtures/repositories/${name}.json`, 'utf8')) as Record<string, string>; }
export function repositorySnapshot(files: Record<string, string>, limits: ScanLimits = DEFAULT_SCAN_LIMITS): RepositorySnapshot {
  return { files: Object.entries(files).map(([relativePath, text]) => ({ relativePath, sizeBytes: Buffer.byteLength(text) })),
    metadata: new Map(Object.entries(files).map(([path, text]) => [path, { text, contentHash: createHash('sha256').update(text).digest('hex') }])),
    discoveredFiles: Object.keys(files).length, ignoredFiles: 0, reasons: [], limits };
}
export const inventoryFixture = () => buildInventory(repositorySnapshot(repositoryFixture('nestjs')), { available: false }, 'test', projectFixture().project.id, '2026-09-21T12:00:00.000Z');
