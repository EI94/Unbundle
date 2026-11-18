"use client";

import { useState, useTransition, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { createGoalAction, type GoalActionResult } from "@/lib/actions/strategy";
import type { StrategicGoal } from "@/lib/db/schema";
import { Plus } from "lucide-react";

/** Il salvataggio non è riuscito per un motivo che il server non dice (rete, errore): il testo resta nel modulo. */
export const GOAL_SAVE_FAILED = "Salvataggio non riuscito. Il testo è ancora qui: riprova tra poco.";

/**
 * «Salva» senza mai lanciare: un rifiuto del server torna con il suo messaggio, un errore (rete, server) con
 * `GOAL_SAVE_FAILED`. Niente arriva alla pagina d'errore del workspace.
 */
export async function saveGoal(action: (formData: FormData) => Promise<GoalActionResult>, formData: FormData): Promise<GoalActionResult> {
  try {
    return await action(formData);
  } catch {
    return { ok: false, message: GOAL_SAVE_FAILED };
  }
}

interface GoalFormProps {
  workspaceId: string;
  parentGoals: StrategicGoal[];
  defaultType?: "goal" | "objective" | "key_result";
  defaultParentId?: string;
}

export function GoalForm({
  workspaceId,
  parentGoals,
  defaultType = "goal",
  defaultParentId,
}: GoalFormProps) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, startSaving] = useTransition();

  // `onSubmit` e non `action`: dopo un'azione del modulo React svuota i campi anche quando il salvataggio non
  // riesce. Così, dopo un rifiuto, la finestra resta aperta con il testo scritto e il messaggio.
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    setError(null);
    startSaving(async () => {
      const result = await saveGoal(createGoalAction, formData);
      if (result.ok) setOpen(false);
      else setError(result.message);
    });
  }

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={() => {
          setError(null);
          setOpen(true);
        }}
      >
        <Plus className="mr-2 h-3 w-3" />
        Aggiungi{" "}
        {defaultType === "key_result"
          ? "Key Result"
          : defaultType === "objective"
            ? "Obiettivo"
            : "Goal"}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <form onSubmit={submit}>
            <input type="hidden" name="workspaceId" value={workspaceId} />
            {defaultParentId && (
              <input type="hidden" name="parentId" value={defaultParentId} />
            )}

            <DialogHeader>
              <DialogTitle>
                Nuovo{" "}
                {defaultType === "key_result"
                  ? "Key Result"
                  : defaultType === "objective"
                    ? "Obiettivo"
                    : "Goal Strategico"}
              </DialogTitle>
              <DialogDescription>
                Definisci un obiettivo strategico per guidare l&apos;analisi.
              </DialogDescription>
            </DialogHeader>

            <div className="mt-4 space-y-4">
              <div className="space-y-2">
                <Label htmlFor="type">Tipo</Label>
                <Select name="type" defaultValue={defaultType}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="goal">Goal Strategico</SelectItem>
                    <SelectItem value="objective">Obiettivo</SelectItem>
                    <SelectItem value="key_result">Key Result</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {!defaultParentId && parentGoals.length > 0 && (
                <div className="space-y-2">
                  <Label htmlFor="parentId">Parent (opzionale)</Label>
                  <Select name="parentId">
                    <SelectTrigger>
                      <SelectValue placeholder="Nessun parent" />
                    </SelectTrigger>
                    <SelectContent>
                      {parentGoals.map((g) => (
                        <SelectItem key={g.id} value={g.id}>
                          [{g.type === "key_result" ? "KR" : g.type}] {g.title}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              <div className="space-y-2">
                <Label htmlFor="title">Titolo</Label>
                <Input
                  id="title"
                  name="title"
                  placeholder="Es. Aumentare il revenue per cliente del 20%"
                  required
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="description">Descrizione</Label>
                <Textarea
                  id="description"
                  name="description"
                  placeholder="Descrizione dettagliata..."
                  rows={2}
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="direction">Direzione</Label>
                  <Select name="direction">
                    <SelectTrigger>
                      <SelectValue placeholder="Seleziona" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="increase">Aumentare</SelectItem>
                      <SelectItem value="decrease">Diminuire</SelectItem>
                      <SelectItem value="maintain">Mantenere</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="timeframe">Timeframe</Label>
                  <Input
                    id="timeframe"
                    name="timeframe"
                    placeholder="Es. Q3 2026"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="currentValue">Valore attuale</Label>
                  <Input
                    id="currentValue"
                    name="currentValue"
                    type="number"
                    step="any"
                    placeholder="Es. 150"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="targetValue">Valore target</Label>
                  <Input
                    id="targetValue"
                    name="targetValue"
                    type="number"
                    step="any"
                    placeholder="Es. 180"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="owner">Owner</Label>
                  <Input
                    id="owner"
                    name="owner"
                    placeholder="Es. VP Sales"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="kpiName">KPI</Label>
                  <Input
                    id="kpiName"
                    name="kpiName"
                    placeholder="Es. Revenue/cliente"
                  />
                </div>
              </div>
            </div>

            {error ? (
              <p role="alert" className="mt-4 text-sm text-destructive">
                {error}
              </p>
            ) : null}

            <DialogFooter className="mt-6">
              <Button
                type="button"
                variant="outline"
                onClick={() => setOpen(false)}
              >
                Annulla
              </Button>
              <Button type="submit" disabled={saving}>
                {saving ? "Salvataggio…" : "Salva"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
