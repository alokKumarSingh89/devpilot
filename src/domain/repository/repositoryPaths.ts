import { validateDocumentPath } from '../documentPath';
export const REPOSITORY_EXCLUSIONS = ['.git', '.devpilot', 'node_modules', 'dist', 'build', 'coverage', '.next', '.nuxt', 'out', 'target', 'vendor', '__pycache__', '.venv', 'venv'] as const;
export const SECRET_GLOBS = ['**/.env', '**/.env.*', '**/*.pem', '**/*.key', '**/id_rsa', '**/id_ed25519'];
export function ignoredRepositoryPath(path: string): boolean {
  try { validateDocumentPath(path); } catch { return true; }
  const parts = path.toLowerCase().split('/');
  return parts.some((part) => REPOSITORY_EXCLUSIONS.some((excluded) => excluded === part)
    || part === '.env' || part.startsWith('.env.') || /\.(pem|key)$/.test(part) || ['id_rsa', 'id_ed25519'].includes(part));
}
