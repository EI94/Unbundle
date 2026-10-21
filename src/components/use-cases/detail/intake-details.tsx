import { ChevronRight } from "lucide-react";
import { formatDate, formatEuro } from "@/lib/use-cases/format";
import { channelLabel } from "@/lib/use-cases/labels";
import type { UseCaseDetail } from "@/lib/use-cases/views";
import { cn } from "@/lib/utils";
import { InlineTextField, type InlineFieldOption } from "./inline-text-field";

/** I testi di «Dettagli» (§6.2, §14.3). */
export const DETAILS_TEXT = Object.freeze({
  title: "Dettagli",
  collected: "Dati raccolti da Claude",
  channel: "Canale",
  arrivedOn: "Arrivato il",
  urgency: "Urgenza",
  requirements: "Requisiti",
  dataDependencies: "Dipendenze dai dati",
  possibleDuplicate: "Possibile doppione di",
  proposedBy: "Proposto da",
  submitterEmail: "Email indicata",
  codePlaceholder: "es. XX-0012",
});

/** Le etichette dei dati raccolti dal connettore (§6.2), in italiano. */
const COLLECTED_LABEL = Object.freeze({
  tools: "Strumenti",
  frequency: "Frequenza",
  beneficiaries: "Persone che ne beneficiano",
  timeSavedMinutesPerRun: "Minuti per volta",
  valuePerRunEur: "Euro per volta",
  qualityGain: "Qualità",
  developmentStatus: "Stato di sviluppo",
  relatedAgent: "Agente collegato",
  flags: "Segnalazioni",
});

const FREQUENCY_TEXT: Readonly<Record<string, string>> = {
  giornaliera: "Ogni giorno",
  settimanale: "Ogni settimana",
  mensile: "Ogni mese",
  trimestrale: "Ogni trimestre",
  una_tantum: "Una volta sola",
};

const QUALITY_TEXT: Readonly<Record<string, string>> = {
  invariata: "Invariata",
  lieve: "Lieve miglioramento",
  sensibile: "Miglioramento sensibile",
  nettamente_superiore: "Nettamente superiore",
  non_raggiungibile_a_mano: "Non raggiungibile a mano",
};

const DEVELOPMENT_TEXT: Readonly<Record<string, string>> = {
  idea: "Idea",
  prototipo: "Prototipo",
  funzionante: "Funzionante",
  diffuso: "Già diffuso",
};

const AGENT_TEXT: Readonly<Record<string, string>> = {
  nessuno: "Nessuno",
  non_so: "Non lo sa",
};

const FLAG_TEXT = Object.freeze({
  personalData: "Dati personali",
  safetyRelated: "Sicurezza",
  outsideFoundation: "Fuori perimetro",
  none: "Nessuna",
});

/** Valori della colonna «Urgenza» (`timeline`) scritti dal connettore e dalla REST di oggi. */
const URGENCY_TEXT: Readonly<Record<string, string>> = {
  quick_win: "Soluzione rapida",
  progetto_strutturato: "Progetto strutturato",
};

