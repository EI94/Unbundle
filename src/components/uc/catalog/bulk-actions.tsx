"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { ActionMenuItem } from "@/components/uc/ui/action-menu";
import { retryDossierTransition } from "@/components/uc/shell/transition-retry";
import { SelectionBar } from "@/components/uc/ui/selection-bar";
import type { UcActionResult } from "@/lib/actions/uc-action-context";
import { proposeNaAction, setItemsDueAction, transitionItemsAction } from "@/lib/actions/uc-catalog";
import { assignItemsAction, requestConfirmationAction, sendRequestsAction } from "@/lib/actions/uc-people";
import type { AssignmentResult, SendResult } from "@/lib/db/queries/uc-requests";
import {
  BULK_ACTION_LABEL,
  BULK_CHUNK,
  MAX_NA_AT_ONCE,
  bulkOutcomeText,
  chunks,
  eligibleIds,
  groupSkipped,
  questionsText,
  skippedText,
  type BulkActionKey,
  type SelectionByStatus,
  type SkipGroup,
  type SkippedLike,
} from "@/lib/uc/views/bulk";
import { formatCountIt } from "@/lib/uc/views/format";
import type { ContactOption } from "@/lib/uc/views/rows";

export interface BulkPermissions {
  /** Almeno un'azione in blocco: si mostrano le caselle di selezione. */
  any: boolean;
  /** Assegnare a un referente (Responsabile del caso; l'Owner riassegna). */
  assign: boolean;
  /** «Imposta scadenza (proposta)» (Responsabile del caso). */
  setDue: boolean;
  /** Esiti in blocco: mancante e parziale (chi verifica). */
  outcomes: boolean;
  /** «Proponi non applicabile» (Lateral Space). */
  proposeNa: boolean;
  /** «Invia» e «Chiedi conferma»: richieste ai referenti (Responsabile del caso). */
  send: boolean;
}

/** Voci selezionate: della pagina, oppure tutti i risultati dei filtri. */
export interface BulkSelection {
  scope: "pagina" | "risultati";
  byStatus: SelectionByStatus;
  count: number;
  truncated: boolean;
}

/** Fine giornata a Roma, più o meno (le 18 d'estate, le 17 d'inverno): la scadenza è una data. */
function dueIso(date: string): string {
  return `${date}T16:00:00.000Z`;
}

/**
 * Esegue un'azione a lotti (i comandi accettano 500 o 2.000 voci per chiamata)
 * e si ferma al primo errore: le voci dei lotti già fatti restano fatte.
 */
async function inChunks<T>(ids: readonly string[], size: number, call: (chunk: string[]) => Promise<UcActionResult<T>>): Promise<{ results: { data: T; message?: string }[]; error: string | null }> {
  const results: { data: T; message?: string }[] = [];
  for (const chunk of chunks(ids, size)) {
    try {
      const r = await call(chunk);
      if (!r.ok) return { results, error: r.message };
      results.push({ data: r.data, message: r.message });
    } catch {
      return { results, error: "Operazione non riuscita. Riprova tra poco." };
    }
  }
  return { results, error: null };
}

// ── Domande: la barra della selezione (DESIGN §3.6.2) ─────────────────

type QuestionMode = Exclude<BulkActionKey, never> | null;

export interface QuestionSelectionBarProps {
  workspaceId: string;
  caseId: string;
  selection: BulkSelection;
  /** Domande della vista, in tutte le pagine («Seleziona tutte le 140»). */
  total: number;
  permissions: BulkPermissions;
  contacts: ContactOption[];
  onCancel: () => void;
  onSelectAll: () => void;
  /** Dopo un'azione riuscita: si svuota la selezione. */
  onDone: () => void;
}

/**
 * La selezione di Domande sul modello di Mail (§3.6.2): «12 selezionate
 * [Assegna a…] [Invia] [Altro ▾] [Annulla]», fissa in fondo alla finestra.
 * Ogni azione apre un dialogo che dice a quante domande si applica; l'esito
 * arriva come toast, con le domande saltate e il motivo.
 */
