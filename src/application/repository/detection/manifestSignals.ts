import type { Inventory, Evidence } from '../../../domain/repository/inventory';
import { manifestType } from './fileSignals';
export interface ManifestSignals {
  readonly name?: string; readonly kind: Inventory['packages'][number]['kind']; readonly workspace: boolean;
  readonly frameworks: readonly Inventory['frameworks'][number]['name'][];
  readonly testing: readonly Inventory['testing']['frameworks'][number][];
  readonly buildTools: readonly Inventory['tooling']['buildTools'][number][];
  readonly packageManager?: Inventory['tooling']['packageManager']['name'];
  readonly evidence: readonly Evidence[];
}
function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function name(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 && value.length <= 160 && /^[\w@./ -]+$/.test(value) ? value : undefined;
}
export function manifestSignals(path: string, text: string): ManifestSignals {
  const frameworks: Inventory['frameworks'][number]['name'][] = [];
  const testing: Inventory['testing']['frameworks'][number][] = [];
  const buildTools: Inventory['tooling']['buildTools'][number][] = [];
  const evidence: Evidence[] = [];
  let workspace = false; let packageName: string | undefined; let packageManager: Inventory['tooling']['packageManager']['name'] | undefined;
  let kind: Inventory['packages'][number]['kind'] = 'PACKAGE';
  const add = (signal: string): void => { evidence.push({ relativePath: path, signal }); };
  const type = manifestType(path);
  if (type === 'NPM_PACKAGE') {
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error('Invalid package metadata');
    const data = record(parsed);
    packageName = name(data.name);
    const workspaces = Array.isArray(data.workspaces) ? data.workspaces : record(data.workspaces).packages;
    workspace = Array.isArray(workspaces) && workspaces.some((item) => typeof item === 'string' && item.trim());
    if (workspace) add('package.json workspaces declaration');
    const match = typeof data.packageManager === 'string' ? /^(npm|pnpm|yarn|bun)@[^\s]+$/.exec(data.packageManager) : undefined;
    if (match?.[1]) { packageManager = match[1] as 'npm' | 'pnpm' | 'yarn' | 'bun'; add(`packageManager ${packageManager}`); }
    const deps = new Set(['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'].flatMap((key) => Object.keys(record(data[key]))));
    const frameworkDeps = { '@nestjs/core': 'NestJS', react: 'React', next: 'Next.js', '@angular/core': 'Angular', vue: 'Vue' } as const;
    for (const [dependency, framework] of Object.entries(frameworkDeps)) if (deps.has(dependency)) { frameworks.push(framework); add(`dependency ${dependency}`); }
    for (const [dependency, framework] of Object.entries({ vitest: 'Vitest', jest: 'Jest' } as const)) if (deps.has(dependency)) { testing.push(framework); add(`dependency ${dependency}`); }
    for (const [dependency, tool] of Object.entries({ esbuild: 'esbuild', vite: 'Vite', webpack: 'Webpack', typescript: 'TypeScript', turbo: 'Turbo', nx: 'Nx' } as const)) if (deps.has(dependency)) { buildTools.push(tool); add(`dependency ${dependency}`); }
    if (typeof record(data.engines).vscode === 'string') { frameworks.push('VS Code Extension'); add('engines.vscode declaration'); kind = 'APPLICATION'; }
    else if (deps.has('@nestjs/core')) kind = 'SERVICE';
    else if (deps.has('next') || data.bin !== undefined) kind = 'APPLICATION';
    else if (data.main !== undefined || data.exports !== undefined) kind = 'LIBRARY';
  } else if (type === 'PYTHON_PROJECT' || type === 'PYTHON_REQUIREMENTS') {
    let section = ''; let dependencies = false;
    const found = new Set<string>();
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.replace(/#.*$/, '').trim();
      const heading = /^\[([^\]]+)\]$/.exec(line);
      if (heading) { section = heading[1] ?? ''; dependencies = false; continue; }
      if (type === 'PYTHON_REQUIREMENTS') {
        const dep = /^(fastapi|django|pytest)(?:\s|\[|[<>=!~]|$)/i.exec(line); if (dep?.[1]) found.add(dep[1].toLowerCase());
      } else {
        if ((section === 'project' || section === 'tool.poetry') && /^name\s*=/.test(line)) packageName = name(/=\s*["']([^"']+)["']/.exec(line)?.[1]);
        if (/^tool\.poetry\.(?:group\.[\w-]+\.)?(?:dev-)?dependencies$/.test(section)) {
          const dep = /^(fastapi|django|pytest)\s*=/i.exec(line); if (dep?.[1]) found.add(dep[1].toLowerCase());
        }
        if ((section === 'project' && /^dependencies\s*=\s*\[/.test(line)) || (section === 'project.optional-dependencies' && /^\w[\w-]*\s*=\s*\[/.test(line))) dependencies = true;
        if (dependencies) {
          for (const dep of line.matchAll(/["'](fastapi|django|pytest)(?=["'\s\[<>=!~])/gi)) if (dep[1]) found.add(dep[1].toLowerCase());
          if (line.endsWith(']')) dependencies = false;
        }
      }
    }
    for (const [dep, framework] of Object.entries({ fastapi: 'FastAPI', django: 'Django' } as const)) if (found.has(dep)) { frameworks.push(framework); add(`dependency ${dep}`); }
    if (found.has('pytest')) { testing.push('Pytest'); add('dependency pytest'); }
    if (frameworks.length) kind = 'SERVICE';
  } else if (type === 'MAVEN' || type === 'GRADLE') {
    const clean = text.replace(/<!--[\s\S]*?-->|\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    const spring = type === 'MAVEN' ? /<(?:groupId)>\s*org\.springframework\.boot\s*<\//.test(clean) : /(?:implementation|api|id)\s*\(?\s*["']org\.springframework\.boot(?::|["'])/.test(clean);
    const junit = type === 'MAVEN' ? /<groupId>\s*(?:org\.junit(?:\.jupiter)?|junit)\s*<\//.test(clean) : /testImplementation\s*\(?\s*["'](?:org\.junit|junit):/.test(clean);
    if (spring) { frameworks.push('Spring Boot'); add('Spring Boot dependency/plugin coordinate'); kind = 'SERVICE'; }
    if (junit) { testing.push('JUnit'); add('JUnit dependency coordinate'); }
    buildTools.push(type === 'MAVEN' ? 'Maven' : 'Gradle');
  } else if (type === 'GO_MODULE') { packageName = name(/^module\s+([^\s]+)\s*$/m.exec(text)?.[1]); buildTools.push('Go'); }
  else if (type === 'RUST_PACKAGE') {
    const block = /^\[package\]\s*$([\s\S]*?)(?=^\[|$(?![\s\S]))/m.exec(text)?.[1];
    if (block) packageName = name(/^name\s*=\s*["']([^"']+)["']/m.exec(block)?.[1]);
    workspace = /^\[workspace\]\s*$/m.test(text); if (workspace) add('Cargo workspace declaration'); buildTools.push('Cargo');
  }
  return { ...(packageName ? { name: packageName } : {}), ...(packageManager ? { packageManager } : {}), kind, workspace, frameworks, testing, buildTools, evidence };
}
