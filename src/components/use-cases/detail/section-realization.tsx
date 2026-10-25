import Link from "next/link";
import { RealizationSummary } from "@/components/uc/realization/realization-summary";
import { StatusDot } from "@/components/uc/ui/status-dot";
import { Button } from "@/components/ui/button";
import { CASE_STATUS_LABEL } from "@/lib/uc/case-state";
import { CASE_STATUS_TONE } from "@/lib/uc/views/labels";
import { dossierSituation, type DecisionItem } from "@/lib/use-cases/decision-ui";
import type { UseCaseRealization } from "@/lib/uc/views/realization";
import { formatDayInYear } from "@/lib/use-cases/format";
import type { HubDossier, UseCaseDetail } from "@/lib/use-cases/views";
import { cn } from "@/lib/utils";
import { MarkInProgressButton } from "../decision-buttons";

/** I testi del capitolo (§6.5, §14.3). */
export const SECTION_REALIZATION_TEXT = Object.freeze({
  title: "Realizzazione",
  notStarted: "La realizzazione non è ancora partita.",
  notStartedHint: "Il dossier raccoglie i dati dal cliente e prepara lo sviluppo.",
  start: "Avvia la realizzazione",
  startedByLs: "La realizzazione la avvia Lateral Space.",
  dossier: "Dossier",
  readiness: "indispensabili a posto",
  openDossier: "Apri il dossier",
  dossierAudience: "Il dossier lo vedono i suoi membri e chi gestisce il workspace.",
  dossierClosed: "Il dossier è chiuso.",
  unavailable: "Il riepilogo del dossier non è disponibile ora.",
  diffusedOn: "Diffusa il",
});

/** Come è andata la lettura del dossier (`UseCaseDetailResult.dossierRead`). */
export type DossierRead = "ok" | "spenta" | "errore";

/**
 * Quale variante del capitolo si mostra (§6.5):
 * - `avvia`: approvato «Da costruire» senza dossier, Lateral Space, sezione Casi d'uso accesa;
 * - `segna`: lo stesso con la sezione spenta: «Segna come in realizzazione»;
 * - `lo_avvia_ls`: lo stesso per un revisore del cliente;
 * - `riepilogo`: il riepilogo ricco del dossier dei Casi d'uso (`realization` avviata: stato,
 *   avanzamento, prossima tappa, le tre cifre del ROI, «Apri il dossier» per chi lo apre);
 * - `dossier`: c'è un dossier collegato ma il riepilogo ricco non è arrivato (stato,
 *   avanzamento, chiuso);
 * - `non_disponibile`: la lettura del dossier è fallita;
 * - `diffusa`: best practice diffusa, con il giorno;
 * - `fase`: solo la fase.
 *
 * `realization` (facoltativa) è la risposta di `realizationOfUseCase`: con `da_avviare` il
 * pulsante «Avvia» richiede anche il suo `canStart` (lo stesso controllo dei Casi d'uso).
 */
export type RealizationVariant = "avvia" | "segna" | "lo_avvia_ls" | "riepilogo" | "dossier" | "non_disponibile" | "diffusa" | "fase";

export function realizationVariant(
  item: Pick<DecisionItem, "phase" | "subState" | "kind"> & { dossier: unknown },
  opts: { dossierRead: DossierRead; canStartRealization: boolean; canMarkInProgress: boolean; realization?: UseCaseRealization | null },
): RealizationVariant {
  const realization = opts.realization ?? null;
  if (opts.dossierRead === "errore") return "non_disponibile";
  if (item.dossier) {
    if (realization?.state === "avviata") return "riepilogo";
    return realization?.state === "errore" ? "non_disponibile" : "dossier";
  }
  if (item.kind === "da_diffondere") return item.phase === "realizzato" ? "diffusa" : "fase";
  if (item.phase === "approvato") {
    if (opts.canStartRealization) {
      if (opts.dossierRead !== "ok") return opts.canMarkInProgress ? "segna" : "fase";
      if (realization?.state === "errore") return "non_disponibile";
      return realization?.state === "da_avviare" && !realization.canStart ? "fase" : "avvia";
    }
    return "lo_avvia_ls";
  }
  return "fase";
}

export interface SectionRealizationProps {
  workspaceId: string;
  item: Pick<DecisionItem, "id" | "code" | "version" | "phase" | "subState" | "kind" | "phaseLabel"> &
    Pick<UseCaseDetail, "tone" | "realizedOn"> & { dossier: HubDossier | null; valueModel?: UseCaseDetail["valueModel"] };
  today: string;
  dossierRead: DossierRead;
  /** Solo Lateral Space con ruolo da revisore (D3). */
  canStartRealization: boolean;
  /** Solo Lateral Space con ruolo da revisore, con la sezione Casi d'uso spenta (D3). */
  canMarkInProgress: boolean;
  /** Chi gestisce il workspace apre il dossier anche senza esserne membro. */
  canOpenAnyDossier: boolean;
  /** Il riepilogo ricco del dossier per chi guarda (`realizationOfUseCase`); null se non letto. */
  realization?: UseCaseRealization | null;
  /** La scheda ha già il suo pulsante pieno (in «Decisione»): «Apri il dossier» diventa `outline`. */
  primaryTaken?: boolean;
  id?: string;
  className?: string;
}

