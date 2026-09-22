import { dependencyFindings, finding, type DependencyRule, type TechnologyDetector } from './contracts';
const rules: readonly DependencyRule[] = [
  ...Object.entries({ fastapi: 'FastAPI', django: 'Django', flask: 'Flask' }).map(([dependency, name]) => ({ dependency, name, kind: 'FRAMEWORK' as const })),
  { dependency: 'pytest', name: 'Pytest', kind: 'TEST_FRAMEWORK' }, { dependency: 'sqlalchemy', name: 'SQLAlchemy', kind: 'ORM' },
  { dependency: 'psycopg', name: 'PostgreSQL', kind: 'DATABASE' }, { dependency: 'psycopg2', name: 'PostgreSQL', kind: 'DATABASE' },
];
export const pythonDetector: TechnologyDetector = {
  id: 'python', supports: (input) => ['PYTHON_PROJECT', 'PYTHON_REQUIREMENTS', 'PIPFILE', 'PYTHON_SETUP'].includes(input.type),
  detect(input) {
    if (input.text === undefined) return [];
    const dependencies = new Set<string>(); let section = ''; let array = false; let iniList = false; let poetry = false;
    for (const raw of input.text.split(/\r?\n/)) {
      const line = raw.replace(/#.*$/, '').trim(); const heading = /^\[([^\]]+)\]$/.exec(line);
      if (heading) { section = heading[1] ?? ''; array = false; iniList = false; if (section.startsWith('tool.poetry')) poetry = true; continue; }
      if (input.type === 'PYTHON_REQUIREMENTS' || iniList && /^\s+/.test(raw)) {
        const dep = /^([a-zA-Z][\w.-]*)(?=\s|\[|[<>=!~]|$)/.exec(line)?.[1]; if (dep) dependencies.add(dep.toLowerCase());
      }
      if (iniList && !/^\s+/.test(raw) && line) iniList = false;
      if (section === 'options' && /^install_requires\s*=/.test(line)) iniList = true;
      if (/^tool\.poetry\.(?:group\.[\w-]+\.)?(?:dev-)?dependencies$/.test(section) || input.type === 'PIPFILE' && ['packages', 'dev-packages'].includes(section)) {
        const dep = /^["']?([\w.-]+)["']?\s*=/.exec(line)?.[1]; if (dep) dependencies.add(dep.toLowerCase());
      }
      if (section === 'project' && /^dependencies\s*=\s*\[/.test(line) || section === 'project.optional-dependencies' && /^[\w-]+\s*=\s*\[/.test(line) || input.path.endsWith('setup.py') && /^install_requires\s*=\s*\[/.test(line)) array = true;
      if (array) {
        for (const match of line.matchAll(/["']([a-zA-Z][\w.-]*)(?=["'\s\[<>=!~])/g)) if (match[1]) dependencies.add(match[1].toLowerCase());
        if (line.endsWith(']') || line.endsWith('],')) array = false;
      }
    }
    const result = dependencyFindings(input, dependencies, rules);
    if (poetry) result.push(finding(input, 'PACKAGE_MANAGER', 'poetry', 'tool.poetry declaration', 'CONFIGURATION'));
    return result;
  },
};
