// Explicit user download only: no browser storage and no automatic upload.
export function downloadLearningDraft(filename: string, value: unknown) {
  const blob = new Blob([JSON.stringify(value, null, 2)], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
