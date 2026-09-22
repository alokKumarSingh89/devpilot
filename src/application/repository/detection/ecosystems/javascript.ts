import { dependencyFindings, finding, json, object, type DependencyRule, type TechnologyDetector } from './contracts';
const rules: readonly DependencyRule[] = [
  ...Object.entries({ '@nestjs/core': 'NestJS', react: 'React', next: 'Next.js', '@angular/core': 'Angular', vue: 'Vue', express: 'Express' }).map(([dependency, name]) => ({ dependency, name, kind: 'FRAMEWORK' as const })),
  ...Object.entries({ vitest: 'Vitest', jest: 'Jest' }).map(([dependency, name]) => ({ dependency, name, kind: 'TEST_FRAMEWORK' as const })),
  ...Object.entries({ esbuild: 'esbuild', vite: 'Vite', webpack: 'Webpack', typescript: 'TypeScript', turbo: 'Turbo', nx: 'Nx' }).map(([dependency, name]) => ({ dependency, name, kind: 'BUILD_TOOL' as const })),
  { dependency: '@prisma/client', name: 'Prisma', kind: 'ORM' }, { dependency: 'prisma', name: 'Prisma', kind: 'ORM' },
  ...Object.entries({ pg: 'PostgreSQL', mysql2: 'MySQL', 'better-sqlite3': 'SQLite', mongodb: 'MongoDB' }).map(([dependency, name]) => ({ dependency, name, kind: 'DATABASE' as const })),
];
export const javascriptDetector: TechnologyDetector = {
  id: 'javascript', supports: (input) => input.type === 'NPM_PACKAGE',
  detect(input) {
    if (input.text === undefined) return [];
    const data = json(input.text);
    const dependencies = new Set(['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'].flatMap((key) => Object.keys(object(data[key]))));
    const result = dependencyFindings(input, dependencies, rules);
    if (typeof object(data.engines).vscode === 'string') result.push(finding(input, 'FRAMEWORK', 'VS Code Extension', 'engines.vscode', 'CONFIGURATION'));
    if (typeof object(data.engines).node === 'string') result.push(finding(input, 'RUNTIME', 'Node.js', 'engines.node', 'CONFIGURATION'));
    const manager = typeof data.packageManager === 'string' ? /^(npm|pnpm|yarn|bun)@[^\s]+$/.exec(data.packageManager)?.[1] : undefined;
    if (manager) result.push(finding(input, 'PACKAGE_MANAGER', manager, `packageManager ${manager}`, 'CONFIGURATION'));
    return result;
  },
};
