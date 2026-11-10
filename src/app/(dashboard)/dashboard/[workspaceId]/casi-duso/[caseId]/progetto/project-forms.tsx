"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useUcAction } from "@/components/uc/catalog/use-uc-action";
import {
  addDecisionAction,
  approveProjectAction,
  generatePackageAction,
  recordAiBoardOkAction,
  reopenProjectAction,
  requestProjectChangeAction,
  saveProjectDetailsAction,
  saveProjectTopicAction,
  startProjectAction,
  submitProjectAction,
} from "@/lib/actions/use-case-factory";
import type { UcActionResult } from "@/lib/actions/uc-action-context";
import { italianAmount } from "@/lib/use-cases/factory/italian-amount";

const FIELD = "h-11 text-base sm:h-9 sm:text-sm";
const AREA = "text-base sm:text-sm";
const BUTTON = "min-h-11 sm:min-h-9";
const ERROR = "text-xs text-destructive";

type Ids = { workspaceId: string; caseId: string };

/**
 * Dopo un'azione che toglie il pulsante da cui si era partiti, il fuoco torna al titolo della pagina. La pagina si
 * aggiorna dopo la risposta: si riprova per un secondo, e solo se il fuoco è rimasto a nessuno (mai lo si toglie a
 * un campo o a un pulsante dove chi usa la pagina è già andato).
 */
function focusTitle() {
  let tries = 0;
  const tick = () => {
    const title = document.getElementById("progetto-titolo");
    const lost = document.activeElement === null || document.activeElement === document.body;
    if (title && lost) title.focus();
    if (++tries < 10) window.setTimeout(tick, 100);
  };
  window.setTimeout(tick, 50);
}

/** L'azione principale della pagina, una sola, secondo lo stato del progetto e chi guarda. */
export function ProjectPrimaryAction({
  workspaceId,
  caseId,
  action,
  revision,
  blocked = false,
}: Ids & { action: "imposta" | "manda" | "approva" | "rivedi" | null; revision: number | null; blocked?: boolean }) {
  const { pending, run } = useUcAction();
  if (!action) return null;
  const label = { imposta: "Imposta lo use case", manda: "Manda in approvazione", approva: "Approva il progetto", rivedi: "Rivedi il progetto" }[action];
  const calls: Record<"imposta" | "manda" | "approva" | "rivedi", () => Promise<UcActionResult<unknown>>> = {
    imposta: () => startProjectAction(workspaceId, caseId),
    rivedi: () => startProjectAction(workspaceId, caseId),
    manda: () => submitProjectAction(workspaceId, caseId, { revision }),
    approva: () => approveProjectAction(workspaceId, caseId, { revision }),
  };
  const call = calls[action];
  // «Rivedi il progetto» non è urgente: secondario, accanto all'azione principale del dossier. «Manda in
  // approvazione» aspetta le 10 scelte: la pagina dice quali mancano.
  return (
    <Button variant={action === "rivedi" ? "outline" : "default"} className={BUTTON} disabled={pending || (action === "manda" && blocked)} onClick={() => run(call, { onSuccess: focusTitle })}>
      {label}
    </Button>
  );
}

/**
 * «Riapri per cambiarlo»: il progetto da approvare torna in corso. Solo il responsabile, con la conferma: l'ok
 * dell'AI Board, se c'era, decade.
 */
