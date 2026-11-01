import type { UseCaseDetailResult } from "@/lib/db/queries/use-case-hub";
import type { UseCaseRealization } from "@/lib/uc/views/realization";
import type { AgentTone } from "@/lib/use-cases/agents";
import { answersOf } from "@/lib/use-cases/answers";
import type { UseCaseEventList } from "@/lib/db/queries/use-case-events";
import { DIALOG_COMMON_TEXT, PUBLIC_NOTE_TEXT, toDecisionItem, toDuplicateCandidates, type DuplicateCandidate } from "@/lib/use-cases/decision-ui";
import { unofficialEstimateLines } from "@/lib/use-cases/estimates";
import { GUIDED_TEXT, arrivalTarget, detailTargetIds, foldSummaries, impactView, nextStepOf, pathOfUseCase, type NextStep } from "@/lib/use-cases/guided";
import type { InfoProgressView } from "@/lib/use-cases/info-progress";
import { TEXT_LIMITS } from "@/lib/use-cases/inputs";
import { WHAT_FIELD_LABEL } from "@/lib/use-cases/labels";
import type { NeedUseCaseRef, UseCaseNeedLists } from "@/lib/use-cases/needs";
import type { UseCaseAbilities } from "@/lib/use-cases/permissions";
import type { UseCaseReferentPanel } from "@/lib/use-cases/referent/contract";
import type { RedactableField } from "@/lib/use-cases/service";
import type { UseCaseDetail } from "@/lib/use-cases/views";
import { cn } from "@/lib/utils";
import { PublicNoteDraftProvider } from "../decision-buttons";
import { ProposerAnswers } from "../proposer-answers";
import { OwnMarker, othersCardNote } from "../use-case-row";
import { WhenControl } from "../when-control";
import { Arrival } from "./arrival";
import { DetailHeader } from "./detail-header";
import { Fold } from "./fold";
import { ImpactBlock } from "./impact-block";
import { IntakeDetails, type GuideLabels } from "./intake-details";
import { NextStepBox, PagePrimaryProvider } from "./next-step-box";
import { PublicNoteField } from "./public-note-field";
import type { RedactOption } from "./redact-dialog";
import { askEntry } from "./referent/ask-dialog-state";
import { ReferentDialogHost } from "./referent/dialog-host";
import { ContributorDecisionSection } from "./section-decision";
import { SectionHistory } from "./section-history";
import { SectionNeeds } from "./section-needs";
import { SectionRealization, realizationVariant } from "./section-realization";
import { SectionValuation, aiSuggestionShown, valuationKpiGroups } from "./section-valuation";
import { DetailsFields, detailsFieldRows, hasFieldText } from "./section-what";
import { UseCasePath } from "./use-case-path";
import { WorkFlow } from "./work-flow";

// ═══ Capitoli (§6.1, §6.7) ═══════════════════════════════════════════

/** Un'ancora della scheda: l'`id` del blocco e il suo nome. */
export interface ChapterLink {
  /** L'ancora (`id` del blocco o della piega), es. «valutazione». */
  id: string;
  label: string;
}

/** I `?capitolo=` della scheda, nell'ordine della pagina (§6.1, §14.3; rilascio 3). */
export const DETAIL_CHAPTERS = [
  { id: "decisione", label: "Prossimo passo" },
  { id: "impatto", label: "Impatto" },
  { id: "cosa-e", label: "Come cambia il lavoro" },
  { id: "cosa-serve", label: "Cosa serve" },
  { id: "valutazione", label: "Valutazione del team" },
  { id: "dettagli", label: "Dettagli" },
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
  /** Il nome del team che valuta, da solo (§14.2): «Tocca a …» e i testi del contributore. */
  teamName: string;
  /** Il nome del workspace (`access.workspace.name`): «Chiedere le informazioni a TopJet». */
  companyName?: string | null;
  /**
   * Il tono dell'agente del titolo (`workspaceAgentToneOf`), lo stesso delle card della Panoramica:
   * il tag della testata, il percorso e «Con LIBRA». null: neutri. Solo ai revisori.
   */
  agentTone?: AgentTone | null;
  className?: string;
}

/** La riga dei controlli di «Cosa serve» che il riquadro «Prossimo passo» ha già (§8.4). */
function boxAskOf(step: NextStep): "ask" | "gate" | null {
  if (step.key === "G5") return "ask";
  return step.key === "G4" || step.key === "G6" ? "gate" : null;
}

