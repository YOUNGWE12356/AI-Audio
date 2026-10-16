// OCR line wrapping is layout, not a spoken pause or a space inside a CJK word.
export const normalizeSubtitleText = (value: unknown) => String(value || '').trim()
  .replace(/\s+/g, ' ')
  .replace(/([\u3000-\u30ff\u3400-\u9fff]) +(?=[\u3000-\u30ff\u3400-\u9fff])/g, '$1');
