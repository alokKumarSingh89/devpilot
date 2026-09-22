const messages = {
  INVALID_INVENTORY: 'The repository inventory is invalid or uses an unsupported schema. Inspect inventory.yaml or rescan.',
  SCAN_FAILED: 'Repository discovery failed. Check workspace access and retry.',
  WRITE_FAILED: 'DevPilot could not save the repository inventory. Check workspace permissions.',
  READ_FAILED: 'DevPilot could not read the repository inventory.',
  SOURCE_NOT_ALLOWED: 'Codebase scanning requires an initializing Codebase or PRD + Existing Code project.',
  PROJECT_REQUIRED: 'Initialize the DevPilot project before scanning its codebase.',
  CONFLICT: 'The workspace, project, or inventory changed during the operation. Refresh and retry.',
  NO_INVENTORY: 'Scan the codebase before viewing its inventory.',
  BUSY: 'A repository scan or freshness check is already running.',
  CANCELLED: 'Repository scan cancelled.',
} as const;
export class InventoryFailure extends Error {
  constructor(readonly code: keyof typeof messages) { super(messages[code]); this.name = 'InventoryFailure'; }
}
