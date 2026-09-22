import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { LANGUAGE_CATALOG } from '../src/domain/repository/technology';
import { buildInventory } from '../src/application/repository/detection/buildInventory';
import { language, manifestType } from '../src/application/repository/detection/fileSignals';
import { validateInventory } from '../src/domain/repository/validateInventory';
import { repositorySnapshot } from './repositoryFixture';
import { projectFixture } from './projectFixture';
import { renderInventory } from '../src/presentation/controlCenter/renderInventory';
const build = (files: Record<string, string>) => validateInventory(buildInventory(repositorySnapshot(files), { available: false }, 'repo', projectFixture().project.id, '2026-09-22T10:00:00.000Z'));
const fixture = (name: string): Record<string, string> => JSON.parse(readFileSync(`tests/fixtures/repositories/${name}.json`, 'utf8')) as Record<string, string>;

describe('language-neutral catalogs and manifests', () => {
  it.each(LANGUAGE_CATALOG)('detects every $name extension without reading source', (definition) => {
    for (const extension of definition.extensions) expect(language(`src/file.${extension}`)).toBe(definition.name);
    const result = build(Object.fromEntries(definition.extensions.map((extension) => [`src/file.${extension}`, 'PRIVATE_SOURCE_BODY'])));
    expect(result.languages).toEqual([{ id: definition.id, name: definition.name, fileCount: definition.extensions.length }]);
    expect(JSON.stringify(result)).not.toContain('PRIVATE_SOURCE_BODY');
  });
  it.each(['json', 'yaml', 'yml', 'md'])('does not classify .%s as a primary language', (extension) => expect(language(`file.${extension}`)).toBeUndefined());
  it.each(['Pipfile', 'setup.py', 'setup.cfg', 'settings.gradle', 'settings.gradle.kts', 'gradlew', 'A.csproj', 'A.fsproj', 'A.sln', 'global.json', 'go.sum', 'go.work', 'Cargo.lock', 'Gemfile', 'Gemfile.lock', 'composer.json', 'composer.lock', 'Package.swift', 'pubspec.yaml', 'pubspec.lock'])('recognizes %s without executing it', (path) => expect(manifestType(path)).toBeDefined());
  it.each([
    ['requirements.txt', 'pip'], ['Pipfile', 'Pipenv'], ['poetry.lock', 'poetry'], ['uv.lock', 'uv'],
    ['pom.xml', 'Maven'], ['gradlew', 'Gradle'], ['A.csproj', 'NuGet'], ['go.sum', 'Go modules'],
    ['Cargo.lock', 'Cargo'], ['Gemfile.lock', 'Bundler'], ['composer.lock', 'Composer'], ['Package.swift', 'Swift Package Manager'], ['pubspec.lock', 'pub'],
  ])('detects %s manager facts', (path, manager) => expect(build({ [path]: '' }).tooling.packageManagers).toContain(manager));
});

