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
  saveProjectDetailsAction,
  saveProjectTopicAction,
  startProjectAction,
  submitProjectAction,
} from "@/lib/actions/use-case-factory";
import type { UcActionResult } from "@/lib/actions/uc-action-context";

const FIELD = "h-11 text-base sm:h-9 sm:text-sm";
const AREA = "text-base sm:text-sm";
const BUTTON = "min-h-11 sm:min-h-9";

type Ids = { workspaceId: string; caseId: string };

/** L'azione principale della pagina, una sola, secondo lo stato del progetto e chi guarda. */
export function ProjectPrimaryAction({
  workspaceId,
  caseId,
  action,
  revision,
}: Ids & { action: "imposta" | "manda" | "approva" | "rivedi" | null; revision: number | null }) {
  const { pending, run } = useUcAction();
  if (!action) return null;
  const label = { imposta: "Imposta il caso", manda: "Manda in approvazione", approva: "Approva il progetto", rivedi: "Rivedi il progetto" }[action];
  const calls: Record<"imposta" | "manda" | "approva" | "rivedi", () => Promise<UcActionResult<unknown>>> = {
    imposta: () => startProjectAction(workspaceId, caseId),
    rivedi: () => startProjectAction(workspaceId, caseId),
    manda: () => submitProjectAction(workspaceId, caseId, { revision }),
    approva: () => approveProjectAction(workspaceId, caseId, { revision }),
  };
  const call = calls[action];
  // «Rivedi il progetto» non è urgente: secondario, accanto all'azione principale del dossier.
  return (
    <Button variant={action === "rivedi" ? "outline" : "default"} className={BUTTON} disabled={pending} onClick={() => run(call)}>
      {label}
    </Button>
  );
}

/** «Riapri per cambiarlo»: il progetto da approvare torna in corso (e l'ok dell'AI Board si chiede di nuovo). */
export function ReopenProject({ workspaceId, caseId, revision }: Ids & { revision: number }) {
  const { pending, run } = useUcAction();
  return (
    <Button variant="outline" className={BUTTON} disabled={pending} onClick={() => run(() => reopenProjectAction(workspaceId, caseId, { revision }))}>
      Riapri per cambiarlo
    </Button>
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
            <DialogDescription>Diventa anche una decisione del caso, con il giorno e chi l&apos;ha presa.</DialogDescription>
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

/** Strumenti nuovi (uno per riga, «Nome: perché») e stima. */
export function DetailsEditor({
  workspaceId,
  caseId,
  tools,
  hours,
  cost,
}: Ids & { tools: { nome: string; perche: string | null }[]; hours: number | null; cost: number | null }) {
  const { pending, run } = useUcAction();
  const [open, setOpen] = useState(false);
  const [toolsText, setToolsText] = useState(tools.map((t) => (t.perche ? `${t.nome}: ${t.perche}` : t.nome)).join("\n"));
  const [hoursText, setHoursText] = useState(hours === null ? "" : String(hours));
  const [costText, setCostText] = useState(cost === null ? "" : String(cost));
  const parsedTools = toolsText
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const at = line.indexOf(":");
      return at > 0 ? { nome: line.slice(0, at).trim(), perche: line.slice(at + 1).trim() || null } : { nome: line, perche: null };
    });
  const num = (text: string) => (text.trim() === "" ? null : Number(text.replace(",", ".")));
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
            onSubmit={(e) => {
              e.preventDefault();
              run(() => saveProjectDetailsAction(workspaceId, caseId, { newTools: parsedTools, estimateHours: num(hoursText), monthlyCostEur: num(costText) }), { onSuccess: () => setOpen(false) });
            }}
          >
            <div className="space-y-1.5">
              <Label htmlFor="strumenti-nuovi">Strumenti nuovi, uno per riga</Label>
              <Textarea id="strumenti-nuovi" value={toolsText} rows={3} placeholder="Neon: il database del caso, in UE" onChange={(e) => setToolsText(e.target.value)} className={AREA} />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="stima-ore">Costruzione, in ore</Label>
                <Input id="stima-ore" inputMode="decimal" value={hoursText} onChange={(e) => setHoursText(e.target.value)} className={FIELD} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="stima-costo">Esercizio, € al mese</Label>
                <Input id="stima-costo" inputMode="decimal" value={costText} onChange={(e) => setCostText(e.target.value)} className={FIELD} />
              </div>
            </div>
            <DialogFooter>
              <Button type="submit" className={BUTTON} disabled={pending}>
                Salva
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** L'ok dell'AI Board: chi ha il ruolo lo registra e basta; il responsabile scrive chi l'ha dato e quando. */
export function AiBoardOk({ workspaceId, caseId, noteRequired, revision }: Ids & { noteRequired: boolean; revision: number }) {
  const { pending, run } = useUcAction();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  return (
    <>
      <Button variant="outline" className={BUTTON} onClick={() => setOpen(true)}>
        Registra l&apos;ok dell&apos;AI Board
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Ok dell&apos;AI Board agli strumenti nuovi</DialogTitle>
            <DialogDescription>
              {noteRequired ? "Lo registri per conto dell'AI Board: scrivi chi l'ha dato e quando." : "Con il tuo ok il responsabile del caso può approvare il progetto."}
            </DialogDescription>
          </DialogHeader>
          <form
            className="grid gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              run(() => recordAiBoardOkAction(workspaceId, caseId, { note: note.trim() || null, revision }), { onSuccess: () => setOpen(false) });
            }}
          >
            <div className="space-y-1.5">
              <Label htmlFor="nota-ai-board">{noteRequired ? "Chi l'ha dato e quando" : "Nota (se serve)"}</Label>
              <Textarea id="nota-ai-board" value={note} maxLength={300} rows={2} onChange={(e) => setNote(e.target.value)} className={AREA} />
            </div>
            <DialogFooter>
              <Button type="submit" className={BUTTON} disabled={pending || (noteRequired && note.trim().length < 10)}>
                Registra l&apos;ok
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
            <DialogDescription>Entra nel brief di ogni coding agent del caso. Non si cambia: se serve, se ne aggiunge un&apos;altra.</DialogDescription>
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