export function QuestionSelectionBar({ workspaceId, caseId, selection, total, permissions, contacts, onCancel, onSelectAll, onDone }: QuestionSelectionBarProps) {
  const [mode, setMode] = useState<QuestionMode>(null);
  const [busy, setBusy] = useState(false);
  const [contactId, setContactId] = useState<string | null>(null);
  const [date, setDate] = useState("");
  const [text, setText] = useState("");
  const count = selection.count;
  const ids = (action: BulkActionKey) => eligibleIds(selection.byStatus, action);
  const open = (m: BulkActionKey) => {
    setText("");
    setMode(m);
  };
  const close = () => {
    if (!busy) setMode(null);
  };
  const eligible = (action: BulkActionKey) => ids(action).length;
  const appliesTo = (n: number) =>
    n === count
      ? count === 1
        ? "Si applica alla domanda selezionata."
        : `Si applica a tutte le ${questionsText(count)} selezionate.`
      : `Si applica a ${formatCountIt(n)} delle ${questionsText(count)} selezionate: le altre sono in uno stato che non lo ammette.`;

  async function run<T>(action: BulkActionKey, call: (chunk: string[]) => Promise<UcActionResult<T>>, outcome: (results: T[]) => { done: number; skipped?: SkipGroup[]; unlisted?: number; extra?: Parameters<typeof bulkOutcomeText>[2] }) {
    const targets = ids(action);
    if (targets.length === 0) return;
    setBusy(true);
    const { results, error } = await inChunks(targets, BULK_CHUNK[action], call);
    retryDossierTransition();
    setBusy(false);
    if (results.length === 0) {
      toast.error(error ?? "Operazione non riuscita. Riprova tra poco.");
      return;
    }
    const o = outcome(results.map((r) => r.data));
    const description = [skippedText(o.skipped ?? [], o.unlisted ?? 0), error ? `Poi si è fermata: ${error}` : ""].filter(Boolean).join(" ");
    toast.success(bulkOutcomeText(action, o.done, o.extra), description ? { description } : undefined);
    setMode(null);
    onDone();
  }

  async function proposeNaInBlock() {
    const targets = ids("na");
    setBusy(true);
    let done = 0;
    const failures: SkippedLike[] = [];
    for (const itemId of targets) {
      try {
        const r = await proposeNaAction(workspaceId, caseId, { itemId, reason: text.trim() });
        if (r.ok) done++;
        else failures.push({ key: "", message: r.message });
      } catch {
        failures.push({ key: "", message: "Operazione non riuscita." });
      }
    }
    retryDossierTransition();
    setBusy(false);
    if (done === 0) {
      toast.error(failures[0]?.message ?? "Operazione non riuscita. Riprova tra poco.");
      return;
    }
    const description = skippedText(groupSkipped(failures));
    toast.success(bulkOutcomeText("na", done), description ? { description } : undefined);
    setMode(null);
    onDone();
  }

  const sendOutcome = (results: SendResult[]) => {
    const requests = results.flatMap((r) => r.requests);
    return {
      done: requests.reduce((n, r) => n + r.items, 0),
      skipped: groupSkipped(results.flatMap((r) => r.skipped)),
      unlisted: Math.max(0, results.reduce((n, r) => n + r.skippedTotal, 0) - results.reduce((n, r) => n + r.skipped.length, 0)),
      extra: { requests: requests.length },
    };
  };

  const assignable = contacts.filter((c) => c.assignable);
  const primary = (
    <>
      {permissions.assign && (
        <Button type="button" variant="outline" className="min-h-11 sm:min-h-8" disabled={busy} onClick={() => open("assign")}>
          {BULK_ACTION_LABEL.assign}
        </Button>
      )}
      {permissions.send && (
        <Button type="button" variant="outline" className="min-h-11 sm:min-h-8" disabled={busy || eligible("send") === 0} onClick={() => open("send")}>
          {BULK_ACTION_LABEL.send}
        </Button>
      )}
    </>
  );
  const none = (n: number) => (n === 0 ? "Nessuna domanda selezionata lo ammette" : undefined);
  const more: ActionMenuItem[] = [];
  if (permissions.send) more.push({ label: BULK_ACTION_LABEL.confirm, onSelect: () => open("confirm"), disabled: eligible("confirm") === 0, hint: none(eligible("confirm")) });
  if (permissions.setDue) more.push({ label: BULK_ACTION_LABEL.due, onSelect: () => open("due") });
  if (permissions.outcomes) {
    more.push({ label: BULK_ACTION_LABEL.missing, onSelect: () => open("missing"), disabled: eligible("missing") === 0, hint: none(eligible("missing")) });
    more.push({ label: BULK_ACTION_LABEL.partial, onSelect: () => open("partial"), disabled: eligible("partial") === 0, hint: none(eligible("partial")) });
  }
  if (permissions.proposeNa) more.push({ label: BULK_ACTION_LABEL.na, onSelect: () => open("na"), disabled: eligible("na") === 0, hint: none(eligible("na")) });

  const contactName = assignable.find((c) => c.id === contactId)?.name ?? null;

  return (
    <>
      <SelectionBar count={count} total={selection.scope === "risultati" ? count : total} primary={primary} more={more} onCancel={onCancel} onSelectAll={onSelectAll} />
      {selection.truncated && <p className="mt-2 text-center text-xs text-muted-foreground">Selezionate le prime {questionsText(count)}: per le altre restringi i filtri.</p>}
      <Dialog open={mode !== null} onOpenChange={(o) => !o && close()}>
        <DialogContent showCloseButton={false} className="sm:max-w-md">
          {mode === "assign" && (
            <DialogBody
              title="Assegna a un referente"
              note={appliesTo(eligible("assign"))}
              busy={busy}
              submit={`Assegna ${questionsText(eligible("assign"))}`}
              ready={contactId !== null}
              onCancel={close}
              onSubmit={() =>
                run<AssignmentResult>(
                  "assign",
                  (itemIds) => assignItemsAction(workspaceId, caseId, { mode: "voci", itemIds, contactId }),
                  (results) => ({
                    done: results.reduce((n, r) => n + r.assigned + r.unchanged, 0),
                    skipped: groupSkipped(results.flatMap((r) => r.skipped)),
                    unlisted: Math.max(0, results.reduce((n, r) => n + r.skippedTotal - r.skipped.length, 0)),
                    extra: { contactName },
                  }),
                )
              }
            >
              <Select items={assignable.map((c) => ({ value: c.id, label: c.roleLabel ? `${c.name} · ${c.roleLabel}` : c.name }))} value={contactId} onValueChange={(v) => setContactId(v ? String(v) : null)}>
                <SelectTrigger className="min-h-11 w-full sm:min-h-8" aria-label="Referente">
                  <SelectValue placeholder="Scegli il referente" />
                </SelectTrigger>
                <SelectContent>
                  {assignable.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.roleLabel ? `${c.name} · ${c.roleLabel}` : c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {assignable.length === 0 && <p className="text-xs text-muted-foreground">Nessun referente da scegliere: aggiungilo da Persone.</p>}
            </DialogBody>
          )}
          {(mode === "send" || mode === "confirm") && (
            <DialogBody
              title={mode === "send" ? "Invia ai referenti" : "Chiedi conferma"}
              note={`${mode === "send" ? "Ogni referente riceve un link con le sue domande." : "Le risposte tornano a chi possiede il dato, che le conferma o le corregge."} ${appliesTo(eligible(mode))} Quelle senza referente si saltano.`}
              busy={busy}
              submit={mode === "send" ? `Invia ${questionsText(eligible("send"))}` : `Chiedi conferma di ${questionsText(eligible("confirm"))}`}
              ready
              onCancel={close}
              onSubmit={() =>
                mode === "send"
                  ? run<SendResult>("send", (itemIds) => sendRequestsAction(workspaceId, caseId, { itemIds, message: text.trim() || null }), sendOutcome)
                  : run<SendResult>("confirm", (itemIds) => requestConfirmationAction(workspaceId, caseId, { itemIds, message: text.trim() || null }), sendOutcome)
              }
            >
              <label className="block text-sm">
                <span className="mb-1 block text-muted-foreground">Messaggio per i referenti (facoltativo)</span>
                <Textarea value={text} onChange={(e) => setText(e.target.value)} maxLength={2000} rows={3} />
              </label>
            </DialogBody>
          )}
          {mode === "due" && (
            <DialogBody
              title="Imposta la scadenza"
              note={`È una proposta per i referenti. ${appliesTo(eligible("due"))}`}
              busy={busy}
              submit={`Imposta su ${questionsText(eligible("due"))}`}
              ready={date !== ""}
              onCancel={close}
              onSubmit={() => run<{ count: number }>("due", (itemIds) => setItemsDueAction(workspaceId, caseId, { itemIds, dueAt: dueIso(date), isProposal: true }), (r) => ({ done: r.reduce((n, x) => n + x.count, 0) }))}
              secondary={{
                label: "Togli la scadenza",
                onClick: () => run<{ count: number }>("due", (itemIds) => setItemsDueAction(workspaceId, caseId, { itemIds, dueAt: null, isProposal: true }), (r) => ({ done: r.reduce((n, x) => n + x.count, 0), extra: { cleared: true } })),
              }}
            >
              <label className="block text-sm">
                <span className="mb-1 block text-muted-foreground">Entro il</span>
                <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="min-h-11 w-48 sm:min-h-8" />
              </label>
            </DialogBody>
          )}
          {(mode === "missing" || mode === "partial") && (
            <DialogBody
              title={mode === "missing" ? "Segna: manca il dato" : "Segna: risposta parziale"}
              note={`Il motivo resta visibile sulla domanda. ${appliesTo(eligible(mode))}`}
              busy={busy}
              submit={mode === "missing" ? "Segna: manca il dato" : "Segna: risposta parziale"}
              ready={text.trim().length >= 3}
              onCancel={close}
              onSubmit={() =>
                run<{ items: unknown[] }>(
                  mode,
                  (itemIds) => transitionItemsAction(workspaceId, caseId, { itemIds, trigger: mode === "missing" ? "esito_mancante" : "esito_parziale", reason: text.trim() }),
                  (r) => ({ done: r.reduce((n, x) => n + x.items.length, 0) }),
                )
              }
            >
              <label className="block text-sm">
                <span className="mb-1 block text-muted-foreground">{mode === "missing" ? "Perché manca" : "Cosa manca ancora"}</span>
                <Textarea value={text} onChange={(e) => setText(e.target.value)} maxLength={500} rows={3} />
              </label>
            </DialogBody>
          )}
          {mode === "na" && (
            <DialogBody
              title="Proponi “non si applica”"
              note={`Poi servono due firme: Lateral Space e il cliente. ${appliesTo(eligible("na"))}${eligible("na") === MAX_NA_AT_ONCE ? ` Al massimo ${MAX_NA_AT_ONCE} alla volta.` : ""}`}
              busy={busy}
              submit="Proponi “non si applica”"
              ready={text.trim().length >= 10}
              onCancel={close}
              onSubmit={proposeNaInBlock}
            >
              <label className="block text-sm">
                <span className="mb-1 block text-muted-foreground">Perché non si applica (almeno 10 caratteri)</span>
                <Textarea value={text} onChange={(e) => setText(e.target.value)} maxLength={2000} rows={3} />
              </label>
            </DialogBody>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

function DialogBody({
  title,
  note,
  busy,
  submit,
  ready,
  onCancel,
  onSubmit,
  secondary,
  children,
}: {
  title: string;
  note: string;
  busy: boolean;
  submit: string;
  ready: boolean;
  onCancel: () => void;
  onSubmit: () => void;
  secondary?: { label: string; onClick: () => void };
  children: React.ReactNode;
}) {
  return (
    <form
      className="grid gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (ready && !busy) onSubmit();
      }}
    >
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>{note}</DialogDescription>
      </DialogHeader>
      {children}
      <DialogFooter>
        <Button type="button" variant="ghost" className="min-h-11 sm:min-h-8" onClick={onCancel} disabled={busy}>
          Annulla
        </Button>
        {secondary && (
          <Button type="button" variant="outline" className="min-h-11 sm:min-h-8" onClick={secondary.onClick} disabled={busy}>
            {secondary.label}
          </Button>
        )}
        <Button type="submit" className="min-h-11 sm:min-h-8" disabled={!ready || busy}>
          {busy && <Loader2 className="animate-spin" aria-hidden />}
          {submit}
        </Button>
      </DialogFooter>
    </form>
  );
}