describe('evidence-based ecosystem detectors', () => {
  it.each([
    ['package.json', '{"dependencies":{"express":"*"}}', 'Express'],
    ['requirements.txt', 'Flask>=3\nSQLAlchemy>=2', 'Flask'],
    ['Pipfile', '[packages]\nflask="*"', 'Flask'],
    ['pom.xml', '<dependency><groupId>io.quarkus</groupId><artifactId>quarkus-rest</artifactId></dependency>', 'Quarkus'],
    ['build.gradle.kts', 'implementation("io.micronaut:micronaut-http-server-netty")', 'Micronaut'],
    ['Web.csproj', '<Project Sdk="Microsoft.NET.Sdk.Web"/>', 'ASP.NET Core'],
    ['Gemfile', 'gem "rails", "8.0"', 'Ruby on Rails'],
    ['composer.json', '{"require":{"laravel/framework":"*"}}', 'Laravel'],
    ['composer.json', '{"require":{"symfony/framework-bundle":"*"}}', 'Symfony'],
    ['pubspec.yaml', 'dependencies: { flutter: { sdk: flutter } }', 'Flutter'],
  ])('detects %s framework from relevant metadata', (path, text, name) => {
    const result = build({ [path]: text });
    expect(result.frameworks).toContainEqual(expect.objectContaining({ name, id: expect.any(String), category: expect.any(String) }));
    expect(result.technologies).toContainEqual(expect.objectContaining({ name, kind: 'FRAMEWORK', evidence: expect.arrayContaining([expect.objectContaining({ relativePath: path })]) }));
  });
  it.each([
    ['package.json', '{"description":"express react NestJS","scripts":{"start":"react"}}'],
    ['pyproject.toml', '[project]\ndescription="Flask Django SQLAlchemy"\n# flask'],
    ['pom.xml', '<!-- <groupId>io.quarkus</groupId> -->'],
    ['pom.xml', '<project><groupId>io.quarkus</groupId><description>org.springframework.boot</description></project>'],
    ['build.gradle.kts', 'description = "implementation(\"io.quarkus:sample\")"'],
    ['Web.csproj', '<!-- <Project Sdk="Microsoft.NET.Sdk.Web"/> -->'],
    ['Gemfile', '# gem "rails"'], ['composer.json', '{"description":"laravel/framework"}'],
    ['pubspec.yaml', 'description: flutter\n# dependencies: {flutter: {sdk: flutter}}'],
  ])('does not infer frameworks from comments/descriptions in %s', (path, text) => expect(build({ [path]: text }).frameworks).toEqual([]));
  it('does not infer frameworks from language or folder names', () => expect(build({ 'rails/a.rb': '', 'spring/Main.java': '', 'flutter/a.dart': '' }).frameworks).toEqual([]));
  it('detects ORM/database signals without persisting arbitrary manifest values', () => {
    const result = build({ 'package.json': '{"dependencies":{"@prisma/client":"SECRET_VERSION","pg":"*"},"apiKey":"SECRET"}', 'requirements.txt': 'sqlalchemy>=2\n', 'pom.xml': '<dependency><groupId>org.hibernate.orm</groupId></dependency>', 'schema.prisma': 'DATABASE_SECRET' });
    for (const name of ['Prisma', 'PostgreSQL', 'SQLAlchemy', 'Hibernate']) expect(result.technologies).toContainEqual(expect.objectContaining({ name }));
    expect(JSON.stringify(result)).not.toContain('SECRET');
  });
  it('signals incomplete invalid metadata instead of executing or repairing it', () => {
    expect(build({ 'composer.json': '{bad' }).scan.truncationReasons).toContain('INVALID_METADATA');
    expect(build({ 'pubspec.yaml': 'a: &a {flutter: yes}\ndependencies: *a' }).scan.truncationReasons).toContain('INVALID_METADATA');
  });
});

