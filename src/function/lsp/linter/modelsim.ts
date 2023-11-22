import * as vscode from "vscode";
import * as fs from 'fs';

import { LspOutput, ReportType, opeParam } from "../../../global";
import { Path } from "../../../../resources/hdlParser";
import { hdlFile, hdlPath } from "../../../hdlFs";
import { easyExec } from "../../../global/util";
import { BaseLinter } from "./base";
import { HdlLangID } from "../../../global/enum";

class ModelsimLinter implements BaseLinter {
    diagnostic: vscode.DiagnosticCollection;
    executableFileMap: Map<HdlLangID, string | undefined> = new Map<HdlLangID, string>();
    executableInvokeNameMap: Map<HdlLangID, string | undefined> = new Map<HdlLangID, string>();
    linterArgsMap: Map<HdlLangID, string[]> = new Map<HdlLangID, string[]>();

    constructor() {
        this.diagnostic = vscode.languages.createDiagnosticCollection();
        
        // configure map for executable file name
        this.executableFileMap.set(HdlLangID.Verilog, 'vlog');
        this.executableFileMap.set(HdlLangID.Vhdl, 'vcom');
        this.executableFileMap.set(HdlLangID.SystemVerilog, 'vlog');
        this.executableFileMap.set(HdlLangID.Unknown, undefined);

        // configure map for argruments when lintering
        this.linterArgsMap.set(HdlLangID.Verilog, ['-quiet', '-nologo']);
        this.linterArgsMap.set(HdlLangID.Vhdl, ['-quiet', '-nologo', '-2008']);
        this.linterArgsMap.set(HdlLangID.SystemVerilog, ['-quiet', '-nolog', '-sv']);
        this.linterArgsMap.set(HdlLangID.Unknown, []);
    }

        
    async lint(document: vscode.TextDocument) {
        const filePath = hdlPath.toSlash(document.fileName);
        const langID = hdlFile.getLanguageId(filePath);

        // acquire install path
        const linterArgs = this.linterArgsMap.get(langID);
        
        if (linterArgs === undefined) {
            return;
        }

        const args = [filePath, ...linterArgs];
        const executor = this.executableInvokeNameMap.get(langID);
        if (executor !== undefined) {
            const { stdout } = await easyExec(executor, args);
            if (stdout.length > 0) {
                const diagnostics = this.provideDiagnostics(document, stdout);
                this.diagnostic.set(document.uri, diagnostics);
            }
        } else {
            LspOutput.report('linter is not available, please check prj.modelsim.install.path in your setting', ReportType.Error);
        }
    }

    /**
     * @param document
     * @param stdout stdout from xvlog
     * @returns { vscode.Diagnostic[] } linter info
     */
    private provideDiagnostics(document: vscode.TextDocument, stdout: string): vscode.Diagnostic[] {
        const diagnostics = [];
        for (const line of stdout.split('\n')) {
            const tokens = line.split(/(Error|Warning).+?(?: *?(?:.+?(?:\\|\/))+.+?\((\d+?)\):|)(?: *?near "(.+?)":|)(?: *?\((.+?)\)|) +?(.+)/gm);
            
            
            const headerInfo = tokens[0];
            if (headerInfo === 'Error') {
                const errorLine = parseInt(tokens[2]) - 1;
                const syntaxInfo = tokens[5];
                const range = this.makeCorrectRange(document, errorLine);
                const diag = new vscode.Diagnostic(range, syntaxInfo, vscode.DiagnosticSeverity.Error);
                diagnostics.push(diag);
            } else if (headerInfo == 'Warning') {
                const errorLine = parseInt(tokens[2]) - 1;
                const syntaxInfo = tokens[5];
                const range = this.makeCorrectRange(document, errorLine);
                const diag = new vscode.Diagnostic(range, syntaxInfo, vscode.DiagnosticSeverity.Warning);
                diagnostics.push(diag);  
            }
        }
        return diagnostics;
    }

    private makeCorrectRange(document: vscode.TextDocument, line: number): vscode.Range {
        const startPosition = new vscode.Position(line, 0);
        const wordRange = document.getWordRangeAtPosition(startPosition, /[`_0-9a-zA-Z]+/);
        if (wordRange) {
            return wordRange;
        } else {
            return new vscode.Range(startPosition, startPosition);
        }
    }

    private getExecutableFilePath(langID: HdlLangID): string | Path | undefined {
        // modelsim install path stored in prj.modelsim.install.path
        const modelsimConfig = vscode.workspace.getConfiguration('prj.modelsim');
        const modelsimInstallPath = modelsimConfig.get('install.path', '');
        const executorName = this.executableFileMap.get(langID);
        if (executorName === undefined) {
            return undefined;
        }
        
        // e.g. vlog.exe in windows, vlog in linux
        const fullExecutorName = opeParam.os === 'win32' ? executorName + '.exe' : executorName;
        
        if (modelsimInstallPath.trim() === '' || !fs.existsSync(modelsimInstallPath)) {
            LspOutput.report(`User's modelsim Install Path ${modelsimInstallPath}, which is invalid. Use ${executorName} in default.`, ReportType.Warn);
            LspOutput.report('If you have doubts, check prj.modelsim.install.path in setting', ReportType.Warn);
            return executorName;
        } else {
            LspOutput.report(`User's modelsim Install Path ${modelsimInstallPath}, which is invalid`);
            
            const executorPath = hdlPath.join(
                hdlPath.toSlash(modelsimInstallPath),
                fullExecutorName
            );
            // prevent path like C://stupid name/xxx/xxx/bin
            // blank space
            const safeExecutorPath = '"' + executorPath + '"';
            return safeExecutorPath;
        }
    }


    public async setExecutableFilePath(executorPath: string | Path | undefined, langID: HdlLangID): Promise<boolean> {
        if (executorPath === undefined) {
            return false;
        }
        const { stderr } = await easyExec(executorPath, []);
        if (stderr.length === 0) {
            this.executableInvokeNameMap.set(langID, undefined);
            LspOutput.report(`fail to execute ${executorPath}! Reason: ${stderr}`, ReportType.Error);
            return false;
        } else {
            this.executableInvokeNameMap.set(langID, executorPath);
            LspOutput.report(`success to verify ${executorPath}, linter from modelsim is ready to go!`, ReportType.Launch);
            return true;
        }
    }

    public initialise(langID: HdlLangID) {
        const executorPath = this.getExecutableFilePath(langID);
        this.setExecutableFilePath(executorPath, langID);
    }
}

const modelsimLinter = new ModelsimLinter()

export {
    modelsimLinter,
    ModelsimLinter
};
