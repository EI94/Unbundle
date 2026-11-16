"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { ChoiceSelect } from "@/components/uc/people/choice-select";
import { useUcAction } from "@/components/uc/catalog/use-uc-action";
import { addBuilderAction, removeBuilderAction } from "@/lib/actions/use-case-workspace-team";
import { builderCandidateGroups, EXTERNAL_ROLE_HINT, type BuilderCandidateView } from "@/lib/use-cases/factory/builders-text";

const LS_ROLES = [
  { value: "ls_sviluppatore", label: "Sviluppatore" },
  { value: "ls_analista", label: "Analista" },
  { value: "ls_lead", label: "Responsabile" },
] as const;
const EXTERNAL_ROLE = { value: "builder_esterno", label: "Sviluppatore esterno" } as const;

/** Una persona tra cui scegliere; `blocked`: perché da fuori oggi non può costruire (si vede, non si sceglie). */
export type BuilderCandidate = BuilderCandidateView;

export interface WhereChoice {
  useCaseId: string;
  code: string;
  title: string;
}

/**
 * (8.0c) «Aggiungi» a chi costruisce: la persona tra i collaboratori del workspace, in due gruppi («Lateral Space» ed
 * «Esterni»), il ruolo, e per chi viene da fuori il «Dove». Per una persona già presente da fuori cambia il «Dove».
 */
export function AddBuilder({ workspaceId, candidates, choices }: { workspaceId: string; candidates: readonly BuilderCandidate[]; choices: readonly WhereChoice[] }) {
  const { pending, run } = useUcAction();
  const [userId, setUserId] = useState("");
  const [role, setRole] = useState("");
  const [where, setWhere] = useState<"tutti" | "alcuni">("tutti");
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const candidate = candidates.find((c) => c.userId === userId && !c.blocked) ?? null;
  const external = candidate !== null && !candidate.isLateralSpace;
  const roles = external ? [EXTERNAL_ROLE] : LS_ROLES;
  const ready = Boolean(candidate && role && (!external || where === "tutti" || picked.size > 0));

  return (
    <form
      className="mt-4 space-y-3 border-t pt-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (!ready) return;
        run(() => addBuilderAction(workspaceId, { userId, role, where: external ? (where === "tutti" ? "tutti" : [...picked]) : "tutti" }), {
          onSuccess: () => {
            setUserId("");
            setRole("");
            setWhere("tutti");
            setPicked(new Set());
          },
        });
      }}
    >
      <div className="grid min-w-0 gap-3 sm:grid-cols-2">
        <div className="min-w-0 space-y-1.5">
          <Label htmlFor="builder-person" className="text-xs">
            Persona
          </Label>
          <ChoiceSelect
            id="builder-person"
            value={userId}
            placeholder="Scegli"
            onChange={(v) => {
              const next = candidates.find((c) => c.userId === v && !c.blocked);
              setUserId(next ? v : "");
              setRole(next ? (next.isLateralSpace ? "ls_sviluppatore" : EXTERNAL_ROLE.value) : "");
            }}
            groups={builderCandidateGroups(candidates)}
          />
          <p className="text-xs text-muted-foreground">Non la trovi? Invitala prima nel workspace, da Impostazioni › Persone, come Analista.</p>
        </div>
        <div className="min-w-0 space-y-1.5">
          <Label htmlFor="builder-role" className="text-xs">
            Ruolo
          </Label>
          <ChoiceSelect id="builder-role" value={role} placeholder="Scegli" disabled={!candidate} onChange={setRole} groups={[{ options: roles.map((r) => ({ value: r.value, label: r.label })) }]} />
        </div>
      </div>

      {external ? (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">{EXTERNAL_ROLE_HINT}</p>
          <fieldset className="space-y-1.5">
            <legend className="text-xs font-medium">Dove</legend>
            <label className="flex min-h-11 items-center gap-2 text-sm sm:min-h-8">
              <input type="radio" name="builder-where" value="tutti" checked={where === "tutti"} onChange={() => setWhere("tutti")} />
              In tutti i casi, anche nei nuovi
            </label>
            <label className="flex min-h-11 items-center gap-2 text-sm sm:min-h-8">
              <input type="radio" name="builder-where" value="alcuni" checked={where === "alcuni"} onChange={() => setWhere("alcuni")} />
              Solo in alcuni casi
            </label>
          </fieldset>
          {where === "alcuni" ? (
            choices.length ? (
              <ul className="max-h-64 space-y-1 overflow-y-auto rounded-md border p-2" aria-label="I casi dove costruisce">
                {choices.map((c) => (
                  <li key={c.useCaseId}>
                    <label className="flex min-h-11 items-start gap-2 py-1 text-sm sm:min-h-8">
                      <Checkbox
                        className="mt-0.5"
                        checked={picked.has(c.useCaseId)}
                        onCheckedChange={(checked) => {
                          const next = new Set(picked);
                          if (checked) next.add(c.useCaseId);
                          else next.delete(c.useCaseId);
                          setPicked(next);
                        }}
                      />
                      <span className="min-w-0">
                        {c.code ? <span className="font-medium tabular-nums">{c.code}</span> : null}
                        {c.code ? " · " : ""}
                        {c.title}
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">Nessun caso da scegliere ancora.</p>
            )
          ) : null}
        </div>
      ) : null}

      <Button type="submit" className="min-h-11 sm:min-h-9" disabled={pending || !ready}>
        Aggiungi
      </Button>
    </form>
  );
}

/**
 * «Togli» da chi costruisce, con la conferma: per chi viene da fuori dice quanti casi e i repository di GitHub (che si
 * tolgono a mano); per Lateral Space i casi aperti dal ruolo del team.
 */
export function RemoveBuilder({ workspaceId, userId, name, title, text }: { workspaceId: string; userId: string; name: string; title: string; text: string }) {
  const { pending, run } = useUcAction();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button type="button" variant="outline" size="sm" className="min-h-11 shrink-0 sm:min-h-8" disabled={pending} aria-label={`Togli ${name} da chi costruisce`} onClick={() => setOpen(true)}>
        Togli
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{text}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" className="min-h-11 sm:min-h-9" onClick={() => setOpen(false)}>
              Annulla
            </Button>
            <Button
              type="button"
              className="min-h-11 sm:min-h-9"
              disabled={pending}
              onClick={() => {
                setOpen(false);
                run(() => removeBuilderAction(workspaceId, userId));
              }}
            >
              Togli
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
