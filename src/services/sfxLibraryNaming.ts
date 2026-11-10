import { isBgmImportFileName, isUcsImportFileName } from './ucsNaming';

export interface LibraryNamingSource {
  id: string;
  name: string;
  fileName: string;
  path: string;
  category: string;
  subcategory?: string;
  childCategory?: string;
  size: string;
  type: string;
  tags: string[];
}

export interface LibraryNamingChange {
  id: string;
  name: string;
  fileName: string;
  tags: string[];
}

export const needsLibraryNaming = (source: LibraryNamingSource) => (
  source.category === '全部音乐'
    ? !isBgmImportFileName(source.fileName, source.fileName)
    : !isUcsImportFileName(source.fileName, source.fileName)
);

const nameKey = (source: LibraryNamingSource, fileName: string) => JSON.stringify([
  source.category, source.subcategory || '', source.childCategory || '',
  fileName.trim().normalize('NFC').toLocaleLowerCase(),
]);

export function validateLibraryNamingChanges(
  sources: LibraryNamingSource[],
  changes: LibraryNamingChange[],
) {
  const byId = new Map(changes.map(change => [change.id, change]));
  const used = new Map<string, string>();
  for (const source of sources) {
    const change = byId.get(source.id);
    const fileName = (change?.fileName ?? source.fileName).trim();
    if (change) {
      if (!fileName || /[\\/\x00-\x1f<>:"|?*\uFFFD]/.test(fileName)) {
        throw new Error('文件名不能为空，也不能包含路径或损坏字符，请修改后重试。');
      }
      const extension = source.fileName.match(/\.[^.]+$/)?.[0].toLowerCase();
      if (extension && !fileName.toLowerCase().endsWith(extension)) {
        throw new Error('请保留原文件的扩展名，命名不会转换音频格式。');
      }
    }
    const key = nameKey(source, fileName);
    const previousId = used.get(key);
    if (previousId && (change || byId.has(previousId))) {
      throw new Error('同一目录存在重复文件名，请修改建议名称或取消勾选重复项。');
    }
    used.set(key, source.id);
  }
}
