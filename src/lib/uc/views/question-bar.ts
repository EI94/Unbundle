/**
 * La barra di Domande (rilascio 10, docs/ui-10/PROPOSTA-10.md §3.5): «Cerca» · «Filtri (n)» · «Seleziona» · «File
 * (6)». Qui i campi del foglio «Filtri» per il pezzo comune `FilterChips` e i parametri dell'indirizzo che la barra
 * tiene. Ogni campo è un parametro di oggi (`parseQuestionFilter`): un link condiviso apre gli stessi filtri.
 *
 * - Lateral Space: Referente, Argomento, Chi risponde, Stato («A posto» e gli stati di dettaglio), Riservatezza,
 *   Contratto, Domande (le indispensabili), Mostra («Documenti», «Tutto il catalogo») e, con il catalogo, Tipo.
 * - Il cliente: Referente (solo «Senza referente», mai una persona, art. 15.4), Argomento, Chi risponde, Stato (solo
 *   «A posto»), Contratto, Domande, Mostra («Documenti»).
 * - Lo sviluppatore: Argomento e Mostra («Documenti»).
 *
 * Modulo puro: i tipi dei campi sono quelli di `FilterChips`, scritti qui senza importare il componente.
 */
import { STATUS_LABEL } from "../semaforo.ts";
import { ITEM_STATUSES, PRIVACY_CLASSES } from "../vocab.ts";
import { A_POSTO, NONE, questionQuery, type QuestionAudience, type QuestionDefaults, type QuestionFilter } from "./catalog-filter.ts";
import { DOMANDE_TEXT } from "./domande-text.ts";
import { formatCountIt } from "./format.ts";
import { KIND_LABEL, KIND_ORDER, PRIVACY_LABEL, WORDS } from "./labels.ts";

export interface QuestionFilterOption {
  value: string;
  label: string;
  /** Il testo del chip, se diverso dalla voce del foglio. */
  chip?: string;
}

/** Un campo del foglio «Filtri» (la forma di `FilterField` di `FilterChips`). */
export interface QuestionFilterField {
  key: string;
  label: string;
  options: QuestionFilterOption[];
  value: string | null;
  placeholder?: string;
}

/** Le voci dei campi che dipendono dal caso. */
export interface QuestionFilterOptions {
  /** I referenti (per Lateral Space). */
  contacts: { id: string; name: string }[];
  modules: { key: string; title: string }[];
  roles: { key: string; label: string }[];
  /** Ci sono domande «Fuori contratto» (o il filtro è già attivo): solo allora «Contratto». */
  contract: boolean;
  /** Voci di ogni tipo, per «Tutto il catalogo (2.812)»: solo Lateral Space. */
  catalogSize: number | null;
  /** Per tipo, con il catalogo intero. */
  kindCounts: Record<string, number> | null;
  /** Domande senza referente, per «Senza referente (137)» (al posto della riga «… · Affida a… ›» di ieri). */
  unassigned: number;
}

/** I campi del foglio «Filtri» per chi guarda, con i valori di adesso. Un campo senza voci non c'è. */
export function questionFilterFields(filter: QuestionFilter, defaults: QuestionDefaults, audience: QuestionAudience, options: QuestionFilterOptions): QuestionFilterField[] {
  const t = DOMANDE_TEXT.filters;
  const ls = audience === "ls";
  const dev = audience === "sviluppatore";
  const fields: QuestionFilterField[] = [];
  if (!dev) {
    const people = ls ? options.contacts.map((c) => ({ value: c.id, label: c.name })) : [];
    fields.push({ key: "referente", label: t.referente, value: filter.referente, options: [{ value: NONE, label: t.senzaReferenteCount(options.unassigned), chip: t.senzaReferente }, ...people] });
  }
  if (options.modules.length > 0 || filter.argomento) {
    const topics = options.modules.map((m) => ({ value: m.key, label: m.title }));
    // «Senza argomento» si apre dal suo gruppo; nel foglio c'è quando è il filtro di adesso, per il suo chip.
    if (filter.argomento === NONE) topics.push({ value: NONE, label: DOMANDE_TEXT.noTopic });
    else if (filter.argomento && !topics.some((o) => o.value === filter.argomento)) topics.push({ value: filter.argomento, label: DOMANDE_TEXT.otherTopic });
    fields.push({ key: "argomento", label: t.argomento, value: filter.argomento, options: topics });
  }
  if (!dev && options.roles.length > 0) fields.push({ key: "ruolo", label: t.chiRisponde, value: filter.ruolo, options: options.roles.map((r) => ({ value: r.key, label: r.label })) });
  if (!dev) {
    const details = ls ? ITEM_STATUSES.map((s) => ({ value: s, label: s === "validata" ? t.validata : STATUS_LABEL[s] })) : [];
    fields.push({ key: "stato", label: t.stato, value: filter.stato, options: [{ value: A_POSTO, label: t.aPosto }, ...details] });
  }
  if (ls) fields.push({ key: "riservatezza", label: t.riservatezza, value: filter.riservatezza, options: PRIVACY_CLASSES.map((p) => ({ value: p, label: PRIVACY_LABEL[p] })) });
  if (!dev && (options.contract || filter.perimetro)) {
    fields.push({
      key: "perimetro",
      label: t.contratto,
      value: filter.perimetro,
      options: [
        { value: "nel", label: WORDS.nelContratto },
        { value: "fuori", label: WORDS.fuoriContratto },
      ],
    });
  }
  if (!dev) {
    // Le indispensabili: la voce vuota è il predefinito della realizzazione, l'altra lo cambia.
    const preset = defaults.soloIndispensabili;
    const value = filter.soloIndispensabili === preset ? null : filter.soloIndispensabili ? "si" : "no";
    fields.push({
      key: "indispensabili",
      label: t.domande,
      value,
      placeholder: preset ? t.soloIndispensabili : t.tutte,
      options: [preset ? { value: "no", label: t.ancheFacoltative } : { value: "si", label: t.soloIndispensabili }],
    });
  }
  const show: QuestionFilterOption[] = [{ value: "documenti", label: t.documenti }];
  if (ls) show.push({ value: "catalogo", label: t.catalogo(options.catalogSize), chip: t.catalogo(null) });
  fields.push({ key: "mostra", label: t.mostra, value: filter.catalogo ? "catalogo" : filter.documenti ? "documenti" : null, placeholder: t.soloDomande, options: show });
  if (ls && filter.catalogo) {
    const counts = options.kindCounts ?? {};
    fields.push({
      key: "tipo",
      label: t.tipo,
      value: filter.tipo,
      placeholder: t.tuttiITipi,
      options: KIND_ORDER.filter((k) => (counts[k] ?? 0) > 0 || filter.tipo === k).map((k) => ({ value: k, label: `${KIND_LABEL[k].many} (${formatCountIt(counts[k] ?? 0)})`, chip: KIND_LABEL[k].many })),
    });
  }
  return fields;
}

/**
 * I parametri che la barra tiene (la vista, i filtri, la ricerca), come li scrive `questionQuery`: niente pagina
 * (cambiare un filtro torna alla prima) e niente pannello (`apri`).
 */
export function questionKeptQuery(filter: QuestionFilter, defaults: QuestionDefaults): Record<string, string> {
  return Object.fromEntries(new URLSearchParams(questionQuery(filter, defaults).slice(1)));
}
