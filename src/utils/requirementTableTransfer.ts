export interface SfxBatchInputRequest {
  id: string;
  text: string;
}

// Quoted TSV keeps multiline descriptions in the same cell when pasted into a table.
export function requirementTableText(headers: readonly string[], rows: readonly unknown[][]) {
  const cell = (value: unknown) => {
    const text = String(value ?? '');
    return /[\t\r\n"]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  return [headers, ...rows].map(row => row.map(cell).join('\t')).join('\n');
}
