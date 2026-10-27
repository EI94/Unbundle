import type { UseCaseDetailResult } from "@/lib/db/queries/use-case-hub";
import type { UseCaseRealization } from "@/lib/uc/views/realization";
import { answersOf } from "@/lib/use-cases/answers";
import type { UseCaseEventList } from "@/lib/db/queries/use-case-events";
import { decisionLayout, type DuplicateCandidate } from "@/lib/use-cases/decision-ui";
import type { InfoProgressView } from "@/lib/use-cases/info-progress";
import { TEXT_LIMITS } from "@/lib/use-cases/inputs";
import { WHAT_FIELD_LABEL } from "@/lib/use-cases/labels";
import type { NeedUseCaseRef, UseCaseNeedLists } from "@/lib/use-cases/needs";
import type { UseCaseAbilities } from "@/lib/use-cases/permissions";
import type { UseCaseReferentPanel } from "@/lib/use-cases/referent/contract";
import type { RedactableField } from "@/lib/use-cases/service";
import type { UseCaseDetail } from "@/lib/use-cases/views";
import { cn } from "@/lib/utils";
import { OwnMarker, othersCardNote } from "../use-case-row";
import { ContributorDecisionSection, SectionDecision } from "./section-decision";
import { ChapterNav, type ChapterLink } from "./chapter-nav";
import { DetailHeader } from "./detail-header";
import { IntakeDetails, type GuideLabels } from "./intake-details";
import type { RedactOption } from "./redact-dialog";
import { SectionHistory } from "./section-history";
import { SectionNeeds } from "./section-needs";
import { SectionRealization } from "./section-realization";
import { SectionValuation } from "./section-valuation";
import { SectionWhat } from "./section-what";

// ═══ Capitoli (§6.1, §6.7) ═══════════════════════════════════════════

/** I capitoli della scheda, nell'ordine delle ancore (§6.1, §14.3). */
export const DETAIL_CHAPTERS = [
  { id: "cosa-e", label: "Cos'è" },
  { id: "valutazione", label: "Valutazione" },
  { id: "decisione", label: "Decisione" },
  { id: "cosa-serve", label: "Cosa serve" },
  { id: "realizzazione", label: "Realizzazione" },
  { id: "storia", label: "Storia" },
] as const satisfies readonly ChapterLink[];

export type DetailChapter = (typeof DETAIL_CHAPTERS)[number]["id"];

/** Altri modi di scrivere un capitolo in `?capitolo=` (email, campanella). */
const CHAPTER_ALIASES: Readonly<Record<string, DetailChapter>> = { cosa: "cosa-e", "cosa-è": "cosa-e", "cos-e": "cosa-e", "cos'è": "cosa-e" };

/** `?capitolo=` → il capitolo, oppure null per un valore fuori elenco. */
export function chapterFromParam(raw: unknown): DetailChapter | null {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== "string") return null;
  const key = value.trim().toLowerCase();
  if (DETAIL_CHAPTERS.some((chapter) => chapter.id === key)) return key as DetailChapter;
  return CHAPTER_ALIASES[key] ?? null;
}

/**
 * Il capitolo «Realizzazione» c'è (§6.5): per gli use case «Da costruire» dalla fase Approvato in
 * poi (anche chiusi, se hanno un dossier), per le best practice approvate o diffuse.
 */
export function showsRealization(item: Pick<UseCaseDetail, "phase" | "kind"> & { dossier: unknown }): boolean {
  if (item.kind === "da_diffondere") return item.phase === "approvato" || item.phase === "realizzato";
  if (item.phase === "approvato" || item.phase === "in_realizzazione" || item.phase === "realizzato") return true;
  return item.phase === "chiuso" && Boolean(item.dossier);
}

/**
 * Le ancore di chi guarda (§6.7): i revisori «Cos'è», «Valutazione», «Decisione», «Cosa serve»,
 * «Realizzazione» (quando c'è) e «Storia»; il contributore nessuna (la sua scheda è testata e
 * nota pubblica, §6.9). Mai ancore spente.
 */