/** Il valore dell'elenco del connettore come testo, quando la guida non ha il titolo: «sales_force» → «sales force». */
function idText(value: string): string {
  return value.replace(/_/g, " ").trim();
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/**
 * I titoli della guida del connettore del workspace (K8, `workspace_connector_configs.guide`): la
 * scheda mostra i titoli, mai le chiavi (§6.2). Si salva sempre l'id, che il servizio controlla.
 */
export interface GuideLabels {
  /** Le aree, se la guida ha un elenco: id (il valore salvato) e titolo. null: l'area è un testo libero. */
  areas: InlineFieldOption[] | null;
  /** Strumenti per id: «foglio_calcolo» → «Foglio di calcolo». */
  tools: Readonly<Record<string, string>>;
  /** Agenti del catalogo per id: «atlante» → «ATLANTE». */
  agents: Readonly<Record<string, string>>;
}

export const NO_GUIDE_LABELS: GuideLabels = Object.freeze({ areas: null, tools: Object.freeze({}), agents: Object.freeze({}) });

/**
 * Le voci di un elenco della guida: stringhe (id e titolo uguali) oppure oggetti con `id` e il
 * titolo nella prima chiave di `titleKeys` che ha un testo; senza titolo, l'id com'è.
 */
function guideEntries(list: unknown, titleKeys: readonly string[]): InlineFieldOption[] {
  if (!Array.isArray(list)) return [];
  const seen = new Set<string>();
  const out: InlineFieldOption[] = [];
  for (const entry of list) {
    const item = record(entry);
    const id = typeof entry === "string" ? text(entry) : text(item?.id);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const title = item ? titleKeys.map((key) => text(item[key])).find((value) => value !== null) : null;
    out.push({ value: id, label: title ?? id });
  }
  return out;
}

/**
 * Legge la guida del connettore (stessa lettura tollerante del servizio: elenchi di stringhe o di
 * oggetti con `id`): aree con `label`, strumenti con `label`, agenti del catalogo con `nome`.
 */
export function guideLabels(guide: unknown): GuideLabels {
  const data = record(guide);
  if (!data) return NO_GUIDE_LABELS;
  const areas = guideEntries(data.areas, ["label", "nome", "name"]);
  const byId = (entries: InlineFieldOption[]) => Object.fromEntries(entries.map((entry) => [entry.value, entry.label]));
  return {
    areas: areas.length ? areas : null,
    tools: byId(guideEntries(data.tools, ["label", "nome", "name"])),
    agents: byId(guideEntries(data.agentCatalog, ["nome", "label", "name"])),
  };
}

function positiveNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

const INTEGER = new Intl.NumberFormat("it-IT", { maximumFractionDigits: 0 });

export interface DetailRow {
  label: string;
  value: string;
}

/**
 * «Dati raccolti da Claude» (§6.2): solo le chiavi che il connettore scrive, con etichette e
 * valori in italiano; strumenti e agente collegato con i titoli della guida del connettore. Vuoto
 * senza dati del connettore: allora il riquadro non c'è.
 */
export function collectedDataRows(
  intake: Record<string, unknown> | null | undefined,
  labels: Pick<GuideLabels, "tools" | "agents"> = NO_GUIDE_LABELS,
): DetailRow[] {
  const data = record(intake);
  if (!data) return [];
  const rows: DetailRow[] = [];
  const tools = Array.isArray(data.tools) ? data.tools.filter((tool): tool is string => typeof tool === "string" && tool.trim() !== "") : [];
  const other = text(data.toolsOther);
  const toolNames = tools.filter((tool) => tool !== "altro").map((tool) => labels.tools[tool] ?? idText(tool));
  if (other) toolNames.push(other);
  if (toolNames.length) rows.push({ label: COLLECTED_LABEL.tools, value: toolNames.join(", ") });
  const frequency = text(data.frequency);
  if (frequency) rows.push({ label: COLLECTED_LABEL.frequency, value: FREQUENCY_TEXT[frequency] ?? idText(frequency) });
  const people = positiveNumber(data.beneficiaries);
  if (people !== null) rows.push({ label: COLLECTED_LABEL.beneficiaries, value: INTEGER.format(people) });
  const minutes = positiveNumber(data.timeSavedMinutesPerRun);
  if (minutes !== null) rows.push({ label: COLLECTED_LABEL.timeSavedMinutesPerRun, value: INTEGER.format(minutes) });
  const euros = positiveNumber(data.valuePerRunEur);
  if (euros !== null) rows.push({ label: COLLECTED_LABEL.valuePerRunEur, value: formatEuro(euros) });
  const quality = text(data.qualityGain);
  if (quality) rows.push({ label: COLLECTED_LABEL.qualityGain, value: QUALITY_TEXT[quality] ?? idText(quality) });
  const development = text(data.developmentStatus);
  if (development) rows.push({ label: COLLECTED_LABEL.developmentStatus, value: DEVELOPMENT_TEXT[development] ?? idText(development) });
  const agent = text(data.relatedAgent);
  if (agent) rows.push({ label: COLLECTED_LABEL.relatedAgent, value: AGENT_TEXT[agent] ?? labels.agents[agent] ?? idText(agent) });
  const flags = record(data.flags);
  if (flags) {
    const raised = (["personalData", "safetyRelated", "outsideFoundation"] as const).filter((key) => flags[key] === true).map((key) => FLAG_TEXT[key]);
    rows.push({ label: COLLECTED_LABEL.flags, value: raised.length ? raised.join(", ") : FLAG_TEXT.none });
  }
  return rows;
}

/** «Urgenza» dalla colonna `timeline`: i valori del connettore in italiano, il resto com'è. */
export function urgencyText(timeline: string | null | undefined): string | null {
  const value = text(timeline);
  if (!value) return null;
  const key = value.toLowerCase().replace(/[\s-]+/g, "_");
  return URGENCY_TEXT[key] ?? value;
}

/** «Proposto da» ed «Email indicata»: solo nella proiezione di chi gestisce il workspace. */
export interface ProposerRows {
  label: string | null;
  email: string | null;
}

export interface IntakeDetailsProps {
  workspaceId: string;
  detail: Pick<
    UseCaseDetail,
    "id" | "version" | "intake" | "source" | "arrivedOn" | "timeline" | "requirements" | "dataDependencies" | "possibleDuplicateOf"
  >;
  /** `canEditWhat`: «Possibile doppione di» si modifica. */
  canEdit: boolean;
  /**
   * Solo per chi gestisce il workspace (`getUseCaseDetail` con proiezione «gestore»): «Proposto
   * da» ed «Email indicata». Per gli altri non arriva nemmeno nel payload.
   */
  proposer?: ProposerRows | null;
  /** I titoli della guida del connettore per strumenti e agente collegato. */
  labels?: Pick<GuideLabels, "tools" | "agents"> | null;
  className?: string;
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid min-w-0 gap-0.5 sm:grid-cols-[12rem_minmax(0,1fr)] sm:gap-3">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-sm break-words">{children}</dd>
    </div>
  );
}

