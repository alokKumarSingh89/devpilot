import { MAX_DOCUMENT_CANDIDATES, type DocumentCandidate } from '../../domain/document';
import { documentFormat, excludedDocumentPath, validateDocumentPath } from '../../domain/documentPath';

const exactNames = new Map([
  ['prd', 1000], ['product-requirements', 950], ['requirements', 900],
  ['product-spec', 850], ['functional-requirements', 850], ['spec', 800], ['specification', 800],
]);
export function rankDocuments(paths: readonly string[]): DocumentCandidate[] {
  const ranked: DocumentCandidate[] = [];
  for (const path of new Set(paths)) {
    try {
      const relativePath = validateDocumentPath(path);
      if (excludedDocumentPath(relativePath)) continue;
      const kind = documentFormat(relativePath);
      const fileName = relativePath.split('/').pop() ?? relativePath;
      const stem = fileName.replace(/\.[^.]+$/, '').toLowerCase().replace(/[_\s]+/g, '-');
      const exact = exactNames.get(stem);
      const terms = stem.split(/[^a-z0-9]+/).filter((part) => ['prd', 'requirement', 'requirements', 'spec', 'specification', 'product'].includes(part));
      const reasons = [kind === 'markdown' ? 'supported Markdown document' : 'supported text document'];
      let score = kind === 'markdown' ? 5 : 3;
      if (exact) { score += exact; reasons.unshift(stem === 'prd' ? 'exact PRD filename' : 'exact requirements/specification filename'); }
      else if (terms.length) { score += 200 + terms.length * 10; reasons.unshift(...terms.map((term) => `contains "${term}"`)); }
      else if (stem === 'readme') { score = 1; reasons.unshift('README: low-confidence fallback; explicit selection required'); }
      const depth = relativePath.split('/').length - 1;
      if (depth <= 1) { score += depth === 0 ? 10 : 5; reasons.push('located near workspace root'); }
      ranked.push({ relativePath, fileName, kind, score, reasons });
    } catch { /* Unsupported/unsafe search results are never offered. */ }
  }
  const hasStrongCandidate = ranked.some((candidate) => candidate.score >= 200);
  return ranked.filter((candidate) => !hasStrongCandidate || !/^readme\.(md|markdown|txt)$/i.test(candidate.fileName))
    .sort((a, b) => b.score - a.score || (a.relativePath < b.relativePath ? -1 : a.relativePath > b.relativePath ? 1 : 0))
    .slice(0, MAX_DOCUMENT_CANDIDATES);
}
