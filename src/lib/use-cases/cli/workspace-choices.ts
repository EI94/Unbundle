/**
 * I workspace della pagina «Collega questa CLI» (rilascio 8.0b, RILASCIO-8.0b-COSTRUZIONE.md §3).
 *
 * - Solo quelli dove la persona è nel team di almeno un caso: altrove la CLI non serve. Mai come learner.
 * - Ogni voce si riconosce: nome, organizzazione se è diversa, e per due voci uguali la data di creazione. Se
 *   anche la data è uguale, l'inizio dell'id. Il 12/11 la pagina mostrava cinque «NATIVA · Supersapiens» uguali.
 *
 * Modulo puro.
 */

export interface CliWorkspaceInput {
  id: string;
  name: string;
  organization: string;
  createdAt: Date;
  accessRole: string;
}

export interface CliWorkspaceChoice {
  id: string;
  label: string;
}

const CREATED_IT = new Intl.DateTimeFormat("it-IT", { day: "numeric", month: "short", year: "numeric", timeZone: "Europe/Rome" });

function clean(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function duplicated(labels: readonly string[]): Set<string> {
  const seen = new Set<string>();
  const twice = new Set<string>();
  for (const label of labels) (seen.has(label) ? twice : seen).add(label);
  return twice;
}

/** Le voci della scelta del workspace, in ordine alfabetico. `caseWorkspaceIds`: dove la persona è nel team di un caso. */
export function cliWorkspaceChoices(items: readonly CliWorkspaceInput[], caseWorkspaceIds: ReadonlySet<string>): CliWorkspaceChoice[] {
  const byId = new Map<string, CliWorkspaceInput>();
  for (const w of items) {
    const id = w.id.toLowerCase();
    if (w.accessRole === "learner" || !caseWorkspaceIds.has(id) || byId.has(id)) continue;
    byId.set(id, w);
  }
  const kept = [...byId.entries()];
  let labels = kept.map(([, w]) => {
    const name = clean(w.name) || "Workspace";
    const organization = clean(w.organization);
    return organization && organization !== name ? `${name} · ${organization}` : name;
  });
  const sameName = duplicated(labels);
  labels = labels.map((label, i) => (sameName.has(label) ? `${label} · creato il ${CREATED_IT.format(kept[i][1].createdAt)}` : label));
  const sameDay = duplicated(labels);
  labels = labels.map((label, i) => (sameDay.has(label) ? `${label} · ${kept[i][0].slice(0, 8)}` : label));
  return kept.map(([id], i) => ({ id, label: labels[i] })).sort((a, b) => a.label.localeCompare(b.label, "it"));
}
