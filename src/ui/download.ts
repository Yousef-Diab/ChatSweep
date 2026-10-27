/** Saves bytes as a file via a temporary <a download>. No `downloads` permission needed. */
export function downloadBytes(bytes: Uint8Array, filename: string, type = 'application/zip'): void {
  const blob = new Blob([new Uint8Array(bytes)], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
