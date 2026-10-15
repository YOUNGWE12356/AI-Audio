import JSZip from 'jszip';

const xmlText = (text: string) => text.replace(/<[^>]*>/g, '').replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)))
  .replace(/&#([0-9]+);/g, (_, code) => String.fromCodePoint(Number(code))).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');

export async function readAssistantDocument(bytes: Buffer, name: string) {
  if (/\.(txt|md|csv|tsv|json|html|htm)$/i.test(name)) return bytes.toString('utf8');
  if (!/\.(docx|xlsx)$/i.test(name)) throw new Error('支持TXT/MD/CSV/TSV/JSON/DOCX/XLSX；旧XLS请另存为XLSX。图片请用截图识别。');
  const zip = await JSZip.loadAsync(bytes);
  const readXml = async (file: string) => {
    const entry = zip.file(file);
    if (!entry) return '';
    const text = await entry.async('string');
    if (text.length > 5_000_000) throw new Error('文档展开后过大，请拆分。');
    return text;
  };
  if (/\.docx$/i.test(name)) return xmlText((await readXml('word/document.xml')).replace(/<\/w:p>/g, '\n').replace(/<w:tab\b[^>]*\/>/g, '\t')).trim();
  const shared = ((await readXml('xl/sharedStrings.xml')).match(/<si\b[^>]*>[\s\S]*?<\/si>/g) || []).map(xmlText);
  const sheets = Object.keys(zip.files).filter(file => /^xl\/worksheets\/sheet\d+\.xml$/i.test(file)).sort();
  const output = [];
  for (const sheet of sheets) {
    const rows = (await readXml(sheet)).match(/<row\b[^>]*>[\s\S]*?<\/row>/g) || [];
    output.push(rows.map(row => (row.match(/<c\b[^>]*>[\s\S]*?<\/c>/g) || []).map(cell => {
      if (/\bt="inlineStr"/.test(cell)) return xmlText(cell.replace(/<f\b[^>]*>[\s\S]*?<\/f>/g, ''));
      const value = xmlText(/<v\b[^>]*>([\s\S]*?)<\/v>/.exec(cell)?.[1] || '');
      return /\bt="s"/.test(cell) ? shared[Number(value)] || '' : value;
    }).join('\t')).join('\n'));
  }
  return output.join('\n\n').trim();
}
