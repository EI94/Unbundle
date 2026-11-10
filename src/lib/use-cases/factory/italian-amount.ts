/**
 * Un numero scritto all'italiana nei moduli del progetto dell'agente (rilascio 8.0a): «1.200» è milleduecento,
 * «12,5» e «12.5» dodici e mezzo, «1.200,50» milleduecento e cinquanta. Vuoto = null; qualunque altra cosa = NaN,
 * così il modulo dice l'errore accanto al campo invece di salvare un numero sbagliato.
 *
 * Modulo puro.
 */
export function italianAmount(text: string): number | null {
  const t = text.trim().replace(/\s+/g, "");
  if (t === "") return null;
  if (/^\d+(\.\d{3})*,\d+$/.test(t) || /^\d{1,3}(\.\d{3})+$/.test(t)) return Number(t.replace(/\./g, "").replace(",", "."));
  if (/^\d+([.,]\d+)?$/.test(t)) return Number(t.replace(",", "."));
  return Number.NaN;
}
