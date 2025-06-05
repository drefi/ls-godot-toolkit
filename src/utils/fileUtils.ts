import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

export function isCSharpFile(filePath: string): boolean {
    return filePath.endsWith('.cs');
}

export async function renameUidFile(oldFilePath: string, newFilePath: string): Promise<void> {
    // Look for .cs.uid, not .uid
    const uidFilePath = oldFilePath + '.uid';
    const newUidFilePath = newFilePath + '.uid';

    if (fs.existsSync(uidFilePath)) {
        try {
            fs.renameSync(uidFilePath, newUidFilePath);
            vscode.window.showInformationMessage(`UID file renamed: ${path.basename(uidFilePath)} → ${path.basename(newUidFilePath)}`);
        } catch (err) {
            vscode.window.showErrorMessage(`Failed to rename UID file: ${err}`);
        }
    } else {
        vscode.window.showWarningMessage(`UID file not found: ${path.basename(uidFilePath)}`);
    }
}