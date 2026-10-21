"use client";

import { createContext, useCallback, useContext, useId, useState, useTransition, type ReactNode } from "react";
import { unstable_rethrow, useRouter } from "next/navigation";
import { toast } from "sonner";
import { ActionMenu } from "@/components/uc/ui/action-menu";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { decideUseCaseAction, markRealizationAction } from "@/lib/actions/use-case-decisions";
import {
  ACTION_FAILED_MESSAGE,
  DECISION_LABEL,
  DIALOG_COMMON_TEXT,
  PUBLIC_NOTE_MAX,
  PUBLIC_NOTE_TEXT,
  createDecisionWriteQueue,
  decisionLayout,
  proposesNoteUpdate,
  publicNoteChange,
  publicNoteCounter,
  publicNotePrefill,
  reopenDestination,
  rereadsPage,
  showMarkInProgress,
  type DecisionActionResult,
  type DecisionItem,
  type DecisionKey,
  type DuplicateCandidate,
  type PageDecision,
} from "@/lib/use-cases/decision-ui";
import { cn } from "@/lib/utils";
import { ApproveDialog } from "./approve-dialog";
import { ArchiveDialog } from "./archive-dialog";
import { DuplicateDialog } from "./duplicate-dialog";
import { PostponeDialog } from "./postpone-dialog";
import { PublicNoteDialog } from "./public-note-dialog";
import { ConfirmDecisionDialog, ReopenDialog } from "./reopen-dialog";

/**
 * Una coda sola per la pagina (`createDecisionWriteQueue` di `decision-ui.ts`): le scritture
 * partono una dopo l'altra, ognuna con la versione lasciata da quella prima. Si usa solo
 * dentro gli eventi.
 */
const decisionWrites = createDecisionWriteQueue();

/**
 * Un `redirect()` (o `notFound()`) della action: con la sessione scaduta `requireSession()`
 * porta al login, Next rifiuta la promessa della action e intanto naviga da sé.
 */
export function isNextNavigation(error: unknown): boolean {
  try {
    unstable_rethrow(error);
    return false;
  } catch {
    return true;
  }
}

/**
 * Manda una scrittura delle decisioni (le action di `use-case-decisions.ts`) e ne mostra
 * l'esito come chiede docs/use-case/DESIGN.md §6.8 e §14.3:
 * - la scrittura aspetta quella in corso e parte con la versione più recente che si conosce
 *   (`call` la riceve): la nota salvata all'uscita dal campo non fa fallire il clic dopo;
 * - riuscita: il toast della decisione (se c'è); la pagina si rilegge da sola
 *   (`revalidatePath` nella action);
 * - errore di un campo: nessun toast, lo mostra il dialogo;
 * - versione superata: il toast «Qualcuno ha appena modificato questo use case. Ho ricaricato
 *   i dati: rifai la modifica.», poi `router.refresh()`; il testo scritto resta nel campo;
 * - un altro errore che vuol dire pagina vecchia (`rereadsPage`: fase o dossier cambiati,
 *   ruolo tolto, area spenta, scheda sparita): il toast con il messaggio del servizio, poi
 *   `router.refresh()`, così non resta un pulsante che fallisce sempre;
 * - sessione scaduta (redirect della action): nessun toast, Next porta al login;
 * - ogni altro errore (`riprova`, anche quando la action non risponde): il toast con il
 *   messaggio, la pagina resta com'è per riprovare.
 * `onStart` gira subito, dentro la transizione: lì va lo stato ottimista.
 */
export function useDecisionRunner() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const run = useCallback(
    (target: Pick<DecisionItem, "id" | "version">, call: (version: number) => Promise<DecisionActionResult>, onStart?: () => void) =>
      new Promise<DecisionActionResult>((resolve) => {
        startTransition(async () => {
          onStart?.();
          let result: DecisionActionResult;
          let answered = true;
          try {
            result = await decisionWrites.send(target.id, target.version, call);
          } catch (error) {
            result = { ok: false, error: "riprova", message: ACTION_FAILED_MESSAGE };
            answered = false;
            if (isNextNavigation(error)) {
              resolve(result);
              return;
            }
          }
          if (result.ok) {
            if (result.message) toast.success(result.message);
          } else {
            if (!result.fieldErrors) toast.error(result.message);
            // La action ha già chiesto la rilettura (`revalidatePath`); qui la si chiede anche
            // al router, come per la versione superata. Non quando la action non ha risposto.
            if (answered && rereadsPage(result)) router.refresh();
          }
          resolve(result);
        });
      }),
    [router],
  );
  return { run, pending };
}

/** Leggere e scrivere il testo del campo «Nota pubblica» del capitolo, fuori dal render. */
export interface PublicNoteDraft {
  get(): string | null;
  set(text: string | null): void;
}

const PublicNoteDraftContext = createContext<PublicNoteDraft | null>(null);

