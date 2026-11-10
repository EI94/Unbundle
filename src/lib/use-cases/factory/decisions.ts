/**
 * Le decisioni del caso ancora valide (rilascio 8.0a, docs/rilascio-8/RILASCIO-8.0-PIANO.md §2).
 *
 * Le righe di `use_case_decisions` non si cambiano mai: una scelta rifatta aggiunge una decisione nuova. Così una
 * decisione su un argomento dell'impostazione (`topicKey`) è «sostituita» dalla successiva sullo stesso argomento,
 * da qualunque parte venga (il dialogo dell'impostazione, il team, un import); si calcola leggendo. Le decisioni
 * senza argomento dell'impostazione restano tutte valide.
 *
 * Nel brief dei coding agent e nell'elenco della pagina entrano solo quelle valide: mai due scelte in
 * contraddizione sullo stesso argomento.
 *
 * Modulo puro.
 */

export interface DatedDecision {
  id: string;
  /** Il giorno della decisione, `AAAA-MM-GG`. */
  decidedOn: string;
  topicKey: string | null;
  /** Quando è stata scritta: decide tra due decisioni dello stesso giorno. */
  createdAt: string;
}

const newestFirst = (a: DatedDecision, b: DatedDecision) =>
  a.decidedOn !== b.decidedOn ? (a.decidedOn < b.decidedOn ? 1 : -1) : a.createdAt !== b.createdAt ? (a.createdAt < b.createdAt ? 1 : -1) : a.id < b.id ? 1 : -1;

/**
 * Ogni decisione con il giorno in cui è stata sostituita (`supersededOn`, il giorno della decisione successiva
 * sullo stesso argomento), o null se vale ancora. L'ordine di ingresso resta.
 */
export function withSupersession<T extends DatedDecision>(decisions: readonly T[]): Array<T & { supersededOn: string | null }> {
  const replacedOn = new Map<string, string>();
  const newerOnTopic = new Map<string, string>();
  for (const d of [...decisions].sort(newestFirst)) {
    if (d.topicKey === null) continue;
    const newer = newerOnTopic.get(d.topicKey);
    if (newer !== undefined) replacedOn.set(d.id, newer);
    newerOnTopic.set(d.topicKey, d.decidedOn);
  }
  return decisions.map((d) => ({ ...d, supersededOn: replacedOn.get(d.id) ?? null }));
}

/** Solo le decisioni che valgono ancora, nell'ordine di ingresso. */
export function currentDecisions<T extends DatedDecision>(decisions: readonly T[]): T[] {
  const marked = withSupersession(decisions);
  return decisions.filter((_, i) => marked[i].supersededOn === null);
}