/**
 * Il capitolo «Realizzazione» della scheda (docs/use-case/DESIGN.md §6.5, §6.7; PIANO-LAVORI H4b,
 * H6a): la fase, «Avvia la realizzazione» per Lateral Space con la sezione Casi d'uso accesa,
 * «Segna come in realizzazione» con la sezione spenta, «La realizzazione la avvia Lateral Space.»
 * per i revisori del cliente, il riepilogo del dossier con i componenti dei Casi d'uso
 * (`RealizationSummary`: stato, «0 di 245 indispensabili a posto», prossima tappa, costo,
 * beneficio all'anno e pareggio dai totali di `uc_roi_models`, «Apri il dossier» solo per chi
 * lo apre) e il testo di ripiego se la parte del dossier non risponde.
 */
export function SectionRealization({
  workspaceId,
  item,
  today,
  dossierRead,
  canStartRealization,
  canMarkInProgress,
  canOpenAnyDossier,
  realization = null,
  primaryTaken = false,
  id = "realizzazione",
  className,
}: SectionRealizationProps) {
  const headingId = `${id}-titolo`;
  const variant = realizationVariant(item, { dossierRead, canStartRealization, canMarkInProgress, realization });
  const dossier = item.dossier;
  const diffusedOn = variant === "diffusa" && item.realizedOn ? formatDayInYear(item.realizedOn, today) : null;
  return (
    <section id={id} aria-labelledby={headingId} data-slot="section-realization" data-variant={variant} className={cn("scroll-mt-28 space-y-3", className)}>
      <h2 id={headingId} className="text-base font-semibold">
        {SECTION_REALIZATION_TEXT.title}
      </h2>

      {variant === "avvia" ? (
        <div className="flex flex-col gap-3 rounded-lg border border-border p-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-0.5 text-sm">
            <p className="font-medium">{SECTION_REALIZATION_TEXT.notStarted}</p>
            <p className="text-muted-foreground">{SECTION_REALIZATION_TEXT.notStartedHint}</p>
          </div>
          <Button
            render={<Link href={`/dashboard/${workspaceId}/casi-duso/nuovo?useCaseId=${item.id}`} />}
            nativeButton={false}
            className="min-h-11 shrink-0 sm:min-h-8"
          >
            {SECTION_REALIZATION_TEXT.start}
          </Button>
        </div>
      ) : null}

      {variant === "segna" ? (
        <div>
          <MarkInProgressButton
            workspaceId={workspaceId}
            // Al browser solo quello che serve al pulsante, non la scheda intera.
            item={{ id: item.id, code: item.code, version: item.version, phase: item.phase, kind: item.kind, dossier: dossier ? { status: dossier.status } : null }}
            canMarkInProgress={canMarkInProgress}
            dossiersEnabled={false}
          />
        </div>
      ) : null}

      {variant === "lo_avvia_ls" ? <p className="text-sm text-muted-foreground">{SECTION_REALIZATION_TEXT.startedByLs}</p> : null}

      {variant === "riepilogo" && realization?.state === "avviata" ? (
        // Senza il conto del dossier, una scheda con «Benefici e costi» non ripete «da calcolare»: le
        // sue cifre sono nella Valutazione, poco sopra.
        <RealizationSummary dossier={realization.dossier} primary={!primaryTaken} hideEmptyFigures={Boolean(item.valueModel)} />
      ) : null}

      {variant === "dossier" && dossier ? (
        <div className="space-y-2 text-sm">
          <p className="flex flex-wrap items-center gap-2">
            <span className="text-muted-foreground">{SECTION_REALIZATION_TEXT.dossier}</span>
            <StatusDot tone={CASE_STATUS_TONE[dossier.status]} label={CASE_STATUS_LABEL[dossier.status]} size="md" />
          </p>
          {dossier.readiness && dossier.readiness.required > 0 ? (
            <div className="space-y-1">
              <div aria-hidden className="h-1.5 w-full max-w-xs overflow-hidden rounded-full bg-muted">
                <div className="h-full rounded-full bg-primary" style={{ width: `${Math.round((dossier.readiness.ok / dossier.readiness.required) * 100)}%` }} />
              </div>
              <p className="tabular-nums text-muted-foreground">
                {dossier.readiness.ok} di {dossier.readiness.required} {SECTION_REALIZATION_TEXT.readiness}
              </p>
            </div>
          ) : null}
          {dossierSituation(dossier) === "chiuso" ? <p className="text-muted-foreground">{SECTION_REALIZATION_TEXT.dossierClosed}</p> : null}
          {canOpenAnyDossier ? (
            <Button render={<Link href={`/dashboard/${workspaceId}/casi-duso/${dossier.caseId}`} />} nativeButton={false} variant="outline" className="min-h-11 sm:min-h-8">
              {SECTION_REALIZATION_TEXT.openDossier}
            </Button>
          ) : (
            <p className="text-muted-foreground">{SECTION_REALIZATION_TEXT.dossierAudience}</p>
          )}
        </div>
      ) : null}

      {variant === "non_disponibile" ? <p className="text-sm text-muted-foreground">{SECTION_REALIZATION_TEXT.unavailable}</p> : null}

      {diffusedOn ? (
        <p className="text-sm text-muted-foreground">
          {SECTION_REALIZATION_TEXT.diffusedOn} {diffusedOn}.
        </p>
      ) : null}
    </section>
  );
}
