/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Downloads an audio blob or URL by uploading it to the server first
 * and then requesting an attachment download to bypass iframe sandbox restrictions.
 */
export async function downloadAudioHelper(
  audioUrlOrBlob: string | Blob,
  defaultFilename: string
): Promise<void> {
  try {
    let blob: Blob;

    if (typeof audioUrlOrBlob === 'string') {
      if (audioUrlOrBlob.startsWith('blob:')) {
        const response = await fetch(audioUrlOrBlob);
        blob = await response.blob();
      } else {
        // It's a standard relative or absolute URL (e.g. /uploads/...)
        const relativePath = audioUrlOrBlob.startsWith('/') ? audioUrlOrBlob.slice(1) : audioUrlOrBlob;
        const triggerUrl = `/api/sfx/download-file?path=${encodeURIComponent(relativePath)}&name=${encodeURIComponent(defaultFilename)}`;
        const a = document.createElement('a');
        a.href = triggerUrl;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        return;
      }
    } else {
      blob = audioUrlOrBlob;
    }

    // Upload the blob to the server using the existing raw upload endpoint
    const response = await fetch('/api/sfx/upload', {
      method: 'POST',
      headers: {
        'x-filename': defaultFilename,
        'Content-Type': 'audio/mpeg',
      },
      body: blob,
    });

    if (!response.ok) {
      throw new Error('Upload failed');
    }

    const data = await response.json();
    const relativePath = data.url.startsWith('/') ? data.url.slice(1) : data.url;

    // Trigger attachment download from the server
    const downloadUrl = `/api/sfx/download-file?path=${encodeURIComponent(relativePath)}&name=${encodeURIComponent(defaultFilename)}`;
    const a = document.createElement('a');
    a.href = downloadUrl;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  } catch (error) {
    console.error('Programmatic download failed, falling back to blob URL download:', error);
    
    // Resilient fallback to basic anchor download
    if (typeof audioUrlOrBlob === 'string') {
      const a = document.createElement('a');
      a.href = audioUrlOrBlob;
      a.download = defaultFilename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    }
  }
}
