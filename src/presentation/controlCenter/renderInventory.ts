import type { InventoryState } from '../../domain/repository/inventory';
import { escapeHtml } from './escapeHtml';
import { action } from './renderModels';
export function renderInventory(state: InventoryState, canScan: boolean): string {
  const inventory = 'inventory' in state ? state.inventory : undefined;
  const labels = { NOT_SCANNED: 'Not scanned', SCANNING: 'Scanning…', SCANNED: 'Scanned', STALE: 'Stale', FAILED: 'Scan failed' };
  const types = { SINGLE_PACKAGE: 'Single package', MONOREPO: 'Monorepo', UNKNOWN: 'Unknown' };
  return `<div class="prd-input"><h4>Codebase intelligence</h4><p role="status">${labels[state.status]}</p>
    ${state.status === 'FAILED' ? `<p>${escapeHtml(state.message)}</p>` : ''}
    ${state.status === 'SCANNING' ? '<p>Use the progress notification to cancel. No scripts or models run.</p>' : ''}
    ${state.status === 'STALE' ? '<p>Repository facts differ from the saved inventory. Rescan to update it.</p>' : ''}
    ${state.status === 'SCANNED' && !state.checked ? '<p class="muted">Saved inventory. Refresh Project to check its freshness.</p>' : ''}
    ${inventory ? `<dl class="project-details"><dt>Repository</dt><dd>${types[inventory.repository.type]}</dd><dt>Languages</dt><dd>${escapeHtml(inventory.languages.map((item) => item.name).join(', ') || 'Unknown')}</dd><dt>Frameworks</dt><dd>${escapeHtml(inventory.frameworks.map((item) => item.name).join(', ') || 'None detected')}</dd><dt>Packages</dt><dd>${inventory.packages.length}</dd><dt>Tests</dt><dd>${inventory.testing.testFileCount} files</dd><dt>Git</dt><dd>${inventory.git.available ? `${escapeHtml(inventory.git.branch ?? 'Detached / unborn HEAD')} · ${inventory.git.dirty ? 'Modified' : 'Clean'}` : 'Unavailable'}</dd></dl>
    ${inventory.scan.truncated ? `<p role="status">Incomplete coverage: ${escapeHtml(inventory.scan.truncationReasons.join(', '))}. See inventory for limits.</p>` : ''}` : ''}
    <div class="actions">${inventory ? action('openInventory', 'View Inventory', true) : ''}${canScan && state.status !== 'SCANNING' ? action('scanCodebase', inventory ? 'Rescan Codebase' : 'Scan Codebase') : ''}</div></div>`;
}