export function ReopenProject({ workspaceId, caseId, revision, boardOkOn, primary }: Ids & { revision: number; boardOkOn: string | null; primary: boolean }) {
  const { pending, run } = useUcAction();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant={primary ? "default" : "outline"} className={BUTTON} onClick={() => setOpen(true)}>
        Riapri per cambiarlo
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Riaprire il progetto?</DialogTitle>
            <DialogDescription>
              {boardOkOn
                ? `Riaprendo, l'ok dell'AI Board del ${boardOkOn} decade e andrà chiesto di nuovo: l'AI Board lo saprà dalla campanella.`
                : "Il progetto torna in corso: si può cambiare e poi rimandare in approvazione."}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" className={BUTTON} onClick={() => setOpen(false)}>
              Annulla
            </Button>
            <Button
              className={BUTTON}
              disabled={pending}
              onClick={() =>
                run(() => reopenProjectAction(workspaceId, caseId, { revision }), {
                  onSuccess: () => {
                    setOpen(false);
                    focusTitle();
                  },
                })
              }
            >
              Riapri
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** La scelta di un argomento: cosa, perché, l'alternativa scartata. */
export function TopicEditor({
  workspaceId,
  caseId,
  topic,
  label,
  current,
}: Ids & { topic: string; label: string; current: { scelta: string; perche: string | null; alternativa: string | null } | null }) {
  const { pending, run } = useUcAction();
  const [open, setOpen] = useState(false);
  const [scelta, setScelta] = useState(current?.scelta ?? "");
  const [perche, setPerche] = useState(current?.perche ?? "");
  const [alternativa, setAlternativa] = useState(current?.alternativa ?? "");
  return (
    <>
      <Button variant="ghost" size="sm" className="min-h-11 sm:min-h-8" onClick={() => setOpen(true)} aria-label={`${current ? "Cambia" : "Scegli"}: ${label}`}>
        {current ? "Cambia" : "Scegli"}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{label}</DialogTitle>
            <DialogDescription>
              Diventa anche una decisione del caso, con il giorno{current ? "; quella di prima resta nello storico come sostituita" : ""}.
            </DialogDescription>
          </DialogHeader>
          <form
            className="grid gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              run(() => saveProjectTopicAction(workspaceId, caseId, { topic, scelta: scelta.trim(), perche: perche.trim() || null, alternativa: alternativa.trim() || null }), {
                onSuccess: () => setOpen(false),
              });
            }}
          >
            <div className="space-y-1.5">
              <Label htmlFor={`scelta-${topic}`}>La scelta</Label>
              <Textarea id={`scelta-${topic}`} value={scelta} maxLength={500} rows={3} onChange={(e) => setScelta(e.target.value)} className={AREA} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`perche-${topic}`}>Perché</Label>
              <Textarea id={`perche-${topic}`} value={perche} maxLength={1000} rows={2} onChange={(e) => setPerche(e.target.value)} className={AREA} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`alternativa-${topic}`}>Alternativa scartata</Label>
              <Input id={`alternativa-${topic}`} value={alternativa} maxLength={500} onChange={(e) => setAlternativa(e.target.value)} className={FIELD} />
            </div>
            <DialogFooter>
              <Button type="submit" className={BUTTON} disabled={pending || scelta.trim().length === 0}>
                Salva
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

function amountError(value: number | null, max: number): string | null {
  if (value === null) return null;
  if (!Number.isFinite(value)) return "Scrivi un numero, per esempio 40 o 12,5.";
  if (value > max) return `Al massimo ${new Intl.NumberFormat("it-IT").format(max)}.`;
  return null;
}

