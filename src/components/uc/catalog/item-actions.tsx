"use client";

import { useState } from "react";
import Link from "next/link";
import { Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { ActionMenu, type ActionMenuItem } from "@/components/uc/ui/action-menu";
import {
  markMissingAction,
  markPartialAction,
  proposeFallbackAction,
  proposeNaAction,
  proposeWaiverAction,
  recordLsAnswerAction,
  reopenItemAction,
  requestClarificationAction,
  validateItemAction,
} from "@/lib/actions/uc-catalog";
import { assignItemsAction, sendRequestsAction } from "@/lib/actions/uc-people";
import { cn } from "@/lib/utils";
import { QUESTION_ACTION_LABEL, type ItemActions, type QuestionActionKey, type QuestionActionPlan } from "@/lib/uc/views/item-detail";
import type { ResponseType } from "@/lib/uc/vocab";
import { SELECT_CLASS } from "./catalog-filters";
import { useUcAction } from "./use-uc-action";

/** Le azioni che aprono un modulo sotto la riga dei pulsanti. */
type FormKey = Exclude<QuestionActionKey, "validate" | "askAgain">;

export interface QuestionActionBarProps {
  workspaceId: string;
  caseId: string;
  itemId: string;
  plan: QuestionActionPlan;
  actions: ItemActions;
  /** «Chiedi al referente» o «Chiedi di nuovo». */
  askAgainLabel: string;
  responseType: ResponseType | null;
  options: { value: string; label: string }[];
  requiresValidity: boolean;
  /** «Affida a un altro collega» (responsabile del cliente): i colleghi a cui affidarla. */
  reassign: { contacts: { id: string; name: string; roleLabel: string | null }[]; currentId: string | null } | null;
  /**
   * Prima primaria piena: solo dentro il pannello (un dialogo). Sulla pagina
   * intera tutto è `outline`, perché il pulsante pieno è quello della testata.
   */
  filledFirst: boolean;
  /** Pulsante pieno nei moduli (chiarimento, motivi…): di base come `filledFirst`; fuori da un dialogo con una primaria piena va spento. */
  filledForms?: boolean;
  /** Dopo un'azione riuscita (per esempio: la scheda successiva in «Verifica una alla volta»). */
  onDone?: () => void;
  /** Valida e chiarimento hanno tasti rapidi in «Verifica una alla volta». */
  shortcuts?: boolean;
  /** Apre da fuori un modulo (il tasto C della verifica). */
  openForm?: FormKey | null;
  onFormChange?: (form: FormKey | null) => void;
  className?: string;
}

/**
 * Le azioni della domanda (DESIGN §3.6.5): al massimo 2 primarie scelte dallo
 * stato, tutte le altre nel menu «⋯». Le azioni con un motivo aprono un modulo
 * sotto i pulsanti; «Valida» spento dice perché (quattro occhi). Ogni comando
 * ricontrolla tutto lato server.
 */
export function QuestionActionBar(props: QuestionActionBarProps) {
  const { workspaceId, caseId, itemId, plan, actions } = props;
  const { pending, run } = useUcAction();
  const filledForms = props.filledForms ?? props.filledFirst;
  const [ownForm, setOwnForm] = useState<FormKey | null>(null);
  const form = props.openForm !== undefined ? props.openForm : ownForm;
  const setForm = (f: FormKey | null) => (props.onFormChange ? props.onFormChange(f) : setOwnForm(f));
  const done = () => {
    setForm(null);
    props.onDone?.();
  };
  const label = (k: QuestionActionKey) => (k === "askAgain" ? props.askAgainLabel : QUESTION_ACTION_LABEL[k]);

  const act = (k: QuestionActionKey) => {
    switch (k) {
      case "validate":
        return run(() => validateItemAction(workspaceId, caseId, { itemId }), { success: "Risposta validata: la domanda è a posto.", onSuccess: done });
      case "askAgain":
        return run(() => sendRequestsAction(workspaceId, caseId, { itemIds: [itemId], message: null }), { success: "Domanda inviata al referente.", onSuccess: done });
      default:
        return setForm(form === k ? null : k);
    }
  };
  /** Un'azione presente ma oggi non possibile: il motivo, da mostrare accanto. */
  const blocked = (k: QuestionActionKey): string | null => {
    const check = k === "validate" ? actions.validate : k === "proposeWaiver" ? actions.proposeWaiver : k === "record" ? actions.recordValue : null;
    return check && !check.ok ? check.message : null;
  };

  const menu: ActionMenuItem[] = plan.more.map((k) => ({ label: label(k), onSelect: () => act(k), disabled: pending || blocked(k) !== null, hint: blocked(k) ?? undefined }));
  const reasons = plan.primary.map(blocked).filter((m): m is string => m !== null);
  if (plan.primary.length === 0 && menu.length === 0) return null;

  return (
    <div className={cn("min-w-0 space-y-3", props.className)}>
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        {plan.primary.map((k, i) => (
          <Button
            key={k}
            type="button"
            variant={i === 0 && props.filledFirst ? "default" : "outline"}
            className="min-h-11 sm:min-h-8"
            disabled={pending || blocked(k) !== null}
            aria-expanded={k === "validate" || k === "askAgain" ? undefined : form === k}
            aria-keyshortcuts={props.shortcuts ? (k === "validate" ? "V" : k === "clarify" ? "C" : undefined) : undefined}
            onClick={() => act(k)}
          >
            {label(k)}
          </Button>
        ))}
        <ActionMenu items={menu} label={props.shortcuts ? "Altro" : "Altre azioni sulla domanda"} trigger={props.shortcuts ? "altro" : "icon"} />
      </div>
      {reasons.map((r) => (
        <p key={r} className="flex items-start gap-1.5 text-sm text-muted-foreground">
          <Lock className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          {r}
        </p>
      ))}

      {form === "clarify" && (
        <TextForm
          label="Domanda per il referente"
          hint="La domanda torna al referente, con il tuo chiarimento."
          min={5}
          max={4000}
          submit="Invia il chiarimento"
          filled={filledForms}
          pending={pending}
          onCancel={() => setForm(null)}
          onSubmit={(message) => run(() => requestClarificationAction(workspaceId, caseId, { itemId, message }), { success: "Chiarimento inviato.", onSuccess: done })}
        />
      )}
      {form === "partial" && (
        <TextForm label="Cosa manca ancora" hint="Il motivo resta visibile sulla domanda." min={3} max={500} submit="Segna: risposta parziale" filled={filledForms} pending={pending} onCancel={() => setForm(null)} onSubmit={(reason) => run(() => markPartialAction(workspaceId, caseId, { itemId, reason }), { success: "Segnata: risposta parziale.", onSuccess: done })} />
      )}
      {form === "missing" && (
        <TextForm label="Perché manca" hint="Il motivo resta visibile sulla domanda." min={3} max={500} submit="Segna: manca il dato" filled={filledForms} pending={pending} onCancel={() => setForm(null)} onSubmit={(reason) => run(() => markMissingAction(workspaceId, caseId, { itemId, reason }), { success: "Segnata: manca il dato.", onSuccess: done })} />
      )}
      {form === "proposeNa" && (
        <TextForm
          label="Perché non si applica"
          hint="Almeno 10 caratteri. Poi servono due firme: Lateral Space e il cliente."
          min={10}
          max={2000}
          submit="Proponi “non si applica”"
          filled={filledForms}
          pending={pending}
          onCancel={() => setForm(null)}
          onSubmit={(reason) => run(() => proposeNaAction(workspaceId, caseId, { itemId, reason }), { success: "Proposta registrata: servono le due firme.", onSuccess: done })}
        />
      )}
      {form === "reopen" && (
        <TextForm label="Perché la riapri" hint="Le firme di «non si applica» si azzerano e restano nell'attività." min={3} max={500} submit="Riapri" filled={filledForms} pending={pending} onCancel={() => setForm(null)} onSubmit={(reason) => run(() => reopenItemAction(workspaceId, caseId, { itemId, reason }), { success: "Domanda riaperta.", onSuccess: done })} />
      )}
      {form === "proposeWaiver" && <WaiverForm pending={pending} filled={filledForms} onSubmit={(v) => run(() => proposeWaiverAction(workspaceId, caseId, { itemId, ...v }), { success: "Proposta registrata: servono le due firme.", onSuccess: done })} />}
      {form === "proposeFallback" && <FallbackForm pending={pending} filled={filledForms} onSubmit={(v) => run(() => proposeFallbackAction(workspaceId, caseId, { itemId, ...v }), { success: "Proposta registrata: servono le due firme.", onSuccess: done })} />}
      {form === "record" && actions.recordValue?.ok && (
        <RecordValueForm
          responseType={props.responseType}
          options={props.options}
          requiresValidity={props.requiresValidity}
          pending={pending}
          filled={filledForms}
          onSubmit={(input) => run(() => recordLsAnswerAction(workspaceId, caseId, { itemId, ...input }), { success: "Valore inserito: ora lo verifica un collega.", onSuccess: done })}
        />
      )}
      {form === "reassign" && props.reassign && (
        <ReassignForm
          contacts={props.reassign.contacts.filter((c) => c.id !== props.reassign?.currentId)}
          pending={pending}
          filled={filledForms}
          onCancel={() => setForm(null)}
          onSubmit={(contactId) => run(() => assignItemsAction(workspaceId, caseId, { mode: "voci", itemIds: [itemId], contactId }), { success: "Domanda affidata al collega.", onSuccess: done })}
        />
      )}
    </div>
  );
}

/** Link «Firma» dell'avviso in linea: porta a `/firme`, l'unico posto dove si firma (o si respinge), una decisione alla volta. */
export function SignLink({ href }: { href: string }) {
  return (
    <Button variant="outline" size="sm" className="min-h-11 sm:min-h-7" render={<Link href={href} />} nativeButton={false}>
      Firma
    </Button>
  );
}

function ReassignForm({ contacts, pending, filled, onCancel, onSubmit }: { contacts: { id: string; name: string; roleLabel: string | null }[]; pending: boolean; filled: boolean; onCancel: () => void; onSubmit: (contactId: string) => void }) {
  const [contactId, setContactId] = useState<string | null>(null);
  const items = contacts.map((c) => ({ value: c.id, label: c.roleLabel ? `${c.name} · ${c.roleLabel}` : c.name }));
  return (
    <form
      className="space-y-2 rounded-lg p-3 ring-1 ring-foreground/10"
      onSubmit={(e) => {
        e.preventDefault();
        if (contactId) onSubmit(contactId);
      }}
    >
      {contacts.length === 0 ? (
        <p className="text-sm text-muted-foreground">Non ci sono altri colleghi a cui affidarla: aggiungili da Persone.</p>
      ) : (
        <Select items={items} value={contactId} onValueChange={(v) => setContactId(v ? String(v) : null)}>
          <SelectTrigger className="min-h-11 w-full sm:min-h-8" aria-label="Collega">
            <SelectValue placeholder="Scegli il collega" />
          </SelectTrigger>
          <SelectContent>
            {items.map((c) => (
              <SelectItem key={c.value} value={c.value}>
                {c.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" variant={filled ? "default" : "outline"} className="min-h-11 sm:min-h-8" disabled={!contactId || pending}>
          Affida
        </Button>
        <Button type="button" variant="ghost" className="min-h-11 sm:min-h-8" onClick={onCancel}>
          Annulla
        </Button>
      </div>
    </form>
  );
}

function TextForm({
  label,
  hint,
  min,
  max,
  submit,
  pending,
  filled,
  onCancel,
  onSubmit,
}: {
  label: string;
  hint?: string;
  min: number;
  max: number;
  submit: string;
  pending: boolean;
  filled: boolean;
  onCancel: () => void;
  onSubmit: (text: string) => void;
}) {
  const [text, setText] = useState("");
  return (
    <form
      className="space-y-2 rounded-lg p-3 ring-1 ring-foreground/10"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(text.trim());
      }}
    >
      <label className="block">
        <span className="mb-1 block text-sm font-medium">{label}</span>
        {/* Si apre per scrivere: il cursore va subito nel campo. */}
        <Textarea value={text} onChange={(e) => setText(e.target.value)} maxLength={max} rows={3} autoFocus />
      </label>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" variant={filled ? "default" : "outline"} className="min-h-11 sm:min-h-8" disabled={text.trim().length < min || pending}>
          {submit}
        </Button>
        <Button type="button" variant="ghost" className="min-h-11 sm:min-h-8" onClick={onCancel}>
          Annulla
        </Button>
      </div>
    </form>
  );
}

function WaiverForm({ pending, filled, onSubmit }: { pending: boolean; filled: boolean; onSubmit: (v: { motivo: string; piano: string; scadenza: string }) => void }) {
  const [motivo, setMotivo] = useState("");
  const [piano, setPiano] = useState("");
  const [scadenza, setScadenza] = useState("");
  return (
    <form
      className="space-y-2 rounded-lg p-3 ring-1 ring-foreground/10"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit({ motivo: motivo.trim(), piano: piano.trim(), scadenza });
      }}
    >
      <p className="text-xs text-muted-foreground">Al massimo il 10% delle domande indispensabili. Mai su dati personali, regole di legge, vincoli rigidi o domande bloccate.</p>
      <label className="block">
        <span className="mb-1 block text-sm font-medium">Motivo</span>
        <Textarea value={motivo} onChange={(e) => setMotivo(e.target.value)} maxLength={2000} rows={2} />
      </label>
      <label className="block">
        <span className="mb-1 block text-sm font-medium">Come si avrà la risposta</span>
        <Textarea value={piano} onChange={(e) => setPiano(e.target.value)} maxLength={2000} rows={2} />
      </label>
      <label className="block">
        <span className="mb-1 block text-sm font-medium">Entro quando</span>
        <Input type="date" value={scadenza} onChange={(e) => setScadenza(e.target.value)} className="w-44" />
      </label>
      <Button type="submit" variant={filled ? "default" : "outline"} className="min-h-11 sm:min-h-8" disabled={motivo.trim().length < 10 || piano.trim().length < 10 || !scadenza || pending}>
        Proponi di partire senza risposta
      </Button>
    </form>
  );
}

function FallbackForm({ pending, filled, onSubmit }: { pending: boolean; filled: boolean; onSubmit: (v: { descrizione: string; daSostituireEntro: string }) => void }) {
  const [descrizione, setDescrizione] = useState("");
  const [until, setUntil] = useState("");
  return (
    <form
      className="space-y-2 rounded-lg p-3 ring-1 ring-foreground/10"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit({ descrizione: descrizione.trim(), daSostituireEntro: until });
      }}
    >
      <p className="text-xs text-muted-foreground">Vale solo per il via allo sviluppo e solo se il blocco lo permette.</p>
      <label className="block">
        <span className="mb-1 block text-sm font-medium">Soluzione provvisoria</span>
        <Textarea value={descrizione} onChange={(e) => setDescrizione(e.target.value)} maxLength={2000} rows={2} />
      </label>
      <label className="block">
        <span className="mb-1 block text-sm font-medium">Da sostituire entro</span>
        <Input type="date" value={until} onChange={(e) => setUntil(e.target.value)} className="w-44" />
      </label>
      <Button type="submit" variant={filled ? "default" : "outline"} className="min-h-11 sm:min-h-8" disabled={descrizione.trim().length < 10 || !until || pending}>
        Proponi la soluzione provvisoria
      </Button>
    </form>
  );
}

const SOURCE_KINDS = [
  ["documento", "Documento"],
  ["sistema", "Sistema"],
  ["lateral_space", "Lateral Space (calcolo o analisi)"],
] as const;

const BASIS = [
  ["", "Da dove viene: non indicato"],
  ["sistema", "Dal sistema"],
  ["documento", "Da un documento"],
  ["stima_a_memoria", "Stima a memoria"],
  ["calcolo", "Calcolo"],
] as const;

const CONFIDENCE = [
  ["", "Affidabilità: non indicata"],
  ["certo", "Certo"],
  ["stima", "È una stima"],
  ["da_verificare", "Da verificare"],
] as const;

function RecordValueForm({
  responseType,
  options,
  requiresValidity,
  pending,
  filled,
  onSubmit,
}: {
  responseType: ResponseType | null;
  options: { value: string; label: string }[];
  requiresValidity: boolean;
  pending: boolean;
  filled: boolean;
  onSubmit: (input: Record<string, unknown>) => void;
}) {
  const [text, setText] = useState("");
  const [choice, setChoice] = useState("");
  const [multi, setMulti] = useState<string[]>([]);
  const [exceptions, setExceptions] = useState("");
  const [sourceKind, setSourceKind] = useState<string>("documento");
  const [sourceRef, setSourceRef] = useState("");
  const [basis, setBasis] = useState("");
  const [confidence, setConfidence] = useState("");
  const [validFrom, setValidFrom] = useState("");
  const [note, setNote] = useState("");
  const type = responseType ?? "testo";

  const value = (): unknown => {
    switch (type) {
      case "scelta":
        return options.length ? { option: choice } : text;
      case "scelta_multipla":
        return options.length ? { options: multi } : text;
      case "si_no":
        return { value: choice };
      case "conferma_regola":
        return { choice, text: text || undefined, exceptions: exceptions || undefined };
      case "conferma_formula":
        return { choice, formula: text || undefined };
      default:
        return text;
    }
  };
  const needsChoice = (type === "scelta" && options.length > 0) || type === "si_no" || type === "conferma_regola" || type === "conferma_formula";
  const valueReady =
    type === "scelta_multipla" && options.length > 0 ? multi.length > 0 : needsChoice ? choice !== "" && (choice !== "correggo" || text.trim() !== "") : text.trim() !== "";
  const ready = sourceRef.trim().length >= 2 && (!requiresValidity || validFrom !== "") && valueReady;

  return (
    <form
      className="space-y-3 rounded-lg p-3 ring-1 ring-foreground/10"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit({
          value: value(),
          sourceKind,
          sourceRef: sourceRef.trim(),
          sourceBasis: basis || null,
          confidence: confidence || null,
          validFrom: validFrom || null,
          note: note.trim() || null,
        });
      }}
    >
      <p className="text-xs text-muted-foreground">Chi inserisce il valore non lo può validare. Niente dati personali: quelli passano solo dalla zona personale.</p>
      {type === "scelta" && options.length > 0 && (
        <label className="block">
          <span className="mb-1 block text-sm font-medium">Valore</span>
          <select className={SELECT_CLASS} value={choice} onChange={(e) => setChoice(e.target.value)}>
            <option value="">Scegli</option>
            {options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
      )}
      {type === "scelta_multipla" && options.length > 0 && (
        <fieldset>
          <legend className="mb-1 text-sm font-medium">Valori</legend>
          <div className="space-y-1">
            {options.map((o) => (
              <label key={o.value} className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={multi.includes(o.value)} onChange={(e) => setMulti((m) => (e.target.checked ? [...m, o.value] : m.filter((x) => x !== o.value)))} />
                {o.label}
              </label>
            ))}
          </div>
        </fieldset>
      )}
      {type === "si_no" && (
        <label className="block">
          <span className="mb-1 block text-sm font-medium">Valore</span>
          <select className={SELECT_CLASS} value={choice} onChange={(e) => setChoice(e.target.value)}>
            <option value="">Scegli</option>
            <option value="sì">Sì</option>
            <option value="no">No</option>
          </select>
        </label>
      )}
      {(type === "conferma_regola" || type === "conferma_formula") && (
        <label className="block">
          <span className="mb-1 block text-sm font-medium">Esito</span>
          <select className={SELECT_CLASS} value={choice} onChange={(e) => setChoice(e.target.value)}>
            <option value="">Scegli</option>
            <option value="confermo">Confermata così</option>
            <option value="correggo">Va corretta</option>
            {type === "conferma_regola" && <option value="non_vale">Non vale</option>}
          </select>
        </label>
      )}
      {!(type === "scelta" && options.length) && !(type === "scelta_multipla" && options.length) && type !== "si_no" && (
        <label className="block">
          <span className="mb-1 block text-sm font-medium">
            {type === "conferma_regola" ? "Testo corretto (se va corretta)" : type === "conferma_formula" ? "Formula corretta (se va corretta)" : "Valore"}
          </span>
          {type === "tabella" || type === "testo" || type === "conferma_regola" || type === "conferma_formula" ? (
            <Textarea value={text} onChange={(e) => setText(e.target.value)} rows={type === "tabella" ? 6 : 3} placeholder={type === "tabella" ? "Incolla la tabella da Excel, con l'intestazione" : undefined} />
          ) : (
            <Input value={text} onChange={(e) => setText(e.target.value)} placeholder="Scrivilo come lo scriverebbe il referente, es. 1.200 € IVA esclusa a volo" />
          )}
        </label>
      )}
      {type === "conferma_regola" && (
        <label className="block">
          <span className="mb-1 block text-sm font-medium">Eccezioni</span>
          <Input value={exceptions} onChange={(e) => setExceptions(e.target.value)} placeholder="Oppure «nessuna»" />
        </label>
      )}
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1 block text-sm font-medium">Fonte</span>
          <select className={SELECT_CLASS} value={sourceKind} onChange={(e) => setSourceKind(e.target.value)}>
            {SOURCE_KINDS.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-sm font-medium">Riferimento della fonte</span>
          <Input value={sourceRef} onChange={(e) => setSourceRef(e.target.value)} maxLength={500} placeholder="Es. Listino 2026, pagina 3" />
        </label>
        <label className="block">
          <span className="sr-only">Da dove viene</span>
          <select className={SELECT_CLASS} value={basis} onChange={(e) => setBasis(e.target.value)}>
            {BASIS.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="sr-only">Affidabilità</span>
          <select className={SELECT_CLASS} value={confidence} onChange={(e) => setConfidence(e.target.value)}>
            {CONFIDENCE.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-sm font-medium">Valido dal{requiresValidity ? " (obbligatorio)" : ""}</span>
          <Input type="date" value={validFrom} onChange={(e) => setValidFrom(e.target.value)} />
        </label>
      </div>
      <label className="block">
        <span className="mb-1 block text-sm font-medium">Nota</span>
        <Textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} rows={2} />
      </label>
      <Button type="submit" variant={filled ? "default" : "outline"} className="min-h-11 sm:min-h-8" disabled={!ready || pending}>
        Inserisci il valore
      </Button>
    </form>
  );
}
