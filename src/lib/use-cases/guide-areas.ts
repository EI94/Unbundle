/**
 * (Rilascio 5, SPEC §11.2, D27, D28) Le aree del filtro «Area» con i nomi della guida del connettore:
 * il valore resta l'id salvato in `intake.area`, a schermo il titolo della guida («Amministrazione e
 * finanza», mai `amministrazione_finanza`). Un'area che la guida non ha si mostra con l'id reso
 * leggibile (trattini e trattini bassi in spazi, la prima lettera maiuscola), mai l'id così com'è.
 *
 * Modulo puro.
 */

const clean = (value: unknown): string | null => (typeof value === "string" && value.replace(/\s+/g, " ").trim() ? value.replace(/\s+/g, " ").trim() : null);

/** id → titolo delle aree della guida (`guide.areas`: `{ id, label }`, anche `nome` o `name`). */
export function guideAreaLabels(areas: unknown): Map<string, string> {
  const out = new Map<string, string>();
  for (const entry of Array.isArray(areas) ? areas : []) {
    if (!entry || typeof entry !== "object") continue;
    const e = entry as Record<string, unknown>;
    const id = clean(e.id);
    const label = clean(e.label) ?? clean(e.nome) ?? clean(e.name);
    if (id && label && !out.has(id)) out.set(id, label);
  }
  return out;
}

/** «amministrazione_finanza» → «Amministrazione finanza»; un testo già leggibile resta com'è. */
export function humaniseAreaId(value: string): string {
  const text = value.replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
  if (!text) return value;
  return text.charAt(0).toLocaleUpperCase("it-IT") + text.slice(1);
}

/** Il titolo di un'area salvata: quello della guida, altrimenti l'id reso leggibile. */
export function areaLabelOf(value: string, labels: ReadonlyMap<string, string>): string {
  return labels.get(value) ?? labels.get(value.trim()) ?? humaniseAreaId(value);
}