/** Strumenti nuovi (uno per riga, «Nome: perché») e stima, con gli errori accanto ai campi. */
export function DetailsEditor({
  workspaceId,
  caseId,
  tools,
  hours,
  cost,
  limits,
}: Ids & { tools: { nome: string; perche: string | null }[]; hours: number | null; cost: number | null; limits: { hours: number; cost: number; tools: number } }) {
  const { pending, run } = useUcAction();
  const [open, setOpen] = useState(false);
  const [toolsText, setToolsText] = useState(tools.map((t) => (t.perche ? `${t.nome}: ${t.perche}` : t.nome)).join("\n"));
  const [hoursText, setHoursText] = useState(hours === null ? "" : String(hours).replace(".", ","));
  const [costText, setCostText] = useState(cost === null ? "" : String(cost).replace(".", ","));
  const parsedTools = toolsText
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const at = line.indexOf(":");
      return at > 0 ? { nome: line.slice(0, at).trim(), perche: line.slice(at + 1).trim() || null } : { nome: line, perche: null };
    });
  const hoursValue = italianAmount(hoursText);
  const costValue = italianAmount(costText);
  const hoursError = amountError(hoursValue, limits.hours);
  const costError = amountError(costValue, limits.cost);
  const toolsError = parsedTools.length > limits.tools ? `Al massimo ${limits.tools} strumenti nuovi.` : parsedTools.some((t) => t.nome.length > 80) ? "Il nome di uno strumento è troppo lungo: al massimo 80 caratteri prima dei due punti." : null;
  const invalid = Boolean(hoursError || costError || toolsError);
  return (
    <>
      <Button variant="outline" className={BUTTON} onClick={() => setOpen(true)}>
        Cambia strumenti e stima
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Strumenti nuovi e stima</DialogTitle>
            <DialogDescription>Uno strumento nuovo per il cliente chiede l&apos;ok dell&apos;AI Board prima dell&apos;approvazione.</DialogDescription>
          </DialogHeader>
          <form
            className="grid gap-4"
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              if (invalid) return;
              run(() => saveProjectDetailsAction(workspaceId, caseId, { newTools: parsedTools, estimateHours: hoursValue, monthlyCostEur: costValue }), { onSuccess: () => setOpen(false) });
            }}
          >
            <div className="space-y-1.5">
              <Label htmlFor="strumenti-nuovi">Strumenti nuovi, uno per riga</Label>
              <Textarea
                id="strumenti-nuovi"
                value={toolsText}
                rows={3}
                placeholder="Neon: il database del caso, in UE"
                aria-invalid={toolsError ? true : undefined}
                aria-describedby={toolsError ? "strumenti-nuovi-errore" : undefined}
                onChange={(e) => setToolsText(e.target.value)}
                className={AREA}
              />
              {toolsError ? (
                <p id="strumenti-nuovi-errore" className={ERROR}>
                  {toolsError}
                </p>
              ) : null}
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="stima-ore">Costruzione, in ore</Label>
                <Input
                  id="stima-ore"
                  inputMode="decimal"
                  value={hoursText}
                  aria-invalid={hoursError ? true : undefined}
                  aria-describedby={hoursError ? "stima-ore-errore" : undefined}
                  onChange={(e) => setHoursText(e.target.value)}
                  className={FIELD}
                />
                {hoursError ? (
                  <p id="stima-ore-errore" className={ERROR}>
                    {hoursError}
                  </p>
                ) : null}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="stima-costo">Esercizio, € al mese</Label>
                <Input
                  id="stima-costo"
                  inputMode="decimal"
                  value={costText}
                  aria-invalid={costError ? true : undefined}
                  aria-describedby={costError ? "stima-costo-errore" : undefined}
                  onChange={(e) => setCostText(e.target.value)}
                  className={FIELD}
                />
                {costError ? (
                  <p id="stima-costo-errore" className={ERROR}>
                    {costError}
                  </p>
                ) : null}
              </div>
            </div>
            <DialogFooter>
              <Button type="submit" className={BUTTON} disabled={pending || invalid}>
                Salva
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

/**
 * L'ok dell'AI Board agli strumenti nuovi, che il dialogo elenca. Chi ha il ruolo `ai_board` dà l'ok (la nota è
 * facoltativa) o chiede una modifica (con la nota); il responsabile registra l'ok per suo conto, scrivendo chi
 * l'ha dato e quando.
 */
