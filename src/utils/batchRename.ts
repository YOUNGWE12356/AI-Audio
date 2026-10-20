export type RenameRuleType = 'remove' | 'replace' | 'prefix' | 'suffix' | 'number' | 'case' | 'removeRange' | 'regexReplace';
export type RenameCaseMode = 'lower' | 'upper' | 'title';

export interface RenameOperation {
  id: string;
  type: RenameRuleType;
  findText: string;
  replaceText: string;
  insertText?: string;
  numberStart?: number;
  numberPadding?: number;
  numberSeparator?: string;
  caseMode?: RenameCaseMode;
  rangeStart?: number;
  rangeCount?: number;
}

export interface RenameRules {
  operations: RenameOperation[];
  normalizeFileName: boolean;
}

export function getRenamePreviewOperations(rules: RenameRules, throughRuleId: string | null) {
  const index = rules.operations.findIndex(operation => operation.id === throughRuleId);
  return index < 0 ? rules.operations : rules.operations.slice(0, index + 1);
}

export function applyBatchRenameRules(sourceBase: string, fileIndex: number, rules: RenameRules): string {
  // Clean first so explicit rules can remove or replace the generated separators.
  let value = rules.normalizeFileName
    ? sourceBase.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').replace(/\s+/g, '_').replace(/_+/g, '_').replace(/^_+|_+$/g, '')
    : sourceBase;

  for (const operation of rules.operations) {
    switch (operation.type) {
      case 'remove':
        if (operation.findText) value = value.split(operation.findText).join('');
        break;
      case 'replace':
        if (operation.findText) value = value.split(operation.findText).join(operation.replaceText);
        break;
      case 'regexReplace':
        if (operation.findText) {
          try { value = value.replace(new RegExp(operation.findText, 'g'), operation.replaceText); }
          catch { /* Keep invalid expressions from breaking preview or export. */ }
        }
        break;
      case 'prefix': value = `${operation.insertText || ''}${value}`; break;
      case 'suffix': value = `${value}${operation.insertText || ''}`; break;
      case 'number': {
        const start = Number.isFinite(operation.numberStart) ? Number(operation.numberStart) : 1;
        const padding = Math.max(1, Math.min(8, Number(operation.numberPadding) || 3));
        value = `${value}${operation.numberSeparator ?? '_'}${String(start + fileIndex).padStart(padding, '0')}`;
        break;
      }
      case 'case':
        if (operation.caseMode === 'upper') value = value.toUpperCase();
        else if (operation.caseMode === 'title') {
          value = value.toLowerCase().replace(/(^|[\s_\-]+)([\p{L}\p{N}])/gu,
            (_match, separator, char) => `${separator}${String(char).toUpperCase()}`);
        } else value = value.toLowerCase();
        break;
      case 'removeRange': {
        const start = Math.max(1, Number(operation.rangeStart) || 1) - 1;
        const count = Math.max(1, Number(operation.rangeCount) || 1);
        value = `${value.slice(0, start)}${value.slice(start + count)}`;
        break;
      }
    }
  }
  // Enforce filename safety without undoing intentional spaces or separators.
  return value.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').trim() || 'renamed_audio';
}
