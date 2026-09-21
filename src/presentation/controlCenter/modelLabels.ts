/** Presentation aliases only: provider IDs remain unchanged in the application. */
export function providerLabel(vendor: string): string {
  return vendor.toLowerCase() === 'copilot' ? 'GitHub Copilot' : vendor;
}
