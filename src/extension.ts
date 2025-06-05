import * as vscode from 'vscode';
import * as path from 'path';
import { renameUidFile } from './utils/fileUtils';

export function activate(context: vscode.ExtensionContext) {
    let disposable = vscode.workspace.onDidRenameFiles(async (event) => {
        for (const rename of event.files) {
            const oldUri = rename.oldUri;
            const newUri = rename.newUri;

            // Pass the full filename (with extension) to fileUtils, which will append .uid
            await renameUidFile(oldUri.fsPath, newUri.fsPath);
        }
    });
    context.subscriptions.push(disposable);

    context.subscriptions.push(
        vscode.commands.registerCommand('godot.csharp.selectScene', async () => {
            const files = await vscode.workspace.findFiles('**/*.tscn');
            if (files.length === 0) {
                vscode.window.showWarningMessage('No Godot scenes found.');
                return;
            }

            const items = files.map(f => ({
                label: path.relative(vscode.workspace.rootPath || '', f.fsPath),
                fsPath: f.fsPath
            }));

            const picked = await vscode.window.showQuickPick(items, {
                placeHolder: 'Select a Godot scene to launch'
            });

            if (picked) {
                await vscode.workspace.getConfiguration('godot.csharp').update(
                    'latestScene',
                    picked.label,
                    vscode.ConfigurationTarget.Workspace
                );
                vscode.window.showInformationMessage(`Godot launch scene set to: ${picked.label}`);
            }
        })
    );
}

export function deactivate() { }