/**
 * Il testo del campo «Nota pubblica» del capitolo «Decisione» (§6.4), per i dialoghi di
 * «Serve info» e «Non avviare»: si aprono con quello che c'è nel campo, anche se il
 * salvataggio all'uscita dal campo non è ancora tornato. Senza il campo (pannello laterale)
 * partono dalla nota salvata.
 */
export function PublicNoteDraftProvider({ children }: { children: ReactNode }) {
  const [draft] = useState<PublicNoteDraft>(() => {
    let text: string | null = null;
    return {
      get: () => text,
      set: (next) => {
        text = next;
      },
    };
  });
  return <PublicNoteDraftContext value={draft}>{children}</PublicNoteDraftContext>;
}

export function usePublicNoteDraft(): PublicNoteDraft | null {
  return useContext(PublicNoteDraftContext);
}

export interface DecisionButtonsProps {
  workspaceId: string;
  /** Lo use case come lo ricevono i revisori (`HubItem` o `UseCaseDetail` vanno bene così). */
  item: DecisionItem;
  /** Oggi a Roma (`AAAA-MM-GG`), letto sul server. */
  today: string;
  /** `abilitiesForUseCase(viewer).canDecide`: senza, nessun pulsante. */
  canDecide: boolean;
  /** Gli use case dello stesso workspace, per «Doppione di…». */
  candidates?: readonly DuplicateCandidate[];
  className?: string;
}

/**
 * I pulsanti delle decisioni (docs/use-case/DESIGN.md §6.4, §4.8; D3): nel capitolo «Decisione»
 * della scheda e nel pannello laterale. Tabella di §6.4 (`decisionLayout`): un solo pulsante
 * pieno, gli altri `outline`, il resto nel menu «⋯» («Altre decisioni»: «Altre azioni» è il
 * menu della testata). Ogni pulsante apre il suo dialogo; il dialogo manda la decisione con la
 * `version` letta con la pagina (o lasciata dall'ultima scrittura). Chi non decide non vede
 * niente: mai pulsanti spenti.
 */
export function DecisionButtons({ workspaceId, item, today, canDecide, candidates, className }: DecisionButtonsProps) {
  const [open, setOpen] = useState<DecisionKey | null>(null);
  const [notePrefill, setNotePrefill] = useState<string | null>(null);
  /** Dopo una risposta a «Serve info» (D17): la nota pubblica da aggiornare nel dialogo; null se il dialogo non la propone. */
  const [answeredNote, setAnsweredNote] = useState<string | null>(null);
  const noteDraft = usePublicNoteDraft();
  const { run, pending } = useDecisionRunner();
  const buttons = decisionLayout(item, { canDecide });
  const primary = buttons.primary;
  if (!primary && buttons.outline.length === 0 && buttons.menu.length === 0) return null;

  function openDialog(key: DecisionKey) {
    // La nota appena scritta nel campo del capitolo, anche se il suo salvataggio è in corso.
    const note = noteDraft?.get() ?? item.publicNote;
    setNotePrefill(note);
    // La domanda non resta nota pubblica senza che nessuno la veda: il dialogo la propone da aggiornare.
    setAnsweredNote(proposesNoteUpdate(item, key) ? publicNotePrefill(note) : null);
    setOpen(key);
  }

  async function submit(decision: PageDecision): Promise<DecisionActionResult> {
    let sent = decision;
    if (answeredNote !== null) {
      // La nota cambiata va con la decisione, nella stessa scrittura: se la decisione non passa,
      // nemmeno la nota (chi ha proposto la legge). Vuota: la nota si toglie.
      const change = publicNoteChange(item.publicNote, answeredNote);
      if ("error" in change) return { ok: false, error: "dati_non_validi", message: change.error, fieldErrors: { publicNote: change.error } };
      if (change.change && (decision.type === "approva" || decision.type === "rimanda" || decision.type === "doppione" || decision.type === "archivia")) {
        sent = { ...decision, publicNote: change.value ?? "" };
      }
    }
    // `today`: il giorno delle etichette di «Quando» del dialogo «Approva» (`checkWhenLabels`).
    const result = await run(item, (version) => decideUseCaseAction(workspaceId, item.id, version, sent, today));
    if (result.ok) setOpen(null);
    return result;
  }
  const onOpenChange = (next: boolean) => {
    if (!next) setOpen(null);
  };
  const extra = answeredNote !== null ? <AnsweredNoteField value={answeredNote} onChange={setAnsweredNote} /> : null;
  const dialog = { open: true, onOpenChange, pending, onSubmit: submit };

  return (
    <div data-slot="decision-buttons" className={cn("flex flex-wrap items-center gap-2", className)}>
      {primary ? (
        <Button type="button" className="min-h-11 sm:min-h-8" onClick={() => openDialog(primary)}>
          {DECISION_LABEL[primary]}
        </Button>
      ) : null}
      {buttons.outline.map((key) => (
        <Button key={key} type="button" variant="outline" className="min-h-11 sm:min-h-8" onClick={() => openDialog(key)}>
          {DECISION_LABEL[key]}
        </Button>
      ))}
      <ActionMenu
        label={DIALOG_COMMON_TEXT.moreDecisions}
        items={buttons.menu.map((key) => ({ label: DECISION_LABEL[key], onSelect: () => openDialog(key) }))}
      />

      {open === "approva" ? <ApproveDialog {...dialog} item={item} today={today} extra={extra} /> : null}
      {open === "rimanda" ? <PostponeDialog {...dialog} code={item.code} today={today} extra={extra} /> : null}
      {open === "serve_info" || open === "non_avviare" ? (
        <PublicNoteDialog {...dialog} decision={open} publicNote={notePrefill} hiddenFromSearch={item.hiddenFromSearch} />
      ) : null}
      {open === "doppione" ? <DuplicateDialog {...dialog} self={item} candidates={candidates} extra={extra} /> : null}
      {open === "archivia" ? <ArchiveDialog {...dialog} code={item.code} extra={extra} /> : null}
      {open === "riapri" ? <ReopenDialog {...dialog} code={item.code} reopensTo={reopenDestination(item)} /> : null}
      {open === "segna_diffusa" || open === "segna_realizzato" ? (
        <ConfirmDecisionDialog {...dialog} decision={open} code={item.code} onSubmit={() => submit({ type: open })} />
      ) : null}
    </div>
  );
}

