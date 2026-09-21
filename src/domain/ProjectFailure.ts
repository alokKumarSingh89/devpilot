const messages = {
  WORKSPACE_SELECTION_REQUIRED: 'Select the DevPilot workspace folder before continuing.',
  CONFLICT: 'The project manifest changed. Refresh the project and select the PRD again.',
  NO_WORKSPACE: 'Open a workspace folder before initializing DevPilot.',
  UNTRUSTED: 'Trust this workspace before creating a DevPilot project.',
  WORKSPACE_CHANGED: 'The project workspace changed. Start initialization again.',
  ALREADY_EXISTS: 'This workspace already contains a DevPilot project manifest. It will not be overwritten.',
  INVALID_MANIFEST: 'The DevPilot project manifest is invalid. Check .devpilot/project.yaml.',
  UNSUPPORTED_SCHEMA: 'This project uses an unsupported manifest schema version. Update DevPilot before opening it.',
  READ_FAILED: 'DevPilot could not read the project manifest. Check workspace access.',
  WRITE_FAILED: 'DevPilot could not save the project manifest. Check workspace permissions and try again.',
  SERIALIZATION_FAILED: 'DevPilot could not serialize the project manifest. No project was saved.',
  INVALID_SOURCE: 'Choose a supported project source.',
  BUSY: 'Project initialization is already running.',
} as const;
export type ProjectFailureCode = keyof typeof messages;
export class ProjectFailure extends Error {
  constructor(readonly code: ProjectFailureCode) {
    super(messages[code]);
    this.name = 'ProjectFailure';
  }
}