/**
 * «Dettagli» del capitolo «Cosa è» (docs/use-case/DESIGN.md §6.2, §11), chiuso: i dati raccolti
 * da Claude (solo se il connettore ne ha scritti), canale e giorno di arrivo, urgenza,
 * requisiti e dipendenze dai dati se ci sono, «Possibile doppione di» modificabile dai
 * revisori. «Proposto da» ed «Email indicata» solo per chi gestisce il workspace: è l'unico
 * punto della scheda che li mostra (art. 15.4).
 */
export function IntakeDetails({ workspaceId, detail, canEdit, proposer, labels, className }: IntakeDetailsProps) {
  const collected = collectedDataRows(detail.intake, labels ?? NO_GUIDE_LABELS);
  const duplicate = detail.possibleDuplicateOf?.trim() ? detail.possibleDuplicateOf : null;
  const duplicateField = (
    <InlineTextField
      workspaceId={workspaceId}
      item={{ id: detail.id, version: detail.version }}
      field="possibleDuplicateOf"
      label={DETAILS_TEXT.possibleDuplicate}
      value={detail.possibleDuplicateOf}
      max={20}
      mono
      placeholder={DETAILS_TEXT.codePlaceholder}
      canEdit={canEdit}
      compact={!duplicate}
    />
  );
  const urgency = urgencyText(detail.timeline);
  const requirements = detail.requirements?.filter((item) => item.trim()) ?? [];
  const dependencies = detail.dataDependencies?.filter((item) => item.trim()) ?? [];
  const arrived = formatDate(detail.arrivedOn);
  return (
    <details data-slot="intake-details" className={cn("group rounded-lg border border-border", className)}>
      <summary className="flex min-h-11 cursor-pointer list-none items-center gap-1.5 px-3 text-sm font-medium select-none [&::-webkit-details-marker]:hidden">
        <ChevronRight aria-hidden className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-90" />
        {DETAILS_TEXT.title}
      </summary>
      <div className="space-y-4 border-t border-border px-3 py-3">
        {collected.length ? (
          <div className="space-y-2">
            <h3 className="text-sm font-medium">{DETAILS_TEXT.collected}</h3>
            <dl className="grid gap-2">
              {collected.map((row) => (
                <Row key={row.label} label={row.label}>
                  {row.value}
                </Row>
              ))}
            </dl>
          </div>
        ) : null}
        <dl className="grid gap-2">
          <Row label={DETAILS_TEXT.channel}>{channelLabel(detail.source)}</Row>
          {arrived ? <Row label={DETAILS_TEXT.arrivedOn}>{arrived}</Row> : null}
          {urgency ? <Row label={DETAILS_TEXT.urgency}>{urgency}</Row> : null}
          {requirements.length ? (
            <Row label={DETAILS_TEXT.requirements}>
              <ul className="list-disc space-y-0.5 pl-4">
                {requirements.map((item, index) => (
                  <li key={index}>{item}</li>
                ))}
              </ul>
            </Row>
          ) : null}
          {dependencies.length ? (
            <Row label={DETAILS_TEXT.dataDependencies}>
              <ul className="list-disc space-y-0.5 pl-4">
                {dependencies.map((item, index) => (
                  <li key={index}>{item}</li>
                ))}
              </ul>
            </Row>
          ) : null}
          {proposer?.label ? <Row label={DETAILS_TEXT.proposedBy}>{proposer.label}</Row> : null}
          {proposer?.email ? <Row label={DETAILS_TEXT.submitterEmail}>{proposer.email}</Row> : null}
        </dl>
        {/* Vuoto: solo «+ Aggiungi possibile doppione di», come i campi vuoti di «Cosa è». */}
        {duplicate ? <dl>{duplicateField}</dl> : canEdit ? <div className="flex flex-wrap">{duplicateField}</div> : null}
      </div>
    </details>
  );
}