export function AiBoardOk({
  workspaceId,
  caseId,
  noteRequired,
  canAskChange,
  revision,
  tools,
  noteMin,
  noteMax,
}: Ids & { noteRequired: boolean; canAskChange: boolean; revision: number; tools: { nome: string; perche: string | null }[]; noteMin: number; noteMax: number }) {
  const { pending, run } = useUcAction();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const short = note.trim().length < noteMin;
  const done = () => {
    setOpen(false);
    setNote("");
    focusTitle();
  };
  const trigger = noteRequired ? "Registra l'ok dell'AI Board" : "Dai l'ok agli strumenti nuovi";
  return (
    <>
      <Button className={BUTTON} onClick={() => setOpen(true)}>
        {trigger}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{tools.length === 1 ? "Lo strumento nuovo per il cliente" : `I ${tools.length} strumenti nuovi per il cliente`}</DialogTitle>
            <DialogDescription>
              {noteRequired
                ? "Lo registri per conto dell'AI Board: scrivi chi l'ha dato e quando."
                : canAskChange
                  ? "Con il tuo ok il responsabile del caso può approvare il progetto. Se qualcosa non va, chiedi una modifica."
                  : "Con il tuo ok il responsabile del caso può approvare il progetto."}
            </DialogDescription>
          </DialogHeader>
          <ul className="space-y-1 rounded-md border p-3 text-sm">
            {tools.map((tool) => (
              <li key={tool.nome}>
                <span className="font-medium">{tool.nome}</span>
                {tool.perche ? <span className="text-muted-foreground"> · {tool.perche}</span> : null}
              </li>
            ))}
          </ul>
          <form
            className="grid gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (noteRequired && short) return;
              run(() => recordAiBoardOkAction(workspaceId, caseId, { note: note.trim() || null, revision }), { onSuccess: done });
            }}
          >
            <div className="space-y-1.5">
              <Label htmlFor="nota-ai-board">{noteRequired ? "Chi l'ha dato e quando" : canAskChange ? "Nota" : "Nota (se serve)"}</Label>
              <Textarea id="nota-ai-board" value={note} maxLength={noteMax} rows={3} aria-describedby="nota-ai-board-aiuto" onChange={(e) => setNote(e.target.value)} className={AREA} />
              <p id="nota-ai-board-aiuto" className="text-xs text-muted-foreground">
                {noteRequired
                  ? `Almeno ${noteMin} caratteri: per esempio il ruolo di chi l'ha dato e il giorno.`
                  : canAskChange
                    ? `Facoltativa per l'ok. Per chiedere una modifica scrivi che cosa cambiare, in almeno ${noteMin} caratteri.`
                    : "Facoltativa."}
              </p>
            </div>
            <DialogFooter className="gap-2">
              {canAskChange ? (
                <Button
                  type="button"
                  variant="outline"
                  className={BUTTON}
                  disabled={pending || short}
                  onClick={() => run(() => requestProjectChangeAction(workspaceId, caseId, { note: note.trim(), revision }), { onSuccess: done })}
                >
                  Chiedi una modifica
                </Button>
              ) : null}
              <Button type="submit" className={BUTTON} disabled={pending || (noteRequired && short)}>
                {noteRequired ? "Registra l'ok" : "Dai l'ok"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** Una decisione del team. */
export function DecisionForm({ workspaceId, caseId }: Ids) {
  const { pending, run } = useUcAction();
  const [open, setOpen] = useState(false);
  const [topic, setTopic] = useState("");
  const [choice, setChoice] = useState("");
  const [reason, setReason] = useState("");
  return (
    <>
      <Button variant="outline" className={BUTTON} onClick={() => setOpen(true)}>
        Aggiungi una decisione
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Una decisione del team</DialogTitle>
            <DialogDescription>Vale per ogni coding agent del caso. Non si cambia: se serve, se ne aggiunge un&apos;altra.</DialogDescription>
          </DialogHeader>
          <form
            className="grid gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              run(() => addDecisionAction(workspaceId, caseId, { topic: topic.trim(), choice: choice.trim(), reason: reason.trim() || null }), {
                onSuccess: () => {
                  setOpen(false);
                  setTopic("");
                  setChoice("");
                  setReason("");
                },
              });
            }}
          >
            <div className="space-y-1.5">
              <Label htmlFor="decisione-argomento">Argomento</Label>
              <Input id="decisione-argomento" value={topic} maxLength={80} placeholder="Strumenti nuovi" onChange={(e) => setTopic(e.target.value)} className={FIELD} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="decisione-scelta">La decisione</Label>
              <Textarea id="decisione-scelta" value={choice} maxLength={500} rows={2} onChange={(e) => setChoice(e.target.value)} className={AREA} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="decisione-perche">Perché</Label>
              <Textarea id="decisione-perche" value={reason} maxLength={1000} rows={2} onChange={(e) => setReason(e.target.value)} className={AREA} />
            </div>
            <DialogFooter>
              <Button type="submit" className={BUTTON} disabled={pending || !topic.trim() || !choice.trim()}>
                Registra
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** «Aggiorna il pacchetto»: una versione nuova solo se la scheda è cambiata. */
export function PackageButton({ workspaceId, caseId, first }: Ids & { first: boolean }) {
  const { pending, run } = useUcAction();
  return (
    <Button variant="outline" className={BUTTON} disabled={pending} onClick={() => run(() => generatePackageAction(workspaceId, caseId))}>
      {first ? "Genera il pacchetto" : "Aggiorna il pacchetto"}
    </Button>
  );
}
