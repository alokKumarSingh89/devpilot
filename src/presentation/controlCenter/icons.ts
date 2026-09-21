/** Static, theme-colored artwork. No provider or workspace strings enter SVG markup. */
const paths = {
  folder: '<path d="M3 7V5h6l2 2h10v13H3z"/>',
  sparkle: '<path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5z"/>',
  terminal: '<path d="m4 5 7 7-7 7m10 0h6"/>',
  layers: '<path d="m12 3 10 5-10 5L2 8zm-10 9 10 5 10-5M2 16l10 5 10-5"/>',
  change: '<path d="M4 7h16m-4-4 4 4-4 4M20 17H4m4-4-4 4 4 4"/>',
  play: '<path d="m8 4 12 8-12 8z"/>',
  trash: '<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7"/>',
  refresh: '<path d="M20 8a8 8 0 0 0-14-3L3 8m0-5v5h5m-4 8a8 8 0 0 0 14 3l3-3m0 5v-5h-5"/>',
  chip: '<rect x="6" y="6" width="12" height="12" rx="1"/><path d="M9 9h6v6H9zM9 2v4m6-4v4M9 18v4m6-4v4M2 9h4m-4 6h4m12-6h4m-4 6h4"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-11v2"/>',
  document: '<path d="M5 2h9l5 5v15H5zM14 2v6h5M8 12h8m-8 4h6"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="m9 3 1-1h4l1 3 3 1 3 3-1 3 1 3-3 3-3 1-1 3h-4l-1-3-3-1-3-3 1-3-1-3 3-3 3-1z"/>',
} as const;
export type IconName = keyof typeof paths;
export function icon(name: IconName): string {
  return `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${paths[name]}</svg>`;
}
export function tile(name: IconName): string { return `<div class="icon-tile">${icon(name)}</div>`; }
