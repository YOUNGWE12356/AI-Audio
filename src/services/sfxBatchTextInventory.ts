import { SFX_BATCH_MAX_ROWS } from './sfxBatch';
import type { BatchSourceRow } from './sfxBatchTableAnalysis';

/** Only accept formats whose row boundaries can be proven without interpretation. */
export function readBatchTextRows(text: string): BatchSourceRow[] | null {
  const source = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').trim();
  if (!source) return null;
  const row = (rawText: string, index: number, name = ''): BatchSourceRow => ({
    sourceRowId: `row-${index + 1}`, name, rawText, kind: 'pending', reason: '',
  });
  const checked = (rows: BatchSourceRow[]) => {
    if (rows.length > SFX_BATCH_MAX_ROWS) throw Object.assign(new Error(`原表超过${SFX_BATCH_MAX_ROWS}条需求，请拆分后分析，未截断导入。`), { status: 400 });
    return rows;
  };

  // Require a recognized header and a consistent rectangular table. Unquoted
  // multiline cells, grouping rows, blank/merged cells and extra notes fall back
  // to the independent AI inventory/review path rather than guessing boundaries.
  for (const delimiter of ['\t', ',', '|']) {
    // The XLSX reader prefixes a sheet label. Only one plain worksheet is safe;
    // multi-sheet or grouped workbooks retain the full independent review.
    const tableText = source.replace(/^工作表 1\n/, '');
    const records = readDelimited(tableText, delimiter);
    if (!records || records.length < 2) continue;
    const header = records[0].cells.map(cell => cell.trim());
    const nameColumn = header.findIndex(cell => /^(?:音效名称|音效命名|原命名|命名|名称|name)$/i.test(cell));
    const descriptionColumn = header.findIndex(cell => /^(?:音效描述|需求描述|声音描述|描述|description)$/i.test(cell));
    if (nameColumn < 0 || descriptionColumn < 0 || header.length < 2 || header.some(cell => !cell)) continue;
    const data = records.slice(1);
    if (delimiter === '|' && data[0]?.cells.every(cell => /^:?-{3,}:?$/.test(cell.trim()))) data.shift();
    if (!data.length || data.some(record => record.cells.length !== header.length || record.cells.some(cell => !cell.trim()))) continue;
    const numberColumn = header.findIndex(cell => /^(?:序号|编号|序|no\.?|index)$/i.test(cell));
    if (numberColumn >= 0 && data.some((record, index) => Number(record.cells[numberColumn]) !== index + 1)) continue;
    return checked(data.map((record, index) => row(record.raw, index, record.cells[nameColumn].trim())));
  }

  // A numbered list must start at one, be consecutive, and account for every
  // line. Only indented continuations belong to the preceding requirement.
  const rows: BatchSourceRow[] = [];
  for (const line of source.split('\n')) {
    if (!line.trim()) continue;
    const match = /^\s*(?:\((\d+)\)|（(\d+)）|(\d+)[、.)．）])\s*(\S.*)$/.exec(line);
    if (match) {
      if (Number(match[1] || match[2] || match[3]) !== rows.length + 1) return null;
      rows.push(row(line, rows.length));
    } else if (rows.length && /^(?: {2,}|\t)\S/.test(line)) rows[rows.length - 1].rawText += `\n${line}`;
    else return null;
  }
  return rows.length >= 2 ? checked(rows) : null;
}

function readDelimited(text: string, delimiter: string): Array<{ cells: string[]; raw: string }> | null {
  // Pipe tables have optional outer borders, not CSV-style quotes.
  if (delimiter === '|') {
    const records = text.split('\n').filter(line => line.trim()).map(raw => ({ raw,
      cells: raw.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(cell => cell.trim()),
    }));
    return records.every(record => record.cells.length >= 2) ? records : null;
  }
  let cells: string[] = [], value = '', quoted = false, closed = false, start = 0;
  const records: Array<{ cells: string[]; raw: string }> = [];
  const cell = () => { cells.push(value); value = ''; closed = false; };
  for (let i = 0; i <= text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === undefined) return null;
      if (char === '"') {
        if (text[i + 1] === '"') { value += '"'; i++; }
        else { quoted = false; closed = true; }
      } else value += char;
    } else if (char === delimiter) cell();
    else if (char === '\n' || char === undefined) {
      cell();
      const raw = text.slice(start, i);
      if (raw.trim()) records.push({ cells, raw });
      cells = []; start = i + 1;
    } else if (char === '"' && !value && !closed) quoted = true;
    else {
      if (closed || char === '"') return null;
      value += char;
    }
  }
  return records;
}