describe('polyglot repository integration', () => {
  it('discovers Kotlin/Java Gradle workspaces, database, JUnit and infrastructure evidence', () => {
    const result = build(fixture('java-gradle'));
    expect(result.repository.type).toBe('MONOREPO');
    expect(result.languages.map((item) => item.name)).toEqual(['Java', 'Kotlin']);
    expect(result.tooling.packageManagers).toEqual(['Gradle']); expect(result.testing.frameworks).toContain('JUnit');
    for (const name of ['Spring Boot', 'Hibernate', 'PostgreSQL', 'Docker', 'GitHub Actions']) expect(result.technologies).toContainEqual(expect.objectContaining({ name }));
    expect(result.packages).toHaveLength(3); expect(result.testing.testFileCount).toBe(1);
  });
  it('discovers .NET projects and ignores generated bin/obj files', () => {
    const result = build(fixture('dotnet'));
    expect(result.repository.type).toBe('MULTI_PROJECT'); expect(result.languages).toEqual([{ id: 'csharp', name: 'C#', fileCount: 2 }]);
    expect(result.tooling.packageManagers).toEqual(['NuGet']); expect(result.testing.frameworks).toContain('xUnit');
    expect(result.packages).toHaveLength(2); expect(result.packages).toContainEqual(expect.objectContaining({ name: 'Shop.Api' }));
    expect(result.frameworks[0]?.name).toBe('ASP.NET Core');
  });
  it('records multiple managers in a mixed-language repo without a false cross-ecosystem conflict', () => {
    const files = fixture('mixed-language'); const result = build(files);
    expect(result.tooling.packageManagers).toEqual(['pnpm', 'poetry']); expect(result.tooling.packageManager.conflict).toBe(false);
    expect(result.repository.type).toBe('MULTI_PROJECT'); expect(result.languages.map((item) => item.id)).toEqual(['c', 'cpp', 'python', 'typescript']);
    expect(result).toEqual(build(Object.fromEntries(Object.entries(files).reverse())));
  });
  it('records conflicting managers within one ecosystem/root without silently selecting one', () => {
    const result = build({ 'package-lock.json': '', 'pnpm-lock.yaml': '', 'Gemfile.lock': '' });
    expect(result.tooling.packageManagers).toEqual(['Bundler', 'npm', 'pnpm']); expect(result.tooling.packageManager).toMatchObject({ name: 'UNKNOWN', conflict: true });
    expect(result.tooling.packageManager.evidence).toHaveLength(3);
  });
  it('keeps separate package scopes independent', () => {
    const result = build({ 'a/package-lock.json': '', 'b/pnpm-lock.yaml': '' });
    expect(result.tooling.packageManager.conflict).toBe(false);
  });
  it('detects Flutter and preserves the mobile framework category', () => {
    const result = build(fixture('flutter')); expect(result.frameworks[0]).toMatchObject({ id: 'flutter', name: 'Flutter', category: 'MOBILE' });
    expect(result.languages).toEqual([{ id: 'dart', name: 'Dart', fileCount: 2 }]); expect(result.testing.testFileCount).toBe(1);
  });
  it('reports zero technology facts for an empty/greenfield snapshot and invents no selections', () => {
    const result = build({ 'PRD.md': 'Please choose Java and PostgreSQL for me.' });
    expect(result.technologies).toEqual([]); expect(result.tooling.packageManagers).toEqual([]); expect(result.repository.type).toBe('UNKNOWN');
    expect(result).not.toHaveProperty('selectedTechnologies');
  });
  it('validates technology identities, evidence paths, categories and legacy inventory reads', () => {
    const result = build(fixture('flutter')); const tech = result.technologies[0]; if (!tech) throw new Error('Missing fixture');
    for (const changed of [{ ...tech, id: 'invented' }, { ...tech, kind: 'SELECTED' }, { ...tech, evidence: [{ type: 'DEPENDENCY', relativePath: '../secret', value: 'x' }] }]) expect(() => validateInventory({ ...result, technologies: [changed] })).toThrow();
    expect(() => validateInventory({ ...result, frameworks: result.frameworks.map((item) => ({ ...item, category: 'BACKEND' })) })).toThrow();
    const { technologies: _technologies, ...old } = result;
    const { packageManagers: _managers, ...tooling } = old.tooling;
    const legacy = { ...old, tooling, languages: old.languages.map(({ id: _id, ...item }) => item), frameworks: old.frameworks.map(({ id: _id, category: _category, ...item }) => item) };
    expect(validateInventory(legacy).technologies).toEqual([]);
    expect(renderInventory({ status: 'SCANNED', checked: true, inventory: result }, true)).toContain('Flutter');
  });
});

it('does not mistake colocated Python manifests for independent workspace projects', () => {
  const result = build({ 'apps/api/pyproject.toml': '[project]\nname="api"', 'apps/api/setup.cfg': '[metadata]\nname=api' });
  expect(result.repository.type).toBe('SINGLE_PACKAGE');
});
