import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { renameUidFile } from './utils/fileUtils';

function registerRenameUidHandler(context: vscode.ExtensionContext) {
    let disposable = vscode.workspace.onDidRenameFiles(async (event) => {
        for (const rename of event.files) {
            const oldUri = rename.oldUri;
            const newUri = rename.newUri;
            await renameUidFile(oldUri.fsPath, newUri.fsPath);
        }
    });
    context.subscriptions.push(disposable);
}

function registerSelectSceneCommand(context: vscode.ExtensionContext) {
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

function parseCsv(content: string): Map<string, { origin: string, EN_US: string, PT_BR: string }> {
    const map = new Map<string, { origin: string, EN_US: string, PT_BR: string }>();
    const lines = content.split(/\r?\n/).filter(l => l.trim().length > 0);
    for (let i = 1; i < lines.length; i++) { // skip header
        const match = lines[i].match(/^"([^"]+)","([^"]*)","([^"]*)","([^"]*)"$/);
        if (match) {
            const [, token, origin, EN_US, PT_BR] = match;
            map.set(token, { origin, EN_US, PT_BR });
        }
    }
    return map;
}

function escapeCsv(str: string) {
    return `"${str.replace(/"/g, '""')}"`;
}

function registerExtractTokensAllCommand(context: vscode.ExtensionContext) {
    context.subscriptions.push(
        vscode.commands.registerCommand('ls-locale.extractTokensAll', async () => {
            const workspaceFolders = vscode.workspace.workspaceFolders;
            if (!workspaceFolders) {
                vscode.window.showErrorMessage('No workspace folder open.');
                return;
            }

            // Map token -> Set of file paths
            const tokenMap = new Map<string, Set<string>>();
            const tokenRegex = /(["'`])\{([^}]+)\}\1/g;

            const excludedFiles = await getExcludedFiles();

            async function scanDir(dir: string) {
                const entries = await fs.promises.readdir(dir, { withFileTypes: true });
                for (const entry of entries) {
                    const fullPath = path.join(dir, entry.name);

                    // Skip excluded files (relative to workspace root)
                    if (excludedFiles.some(excluded => fullPath.endsWith(excluded))) {
                        continue;
                    }

                    if (entry.isDirectory()) {
                        await scanDir(fullPath);
                    } else if (entry.isFile()) {
                        const ext = path.extname(entry.name).toLowerCase();
                        if (['.cs', '.tscn'].includes(ext)) {
                            try {
                                const content = await fs.promises.readFile(fullPath, 'utf8');
                                let match;
                                // For C# files, skip tokens inside interpolated strings ($"...")
                                if (ext === '.cs') {
                                    const interpolatedStringRegex = /\$@?"(?:[^"\\]|\\.)*"/g;
                                    let filteredContent = content.replace(interpolatedStringRegex, '');
                                    while ((match = tokenRegex.exec(filteredContent)) !== null) {
                                        const token = match[2];
                                        if (!tokenMap.has(token)) tokenMap.set(token, new Set());
                                        tokenMap.get(token)!.add(fullPath);
                                    }
                                } else {
                                    while ((match = tokenRegex.exec(content)) !== null) {
                                        const token = match[2];
                                        if (!tokenMap.has(token)) tokenMap.set(token, new Set());
                                        tokenMap.get(token)!.add(fullPath);
                                    }
                                }
                            } catch { /* ignore errors */ }
                        }
                    }
                }
            }

            for (const folder of workspaceFolders) {
                await scanDir(folder.uri.fsPath);
            }

            if (tokenMap.size === 0) {
                vscode.window.showInformationMessage('No tokens found in workspace.');
                return;
            }

            // Ask where to save
            const uri = await vscode.window.showSaveDialog({
                filters: { 'CSV': ['csv'] },
                saveLabel: 'Save Language Template CSV'
            });
            if (!uri) return;

            // Try to read existing CSV
            let existingMap = new Map<string, { origin: string, EN_US: string, PT_BR: string }>();
            try {
                const existingContent = await fs.promises.readFile(uri.fsPath, 'utf8');
                existingMap = parseCsv(existingContent);
            } catch { /* file may not exist, ignore */ }

            // Merge tokens
            const allTokens = new Set([...tokenMap.keys(), ...existingMap.keys()]);
            const csvLines = ['token,origin,EN_US,PT_BR'];
            for (const token of Array.from(allTokens).sort()) {
                const origins = Array.from(tokenMap.get(token) || [existingMap.get(token)?.origin || '']).join(';');
                const EN_US = existingMap.get(token)?.EN_US || '';
                const PT_BR = existingMap.get(token)?.PT_BR || '';
                csvLines.push([escapeCsv(token), escapeCsv(origins), escapeCsv(EN_US), escapeCsv(PT_BR)].join(','));
            }
            const csvContent = csvLines.join('\n');

            await fs.promises.writeFile(uri.fsPath, csvContent, 'utf8');
            vscode.window.showInformationMessage(`Language template saved: ${uri.fsPath}`);
        })
    );
}

function registerExtractTokensCurrentFileCommand(context: vscode.ExtensionContext) {
    context.subscriptions.push(
        vscode.commands.registerCommand('ls-locale.extractTokensCurrentFile', async () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor) {
                vscode.window.showErrorMessage('No active editor.');
                return;
            }
            const tokenSet = new Set<string>();
            const tokenRegex = /(["'`])\{([^}]+)\}\1/g;
            const content = editor.document.getText();
            let match;
            while ((match = tokenRegex.exec(content)) !== null) {
                tokenSet.add(match[2]);
            }
            if (tokenSet.size === 0) {
                vscode.window.showInformationMessage('No tokens found in current file.');
                return;
            }
            // Header: token,origin,EN_US,PT_BR
            const csvLines = ['token,origin,EN_US,PT_BR'];
            const filePath = editor.document.uri.fsPath;
            for (const token of Array.from(tokenSet).sort()) {
                csvLines.push(`"${token}","${filePath}","",""`);
            }
            const csvContent = csvLines.join('\n');
            const uri = await vscode.window.showSaveDialog({
                filters: { 'CSV': ['csv'] },
                saveLabel: 'Save Language Template CSV'
            });
            if (!uri) return;
            await fs.promises.writeFile(uri.fsPath, csvContent, 'utf8');
            vscode.window.showInformationMessage(`Language template saved: ${uri.fsPath}`);
        })
    );
}

function parseCsvColumns(content: string): { columns: string[], rows: Record<string, string>[] } {
    const lines = content.split(/\r?\n/).filter(l => l.trim().length > 0);
    const columns = lines[0].split(',').map(c => c.replace(/^"|"$/g, ''));
    const rows: Record<string, string>[] = [];
    for (let i = 1; i < lines.length; i++) {
        const matches = [...lines[i].matchAll(/"((?:[^"]|"")*)"/g)].map(m => m[1].replace(/""/g, '"'));
        if (matches.length === columns.length) {
            const row: Record<string, string> = {};
            columns.forEach((col, idx) => row[col] = matches[idx]);
            rows.push(row);
        }
    }
    return { columns, rows };
}

