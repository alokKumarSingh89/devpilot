const messages = {
  NOT_SELECTED: 'Select and import a PRD before analysis.',
  CHANGED: 'The PRD has changed since import. Re-import it before analyzing.',
  SOURCE_NOT_ALLOWED: 'PRD analysis requires an initializing PRD or PRD + Existing Code project.',
  INVALID_OUTPUT: 'The model returned invalid structured requirements. See DevPilot Output for diagnostics.',
  INVALID_ARTIFACT: 'The requirements artifact is invalid or uses an unsupported schema. Inspect it or re-analyze the PRD.',
  NO_ARTIFACT: 'No requirements artifact exists yet. Analyze the PRD first.',
  READ_FAILED: 'DevPilot could not read requirements. Check workspace permissions.',
  WRITE_FAILED: 'DevPilot could not save requirements. The previous artifact was not intentionally replaced.',
  CONFLICT: 'Project inputs or requirements changed during analysis. Refresh and retry.',
  BUSY: 'PRD analysis is already running. Cancel it or wait for it to finish.',
  CANCELLED: 'PRD analysis cancelled.',
  PROVIDER: 'The reasoning model could not complete PRD analysis. Check model access and retry.',
} as const;
export class AnalysisFailure extends Error {
  constructor(readonly code: keyof typeof messages, message?: string) { super(message ?? messages[code]); this.name = 'AnalysisFailure'; }
}

