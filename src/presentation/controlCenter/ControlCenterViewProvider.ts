import * as vscode from 'vscode';
import type { ControlCenterState } from '../../application/controlCenterState';
import { renderControlCenter } from './renderControlCenter';

export class ControlCenterViewProvider implements vscode.WebviewViewProvider, vscode.Disposable {
  static readonly viewType = 'devpilot.controlCenter';
  private view: vscode.WebviewView | undefined;
  private viewDisposalSubscription: vscode.Disposable | undefined;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly readState: () => ControlCenterState,
  ) {}

  resolveWebviewView(view: vscode.WebviewView): void {
    this.dispose();
    this.view = view;
    const mediaRoot = vscode.Uri.joinPath(this.extensionUri, 'media');
    view.webview.options = {
      enableScripts: false,
      localResourceRoots: [mediaRoot],
    };
    this.viewDisposalSubscription = view.onDidDispose(() => this.dispose());
    this.refresh();
  }

  refresh(): void {
    if (!this.view) {
      return;
    }
    const webview = this.view.webview;
    webview.html = renderControlCenter(this.readState(), {
      stylesheetUri: webview.asWebviewUri(
        vscode.Uri.joinPath(this.extensionUri, 'media', 'controlCenter.css'),
      ).toString(),
      cspSource: webview.cspSource,
    });
  }

  dispose(): void {
    this.viewDisposalSubscription?.dispose();
    this.viewDisposalSubscription = undefined;
    this.view = undefined;
  }
}