function parseTokensDict(text: string): Record<string, string> {
    // Extract the dictionary string
    const dictMatch = text.match(/_tokens\s*=\s*Dictionary\[String, String\]\(\{([\s\S]*?)\}\)/);
    if (!dictMatch) return {};
    const dictBody = dictMatch[1];
    const regex = /"(\{[^"]+\})":\s*"((?:[^"\\]|\\.)*)"/g;
    const dict: Record<string, string> = {};
    let match;
    while ((match = regex.exec(dictBody)) !== null) {
        dict[match[1]] = match[2];
    }
    return dict;
}

function serializeTokensDict(dict: Record<string, string>): string {
    const entries = Object.entries(dict).map(
        ([k, v]) => `"${k}": "${v.replace(/"/g, '\\"')}"`
    );
    return `_tokens = Dictionary[String, String]({\n${entries.join(',\n')}\n})`;
}

async function updateLanguageTresFile(tresPath: string, updates: Record<string, string>) {
    let content = await fs.promises.readFile(tresPath, 'utf8');
    const dict = parseTokensDict(content);
    let changed = false;
    for (const [token, value] of Object.entries(updates)) {
        if (dict[token] !== value) {
            dict[token] = value;
            changed = true;
        }
    }
    if (changed) {
        // Replace the _tokens dictionary in the file
        const newDictStr = serializeTokensDict(dict);
        content = content.replace(/_tokens\s*=\s*Dictionary\[String, String\]\(\{[\s\S]*?\}\)/, newDictStr);
        await fs.promises.writeFile(tresPath, content, 'utf8');
    }
}

function registerAddUpdateLanguageCommand(context: vscode.ExtensionContext) {
    context.subscriptions.push(
        vscode.commands.registerCommand('ls-locale.addUpdateLanguage', async () => {
            // 1. Select CSV file
            const csvUris = await vscode.window.showOpenDialog({
                filters: { 'CSV': ['csv'] },
                canSelectMany: false,
                openLabel: 'Select Language CSV'
            });
            if (!csvUris || csvUris.length === 0) return;
            const csvPath = csvUris[0].fsPath;
            const csvContent = await fs.promises.readFile(csvPath, 'utf8');
            const { columns, rows } = parseCsvColumns(csvContent);

            // 2. For each language column (except token, origin)
            for (const langCol of columns) {
                if (langCol === 'token' || langCol === 'origin') continue;
                const lang = langCol; // e.g., EN_US
                // 3. Find assets/<LANG>.tres
                const workspaceFolders = vscode.workspace.workspaceFolders;
                if (!workspaceFolders) continue;
                const langTresPath = path.join(workspaceFolders[0].uri.fsPath, 'assets', `${lang}.tres`);
                if (!fs.existsSync(langTresPath)) {
                    vscode.window.showWarningMessage(`File not found: ${langTresPath}`);
                    continue;
                }
                // 4. Build updates
                const updates: Record<string, string> = {};
                for (const row of rows) {
                    if (row.token && row[langCol]) {
                        updates[row.token] = row[langCol];
                    }
                }
                // 5. Update .tres file
                await updateLanguageTresFile(langTresPath, updates);
            }
            vscode.window.showInformationMessage('Language files updated.');
        })
    );
}

// In activate():
export function activate(context: vscode.ExtensionContext) {
    registerRenameUidHandler(context);
    registerSelectSceneCommand(context);
    registerExtractTokensCurrentFileCommand(context);
    registerExtractTokensAllCommand(context);
    registerAddUpdateLanguageCommand(context); // <-- Add this line
}

export function deactivate() { }

async function getExcludedFiles(): Promise<string[]> {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) return [];
    const blacklistPath = path.join(workspaceFolders[0].uri.fsPath, '.vscode', 'locale_tokens_blacklist.txt');
    try {
        const content = await fs.promises.readFile(blacklistPath, 'utf8');
        // Split by line, trim, and filter out empty lines
        return content.split(/\r?\n/).map(line => line.trim()).filter(line => line.length > 0);
    } catch {
        return [];
    }
}