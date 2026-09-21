const messages = {
  INVALID_PATH: 'Choose a file inside the selected project folder using a safe relative path.',
  UNSUPPORTED: 'Select a Markdown (.md, .markdown) or text (.txt) document.',
  EMPTY: 'The selected requirements document is empty or contains only whitespace.',
  TOO_LARGE: 'The requirements document exceeds the configured size limit (1 MiB by default). It was not imported.',
  INVALID_TEXT: 'The requirements document must contain valid UTF-8 text, not binary data.',
  MISSING: 'The configured requirements document is missing. Select another PRD.',
  READ_FAILED: 'DevPilot could not read the requirements document. Check file access.',
  SYMLINK: 'Symbolic links are not supported for requirements documents or their parent folders.',
  DISCOVERY_FAILED: 'Document discovery failed. Try again or browse for a supported file.',
  PROJECT_REQUIRED: 'Initialize a DevPilot project before selecting a PRD.',
  SOURCE_NOT_ALLOWED: 'PRD import is available for initializing PRD or PRD + Existing Code projects.',
  BUSY: 'A PRD import is already running.',
} as const;
export class DocumentFailure extends Error {
  constructor(readonly code: keyof typeof messages) { super(messages[code]); this.name = 'DocumentFailure'; }
}
