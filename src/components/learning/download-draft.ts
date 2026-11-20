// Explicit user download only: no browser storage and no automatic upload.
// (Rilascio 10, ondata 7a) Un testo si scarica com'è (la copia leggibile delle risposte); un oggetto come JSON.
export function downloadLearningDraft(filename: string, value: unknown) {
  const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
