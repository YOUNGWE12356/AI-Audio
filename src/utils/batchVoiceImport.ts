// Compare bytes rather than names/size: clipboard copies can have different
// names, while two different screenshots can have the same name and size.
export async function deduplicateBatchVoiceImages(files: File[]): Promise<File[]> {
  const unique: File[] = [];
  const imagesBySize = new Map<number, Array<{ file: File; bytes?: Uint8Array }>>();
  for (const file of files) {
    if (!file.type.startsWith('image/')) {
      unique.push(file);
      continue;
    }
    const candidates = imagesBySize.get(file.size) || [];
    let bytes: Uint8Array | undefined;
    let duplicate = false;
    for (const candidate of candidates) {
      if (candidate.file === file) {
        duplicate = true;
        break;
      }
      bytes ||= new Uint8Array(await file.arrayBuffer());
      candidate.bytes ||= new Uint8Array(await candidate.file.arrayBuffer());
      if (bytes.every((value, index) => value === candidate.bytes![index])) {
        duplicate = true;
        break;
      }
    }
    if (!duplicate) {
      candidates.push({ file, bytes });
      imagesBySize.set(file.size, candidates);
      unique.push(file);
    }
  }
  return unique;
}