/**
 * La scheda `/use-cases/[id]` con l'area accesa (docs/use-case/DESIGN.md §6; rilascio 3 «Scheda
 * guidata»). Ai revisori: la testata, il percorso dello use case, il riquadro «Prossimo passo» con
 * il solo pulsante pieno della pagina quando il passo è loro, poi su due colonne (dai 58rem della
 * scheda) il contenuto, «Quando» e la nota pubblica accanto, e le pieghe «Valutazione del team»,
 * «Dettagli», «Realizzazione» (quando c'è) e «Storia». Chi gestisce il workspace vede anche
 * «Proposto da» ed «Email indicata» e può oscurare un testo. Il contributore vede la scheda di
 * prima: titolo e fase, e delle sue proposte codice e nota pubblica (D4, D13), con i dati già
 * proiettati dal server.
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
  companyName = null,
  agentTone = null,
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
  const today = result.today;
  const proposer = result.projection === "gestore" ? result.useCase.proposer : null;
  const showRealization = showsRealization(detail);
  const variant = showRealization
    ? realizationVariant(detail, {
        dossierRead: result.dossierRead,
        canStartRealization: abilities.canStartRealization,
        canMarkInProgress: abilities.canMarkInProgress,
        realization,
      })
    : null;
  const realizationFold = variant !== null && variant !== "fase";
  const needsShown = abilities.canSeeNeeds && needs !== null;
  const info = abilities.canSeeNeeds ? infoProgress : null;
  const feature = abilities.canSeeNeeds && referents?.available ? referents : null;
  const entry = feature ? askEntry(feature) : null;
  const step = nextStepOf({
    workspaceId,
    item: detail,
    today,
    teamName,
    companyName,
    canDecide: abilities.canDecide,
    canOpenAnyDossier: abilities.canOpenAnyDossier,
    info,
    referents: abilities.canSeeNeeds && referents ? { available: referents.available, canAsk: referents.canAsk, gates: referents.gates, requestCount: referents.requests.length } : null,
    askEntry: entry,
    realizationVariant: variant,
    realization,
    dossierRead: result.dossierRead,
    closedOn: closedOnFrom(events),
  });
  const path = pathOfUseCase({ item: detail, today, info, dossierRead: result.dossierRead });
  const historyShown = abilities.canSeeHistory && Boolean(events);
  const targets = detailTargetIds({
    phase: detail.phase,
    needs: needsShown,
    requests: Boolean(feature && feature.requests.length > 0),
    realization: realizationFold,
    history: historyShown,
  });
  const arrival = arrivalTarget(chapter ?? null, targets);
  const opens = (id: string) => arrival === id;
  const groups = valuationKpiGroups(result.model, { esgEnabled: result.esgEnabled });
  const estimates = unofficialEstimateLines(detail.intake).length > 0;
  const aiShown = aiSuggestionShown(detail.aiSuggestion, groups);
  const impact = impactView({ value: detail.value, cost: detail.cost, valueModel: detail.valueModel, params: result.valueParams, unofficial: estimates || aiShown });
  const summaries = foldSummaries({
    valuation: {
      estimates,
      aiSuggestion: aiShown,
      value: detail.value,
      zone: detail.zone,
    },
    filledDetails: detailsFieldRows(detail, { esgEnabled: result.esgEnabled })
      .filter((row) => hasFieldText(row.value))
      .map((row) => row.label),
    realization: realizationFold && variant ? { variant, realization, dossier: detail.dossier, realizedOn: detail.realizedOn } : null,
    events: historyShown && events ? events.events : null,
    today,
  });
  // Al browser solo le parti delle decisioni, non la scheda intera; dei candidati solo id, codice e titolo.
  const decisionItem = toDecisionItem(detail);
  const needTitles = needs ? Object.fromEntries([...needs.lists.requirements, ...needs.lists.steps].map((need) => [need.id.toLowerCase(), need.title])) : {};
  const t = GUIDED_TEXT.folds;

  return (
    <div data-slot="use-case-detail" data-projection={result.projection} className={cn("@container/scheda mx-auto w-full max-w-5xl min-w-0", className)}>
      <DetailHeader
        workspaceId={workspaceId}
        card={{ id: detail.id, title: detail.title, code: detail.code, phase: detail.phase, subState: detail.subState, phaseLabel: detail.phaseLabel }}
        titleEdit={abilities.canEditWhat ? { item: { id: detail.id, version: detail.version }, label: WHAT_FIELD_LABEL.title[detail.kind] ?? "Titolo", max: TEXT_LIMITS.title } : null}
        reviewer={{
          item: { id: detail.id, code: detail.code, version: detail.version, hiddenFromSearch: detail.hiddenFromSearch },
          agentTone,
          canSetHidden: abilities.canSetHiddenFromSearch,
          canRedact: abilities.canRedact,
          redactOptions: abilities.canRedact ? redactOptions(detail) : [],
        }}
      />
      <Arrival initial={arrival} ids={targets} />
      {path ? <UseCasePath path={path} tone={agentTone} className="mt-4" /> : null}
      {/* «Serve info» e «Non avviare» si aprono con il testo del campo «Nota pubblica»; un solo pulsante pieno per pagina. */}
      <PublicNoteDraftProvider>
        <PagePrimaryProvider>
          <ReferentDialogHost workspaceId={workspaceId} useCaseId={detail.id} panel={feature} canEdit={abilities.canEditNeeds} needTitles={needTitles}>
            <NextStepBox
              workspaceId={workspaceId}
              step={step}
              item={decisionItem}
              today={today}
              canDecide={abilities.canDecide}
              candidates={toDuplicateCandidates(candidates)}
              canMarkInProgress={abilities.canMarkInProgress}
              className="mt-4"
            />
            <div data-slot="scheda-grid" className="mt-8 grid gap-8 @min-[58rem]/scheda:grid-cols-[minmax(0,1fr)_18rem] @min-[58rem]/scheda:gap-x-8">
              <div data-slot="scheda-main" className="min-w-0 space-y-10 @min-[58rem]/scheda:col-start-1 @min-[58rem]/scheda:row-start-1">
                <ImpactBlock view={impact} value={detail.value} cost={detail.cost} costBands={result.costBands} risks={detail.risks} />
                <WorkFlow workspaceId={workspaceId} detail={detail} canEdit={abilities.canEditWhat} tone={agentTone} />
                {abilities.canSeeNeeds && needs ? (
                  <SectionNeeds
                    workspaceId={workspaceId}
                    useCaseId={detail.id}
                    requirements={needs.lists.requirements}
                    steps={needs.lists.steps}
                    linkable={needs.lists.linkable}
                    refs={needs.refs}
                    today={today}
                    canEdit={abilities.canEditNeeds}
                    referents={referents}
                    infoProgress={infoProgress}
                    boxAsk={boxAskOf(step)}
                  />
                ) : null}
              </div>
              <aside data-slot="scheda-aside" className="min-w-0 space-y-4 self-start @min-[58rem]/scheda:col-start-2 @min-[58rem]/scheda:row-span-2 @min-[58rem]/scheda:row-start-1">
                {detail.phase === "approvato" ? (
                  <section id="quando" aria-labelledby="quando-titolo" className="scroll-mt-20 space-y-3 rounded-xl border bg-card p-4">
                    <h2 id="quando-titolo" tabIndex={-1} className="text-sm font-semibold outline-none">
                      {DIALOG_COMMON_TEXT.when}
                    </h2>
                    <WhenControl
                      workspaceId={workspaceId}
                      item={decisionItem}
                      today={today}
                      canDecide={abilities.canDecide}
                      labelledBy="quando-titolo"
                      className="@min-[58rem]/scheda:max-w-none @min-[58rem]/scheda:grid-cols-1"
                    />
                  </section>
                ) : null}
                <section id="nota-pubblica" aria-label={PUBLIC_NOTE_TEXT.label} tabIndex={-1} className="scroll-mt-20 space-y-4 rounded-xl border bg-card p-4 outline-none">
                  <PublicNoteField workspaceId={workspaceId} item={decisionItem} canEdit={abilities.canDecide} />
                  <ProposerAnswers answers={answersOf(detail.intake)} />
                </section>
              </aside>
              <div data-slot="detail-folds" className="min-w-0 @min-[58rem]/scheda:col-start-1 @min-[58rem]/scheda:row-start-2">
                <Fold id="valutazione" title={t.valutazione} summary={summaries.valutazione} open={opens("valutazione")}>
                  <SectionValuation
                    workspaceId={workspaceId}
                    detail={detail}
                    model={result.model}
                    costBands={result.costBands}
                    valueParams={result.valueParams}
                    today={today}
                    esgEnabled={result.esgEnabled}
                    canEdit={abilities.canEditValuation}
                  />
                </Fold>
                <Fold id="dettagli" title={t.dettagli} summary={summaries.dettagli} open={opens("dettagli")}>
                  <DetailsFields
                    workspaceId={workspaceId}
                    detail={detail}
                    canEdit={abilities.canEditWhat}
                    esgEnabled={result.esgEnabled}
                    areaOptions={guide?.areas ?? null}
                    intake={<IntakeDetails workspaceId={workspaceId} detail={detail} canEdit={abilities.canEditWhat} proposer={proposer} labels={guide} bare />}
                  />
                </Fold>
                {realizationFold ? (
                  <Fold id="realizzazione" title={t.realizzazione} summary={summaries.realizzazione} open={opens("realizzazione")}>
                    <SectionRealization
                      workspaceId={workspaceId}
                      item={detail}
                      today={today}
                      dossierRead={result.dossierRead}
                      canStartRealization={abilities.canStartRealization}
                      canMarkInProgress={abilities.canMarkInProgress}
                      canOpenAnyDossier={abilities.canOpenAnyDossier}
                      realization={realization}
                      boxOwnsStart={step.key === "G9"}
                    />
                  </Fold>
                ) : null}
                {abilities.canSeeHistory && events ? (
                  <Fold id="storia" title={t.storia} summary={summaries.storia} open={opens("storia") || historyAll}>
                    <SectionHistory events={events} kind={detail.kind} today={today} showAllHref={historyAll ? null : historyAllHref} />
                  </Fold>
                ) : null}
              </div>
            </div>
          </ReferentDialogHost>
        </PagePrimaryProvider>
      </PublicNoteDraftProvider>
    </div>
  );
}
