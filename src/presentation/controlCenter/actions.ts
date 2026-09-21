/** Only these static commands may be invoked by the script-free webview. */
export const controlCenterActions = {
  openFolder: 'devpilot.openFolder',
  refresh: 'devpilot.refreshModels',
  select: 'devpilot.selectModel',
  clear: 'devpilot.clearModel',
  test: 'devpilot.testModel',
  initialize: 'devpilot.initializeProject',
} as const;

export type ControlCenterAction = keyof typeof controlCenterActions;