export function detailChapters(
  abilities: Pick<UseCaseAbilities, "isReviewer" | "canSeeHistory"> & Partial<Pick<UseCaseAbilities, "canSeeNeeds">>,
  opts: { showRealization: boolean },
): ChapterLink[] {
  if (!abilities.isReviewer) return [];
  return DETAIL_CHAPTERS.filter((chapter) => {
    if (chapter.id === "cosa-serve") return abilities.canSeeNeeds === true;
    if (chapter.id === "realizzazione") return opts.showRealization;
    if (chapter.id === "storia") return abilities.canSeeHistory;
    return true;
  }).map(({ id, label }) => ({ id, label }));
}

// ═══ «Oscura testo» (§6.8) ═══════════════════════════════════════════

/** Il segnaposto di «Oscura testo»: un testo già oscurato non si propone di nuovo. */
const REDACTED = "[testo rimosso]";

function hasText(value: unknown): boolean {
  return typeof value === "string" && value.trim() !== "" && value.trim() !== REDACTED;
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

/** I blocchi della motivazione dell'AI che la v1 lascia nelle note del revisore. */
const AI_NOTE_LABEL = /(^|\n\n)(Auto-ranking AI|Suggerimento AI|Ricalibrazione AI):\s*(?!\[testo rimosso\]\s*(\n\n|$))\S/;

/** I testi liberi dei dati raccolti dal connettore (gli stessi che il servizio oscura). */
function intakeHasText(intake: Record<string, unknown> | null): boolean {
  if (!intake) return false;
  if (["toolsOther", "promptSnippet", "sourceConversation"].some((key) => hasText(intake[key]))) return true;
  const estimate = record(intake.proposerEstimate);
  return estimate ? Object.values(estimate).some((part) => hasText(record(part)?.reasoning)) : false;
}

/** Le risposte di chi ha proposto a «Serve info» (D17): stanno in `intake` e si oscurano con lui. */
function answersHaveText(intake: Record<string, unknown> | null): boolean {
  return answersOf(intake).some((answer) => hasText(answer.text));
}

/** L'etichetta della casella di `intake`: i dati raccolti da Claude, le risposte, o tutti e due. */
function intakeRedactLabel(intake: Record<string, unknown> | null): string {
  const collected = intakeHasText(intake);
  const answers = answersHaveText(intake);
  if (collected && answers) return "Dati raccolti da Claude e risposte";
  return answers ? "Risposte di chi ha proposto" : "Dati raccolti da Claude";
}

type RedactSource = Pick<
  UseCaseDetail,
  | "kind"
  | "title"
  | "description"
  | "flowDescription"
  | "humanInTheLoop"
  | "guardrails"
  | "businessCase"
  | "dataRequirements"
  | "sustainabilityImpact"
  | "area"
  | "aiLab"
  | "publicNote"
  | "intake"
  | "aiSuggestion"
  | "reviewNotes"
>;

/**
 * Le caselle di «Oscura testo» (§6.8): solo i campi che hanno un testo, con l'etichetta del tipo
 * della scheda. Si calcolano sul server: al browser vanno i nomi dei campi, non i testi.
 */
export function redactOptions(detail: RedactSource): RedactOption[] {
  const kind = detail.kind;
  const what = (field: keyof typeof WHAT_FIELD_LABEL) => WHAT_FIELD_LABEL[field][kind] ?? WHAT_FIELD_LABEL[field].da_costruire ?? field;
  const candidates: Array<[RedactableField, string, boolean]> = [
    ["titolo", what("title"), hasText(detail.title)],
    ["problema", what("description"), hasText(detail.description)],
    ["come_funziona", what("flowDescription"), hasText(detail.flowDescription)],
    ["chi_controlla", what("humanInTheLoop"), hasText(detail.humanInTheLoop)],
    ["limiti", WHAT_FIELD_LABEL.guardrails.da_costruire ?? "Limiti", hasText(detail.guardrails)],
    ["impatto_atteso", what("businessCase"), hasText(detail.businessCase)],
    ["dati", what("dataRequirements"), hasText(detail.dataRequirements)],
    ["impatto_ambientale", what("sustainabilityImpact"), hasText(detail.sustainabilityImpact)],
    ["area", what("area"), hasText(detail.area)],
    ["ai_lab", what("aiLab"), hasText(detail.aiLab)],
    ["nota_pubblica", "Nota pubblica", hasText(detail.publicNote)],
    ["intake", intakeRedactLabel(detail.intake), intakeHasText(detail.intake) || answersHaveText(detail.intake)],
    ["motivazione_ai", "Motivazione dell'AI", hasText(detail.aiSuggestion?.rationale) || AI_NOTE_LABEL.test(detail.reviewNotes ?? "")],
  ];
  return candidates.filter(([, , present]) => present).map(([field, label]) => ({ field, label }));
}

// ═══ La scheda ═══════════════════════════════════════════════════════

/** «Non avviato il 3 ott»: il giorno dell'ultima decisione che ha chiuso la scheda come non avviata. */
export function closedOnFrom(events: UseCaseEventList | null | undefined): Date | null {
  const row = events?.events.find((event) => event.action === "decisione" && event.phaseAfter === "chiuso.non_avviato");
  return row ? row.at : null;
}

export interface UseCaseDetailViewProps {
  workspaceId: string;
  /** `getUseCaseDetail`, già proiettato per chi guarda (§6.7, §6.9, §11). */
  result: UseCaseDetailResult;
  abilities: UseCaseAbilities;
  /** La Storia (solo revisori). */
  events?: UseCaseEventList | null;
  /** Gli use case dello stesso workspace per «Doppione di…» (solo id, codice, titolo). */
  candidates?: readonly DuplicateCandidate[];
  /** I titoli della guida del connettore (aree, strumenti, agenti), se il workspace ne ha una. */
  guide?: GuideLabels | null;
  /** `?capitolo=`. */
  chapter?: DetailChapter | null;
  /** «Mostra tutto» della Storia: il link, se ci sono righe più vecchie. */
  historyAllHref?: string | null;
  /** La Storia è già intera (`?storia=tutta`): si apre aperta. */
  historyAll?: boolean;
  /** Il riepilogo ricco del dossier per chi guarda (`realizationOfUseCase`, H6a); null se non letto. */
  realization?: UseCaseRealization | null;
  /**
   * «Cosa serve» (solo revisori, `canSeeNeeds`): le esigenze collegate a questo use case, per tipo,
   * quelle del workspace da collegare e codice e titolo degli use case che nominano.
   */
  needs?: { lists: UseCaseNeedLists; refs: Record<string, NeedUseCaseRef> } | null;
  /**
   * «Chiedi al referente» (`loadUseCaseReferentPanel`): solo ai revisori che vedono «Cosa serve»; ai
   * contributori mai. Va al capitolo «Cosa serve».
   */
  referents?: UseCaseReferentPanel | null;
  /**
   * «Raccolta informazioni» (`loadUseCaseInfoProgress`): solo ai revisori, null senza requisiti del
   * cliente. Il chip accanto alla fase e il riepilogo in cima a «Cosa serve».
   */
  infoProgress?: InfoProgressView | null;
  /** Il nome del team che valuta, da solo (§14.2): i testi del contributore. */
  teamName: string;
  className?: string;
}

/**
 * La scheda `/use-cases/[id]` con l'area accesa (docs/use-case/DESIGN.md §6): testata, ancore e i
 * capitoli per ruolo (§6.7). I revisori leggono e modificano «Cos'è» e «Valutazione», decidono
 * in «Decisione» (D3), vedono «Realizzazione» e «Storia»; «Avvia la realizzazione» solo Lateral
 * Space. Chi gestisce il workspace vede anche «Proposto da» ed «Email indicata» e può oscurare
 * un testo. Il contributore vede titolo e fase, e delle sue proposte codice e nota pubblica
 * (D4, D13): i dati gli arrivano già proiettati dal server.
 */
export function UseCaseDetailView({
  workspaceId,
  result,
  abilities,
  events,
  candidates,
  guide,
  chapter,
  historyAllHref,
  historyAll = false,
  realization = null,
  needs = null,
  referents = null,
  infoProgress = null,
  teamName,
  className,
}: UseCaseDetailViewProps) {
  if (result.projection === "contributore") {
    const useCase = result.useCase;
    return (
      <div data-slot="use-case-detail" data-projection="contributore" className={cn("mx-auto w-full max-w-3xl min-w-0 space-y-6", className)}>
        <DetailHeader
          workspaceId={workspaceId}
          card={{
            id: useCase.id,
            title: useCase.title,
            code: useCase.own ? useCase.code : null,
            phase: useCase.phase,
            subState: useCase.subState,
            phaseLabel: useCase.phaseLabel,
          }}
          marker={useCase.own ? <OwnMarker /> : null}
        />
        {/* Delle proposte altrui solo titolo e fase (D4, D13): una riga dice perché (H7). */}
        {useCase.own ? null : <p className="text-sm text-muted-foreground">{othersCardNote(teamName)}</p>}
        <ContributorDecisionSection workspaceId={workspaceId} useCase={useCase} answer={result.answer} teamName={teamName} />
      </div>
    );
  }

  const detail = result.useCase;
  const proposer = result.projection === "gestore" ? result.useCase.proposer : null;
  const showRealization = showsRealization(detail);
  const chapters = detailChapters(abilities, { showRealization });
  const layout = decisionLayout(detail, { canDecide: abilities.canDecide });
  const canArchive = layout.menu.includes("archivia") || layout.outline.includes("archivia");
  const closedOn = closedOnFrom(events);

  return (
    <div data-slot="use-case-detail" data-projection={result.projection} className={cn("mx-auto w-full max-w-3xl min-w-0", className)}>
      <DetailHeader
        workspaceId={workspaceId}
        card={{
          id: detail.id,
          title: detail.title,
          code: detail.code,
          phase: detail.phase,
          subState: detail.subState,
          phaseLabel: detail.phaseLabel,
          tone: detail.tone,
          origin: detail.origin,
          kind: detail.kind,
        }}
        titleEdit={abilities.canEditWhat ? { item: { id: detail.id, version: detail.version }, label: WHAT_FIELD_LABEL.title[detail.kind] ?? "Titolo", max: TEXT_LIMITS.title } : null}
        reviewer={{
          item: { id: detail.id, code: detail.code, version: detail.version, hiddenFromSearch: detail.hiddenFromSearch },
          canSetHidden: abilities.canSetHiddenFromSearch,
          canArchive,
          canRedact: abilities.canRedact,
          redactOptions: abilities.canRedact ? redactOptions(detail) : [],
        }}
        infoProgress={abilities.canSeeNeeds ? infoProgress : null}
      />
      <ChapterNav chapters={chapters} initial={chapter ?? null} className="mt-4" />
      <div className="mt-6 space-y-10">
        <SectionWhat
          workspaceId={workspaceId}
          detail={detail}
          canEdit={abilities.canEditWhat}
          esgEnabled={result.esgEnabled}
          areaOptions={guide?.areas ?? null}
          details={<IntakeDetails workspaceId={workspaceId} detail={detail} canEdit={abilities.canEditWhat} proposer={proposer} labels={guide} />}
        />
        <SectionValuation
          workspaceId={workspaceId}
          detail={detail}
          model={result.model}
          costBands={result.costBands}
          valueParams={result.valueParams}
          today={result.today}
          esgEnabled={result.esgEnabled}
          canEdit={abilities.canEditValuation}
        />
        <SectionDecision
          workspaceId={workspaceId}
          item={detail}
          today={result.today}
          canDecide={abilities.canDecide}
          candidates={candidates}
          closedOn={closedOn ? closedOn.toISOString() : null}
          answers={answersOf(detail.intake)}
          className="scroll-mt-28"
        />
        {abilities.canSeeNeeds && needs ? (
          <SectionNeeds
            workspaceId={workspaceId}
            useCaseId={detail.id}
            requirements={needs.lists.requirements}
            steps={needs.lists.steps}
            linkable={needs.lists.linkable}
            refs={needs.refs}
            today={result.today}
            canEdit={abilities.canEditNeeds}
            referents={referents}
            infoProgress={infoProgress}
          />
        ) : null}
        {showRealization ? (
          <SectionRealization
            workspaceId={workspaceId}
            item={detail}
            today={result.today}
            dossierRead={result.dossierRead}
            canStartRealization={abilities.canStartRealization}
            canMarkInProgress={abilities.canMarkInProgress}
            canOpenAnyDossier={abilities.canOpenAnyDossier}
            realization={realization}
            primaryTaken={layout.primary !== null}
          />
        ) : null}
        {abilities.canSeeHistory && events ? (
          <SectionHistory
            events={events}
            kind={detail.kind}
            today={result.today}
            open={chapter === "storia" || historyAll}
            showAllHref={historyAll ? null : historyAllHref}
          />
        ) : null}
      </div>
    </div>
  );
}