/**
 * La nota pubblica nei dialoghi «Approva», «Rimanda», «Doppione di…» e «Archivia» dopo una
 * risposta a «Serve info» (D17): è ancora la domanda fatta a chi ha proposto, che la legge. Si
 * apre con la nota di adesso; si salva solo se cambia, con la decisione (una scrittura). Vuota:
 * nessuna nota.
 */
function AnsweredNoteField({ value, onChange }: { value: string; onChange: (text: string) => void }) {
  const fieldId = useId();
  const hintId = useId();
  return (
    <div data-slot="answered-note" className="grid gap-1.5">
      <Label htmlFor={fieldId}>{PUBLIC_NOTE_TEXT.label}</Label>
      <Textarea id={fieldId} value={value} rows={3} maxLength={PUBLIC_NOTE_MAX} aria-describedby={hintId} onChange={(event) => onChange(event.target.value)} />
      <div id={hintId} className="flex items-start justify-between gap-3 text-xs text-muted-foreground">
        <div className="grid gap-1">
          <p>{PUBLIC_NOTE_TEXT.answeredHint}</p>
          <p>{PUBLIC_NOTE_TEXT.warning}</p>
        </div>
        <span className="shrink-0 tabular-nums">{publicNoteCounter(value)}</span>
      </div>
    </div>
  );
}

export interface MarkInProgressButtonProps {
  workspaceId: string;
  item: Pick<DecisionItem, "id" | "code" | "version" | "phase" | "kind" | "dossier">;
  /** `abilitiesForUseCase(viewer).canMarkInProgress`: solo Lateral Space (D3). */
  canMarkInProgress: boolean;
  /** Sezione Casi d'uso accesa per il workspace: allora c'è «Avvia la realizzazione». */
  dossiersEnabled: boolean;
  className?: string;
}

/**
 * «Segna come in realizzazione» (docs/use-case/DESIGN.md §3.7, §6.5, §14.3), pulsante
 * `outline` del capitolo «Realizzazione»: solo Lateral Space, use case approvato «Da
 * costruire» senza dossier, con la sezione Casi d'uso spenta per il workspace. Altrimenti non
 * c'è. Chiede conferma; il servizio rifà ogni controllo.
 */
export function MarkInProgressButton({ workspaceId, item, canMarkInProgress, dossiersEnabled, className }: MarkInProgressButtonProps) {
  const [open, setOpen] = useState(false);
  const { run, pending } = useDecisionRunner();
  if (!showMarkInProgress(item, { canMarkInProgress, dossiersEnabled })) return null;

  async function submit(): Promise<DecisionActionResult> {
    const result = await run(item, (version) => markRealizationAction(workspaceId, item.id, version));
    if (result.ok) setOpen(false);
    return result;
  }

  return (
    <>
      <Button type="button" variant="outline" className={cn("min-h-11 sm:min-h-8", className)} onClick={() => setOpen(true)}>
        {DECISION_LABEL.segna_in_realizzazione}
      </Button>
      {open ? (
        <ConfirmDecisionDialog
          open
          onOpenChange={(next) => {
            if (!next) setOpen(false);
          }}
          decision="segna_in_realizzazione"
          code={item.code}
          pending={pending}
          onSubmit={submit}
        />
      ) : null}
    </>
  );
}
