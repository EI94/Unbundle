"use client";

import { useActionState, useState } from "react";
import {
  createAiReadinessRespondentInviteAction,
  type AiReadinessActionState,
  type CreateRespondentInviteData,
} from "@/lib/actions/ai-readiness";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const INITIAL: AiReadinessActionState<CreateRespondentInviteData> = {
  ok: true,
};

type SurveyTrack = "everyone" | "internal" | "use_case_expert";

type SectionOption = {
  id: string;
  title: string;
  description?: string;
  audience?: "everyone" | "internal";
  pillarTitle: string;
};

type UseCaseBlockOption = {
  id: string;
  title: string;
  subtitle: string;
};

export function RespondentInviteForm({
  workspaceId,
  assessmentId,
  sections,
  useCaseBlocks,
}: {
  workspaceId: string;
  assessmentId: string;
  sections: SectionOption[];
  useCaseBlocks: UseCaseBlockOption[];
}) {
  const action = createAiReadinessRespondentInviteAction.bind(
    null,
    workspaceId,
    assessmentId
  );
  const [state, formAction, pending] = useActionState(action, INITIAL);
  const [copiedUrl, setCopiedUrl] = useState<string | null>(null);
  const [track, setTrack] = useState<SurveyTrack>("everyone");
  const [selectedSectionIds, setSelectedSectionIds] = useState(() =>
    sections.filter((section) => section.audience !== "internal").map((section) => section.id)
  );
  const [selectedBlockIds, setSelectedBlockIds] = useState(() =>
    useCaseBlocks.map((block) => block.id)
  );
  const [localErrors, setLocalErrors] = useState<Record<string, string>>({});

  const visibleSections = sections.filter((section) =>
    track === "internal"
      ? section.audience === "internal"
      : section.audience !== "internal"
  );
  const selectedAreaCount =
    track === "use_case_expert" ? selectedBlockIds.length : selectedSectionIds.length;

  function clearLocalError(name: string) {
    setLocalErrors((current) => {
      if (!current[name]) return current;
      const next = { ...current };
      delete next[name];
      return next;
    });
  }

  function resetTrack(next: SurveyTrack) {
    setTrack(next);
    setLocalErrors({});
    if (next === "use_case_expert") {
      setSelectedBlockIds(useCaseBlocks.map((block) => block.id));
      return;
    }
    setSelectedSectionIds(
      sections
        .filter((section) =>
          next === "internal"
            ? section.audience === "internal"
            : section.audience !== "internal"
        )
        .map((section) => section.id)
    );
  }

  return (
    <form
      action={formAction}
      className="mt-4 space-y-4 rounded-3xl border p-4"
      noValidate
      onSubmit={(event) => {
        const form = event.currentTarget;
        const nextErrors: Record<string, string> = {};
        const email = new FormData(form).get("email");
        const unit = new FormData(form).get("organizationUnit");
        if (typeof email !== "string" || !email.trim()) {
          nextErrors.email = "Inserisci l'email della persona.";
        }
        if (typeof unit !== "string" || unit.trim().length < 2) {
          nextErrors.organizationUnit = "Indica area o team.";
        }
        if (selectedAreaCount === 0) {
          nextErrors.scope =
            track === "use_case_expert"
              ? "Scegli almeno un'area del modulo use case."
              : "Scegli almeno un'area da mostrare.";
        }
        if (Object.keys(nextErrors).length > 0) {
          event.preventDefault();
          setLocalErrors(nextErrors);
        }
      }}
    >
      <div className="grid gap-3 md:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="email">Email respondent</Label>
          <Input
            id="email"
            name="email"
            type="email"
            placeholder="persona@azienda.com"
            aria-invalid={Boolean(localErrors.email || state.fieldErrors?.email)}
            onChange={() => clearLocalError("email")}
          />
          {(localErrors.email || state.fieldErrors?.email) && (
            <p className="text-xs text-destructive">
              {localErrors.email || state.fieldErrors?.email}
            </p>
          )}
        </div>
        <div className="space-y-1.5">
          <Label>Chi e questa persona?</Label>
          <div className="grid gap-2">
            <label className="flex cursor-pointer items-start gap-2 rounded-2xl border p-3 text-sm has-checked:border-emerald-500 has-checked:bg-emerald-500/5">
              <input
                type="radio"
                name="surveyTrack"
                value="everyone"
                checked={track === "everyone"}
                onChange={() => resetTrack("everyone")}
                className="mt-0.5"
              />
              <span>
                <span className="font-medium">Survey organizzazione</span>
                <span className="mt-0.5 block text-xs text-muted-foreground">
                  La survey condivisa con tutti: strumenti, adoption, idee.
                </span>
              </span>
            </label>
            <label className="flex cursor-pointer items-start gap-2 rounded-2xl border p-3 text-sm has-checked:border-emerald-500 has-checked:bg-emerald-500/5">
              <input
                type="radio"
                name="surveyTrack"
                value="internal"
                checked={track === "internal"}
                onChange={() => resetTrack("internal")}
                className="mt-0.5"
              />
              <span>
                <span className="font-medium">Scheda referenti (IT / HR / business)</span>
                <span className="mt-0.5 block text-xs text-muted-foreground">
                  Infrastruttura, dati e conoscenza, persone e processi: per chi conosce i sistemi.
                </span>
              </span>
            </label>
            <label className="flex cursor-pointer items-start gap-2 rounded-2xl border p-3 text-sm has-checked:border-emerald-500 has-checked:bg-emerald-500/5">
              <input
                type="radio"
                name="surveyTrack"
                value="use_case_expert"
                checked={track === "use_case_expert"}
                onChange={() => resetTrack("use_case_expert")}
                className="mt-0.5"
              />
              <span>
                <span className="font-medium">Esperto use case (business)</span>
                <span className="mt-0.5 block text-xs text-muted-foreground">
                  Modulo guidato per raccogliere casi concreti: bisogno, com&apos;e oggi, ipotesi AI.
                </span>
              </span>
            </label>
          </div>
        </div>
        <div className="space-y-1.5 md:col-span-2">
          <input type="hidden" name="scopeConfigured" value="1" />
          <Label>
            Domande da includere
            <span className="ml-2 text-xs font-normal text-muted-foreground">
              {selectedAreaCount} selezionate
            </span>
          </Label>
          <div className="rounded-2xl border bg-muted/20 p-3">
            <p className="text-xs leading-5 text-muted-foreground">
              Scegli solo ciò che questa persona può compilare bene. Per un HR
              manager, ad esempio, puoi lasciare solo “Persone, ruoli e processi”.
            </p>
            {track === "use_case_expert" ? (
              <div className="mt-3 grid gap-2 sm:grid-cols-3">
                {useCaseBlocks.map((block) => (
                  <label
                    key={block.id}
                    className="flex cursor-pointer gap-2 rounded-2xl border bg-background/70 p-3 text-sm has-checked:border-emerald-500 has-checked:bg-emerald-500/5"
                  >
                    <input
                      type="checkbox"
                      name="useCaseBlockIds"
                      value={block.id}
                      checked={selectedBlockIds.includes(block.id)}
                      onChange={(event) => {
                        clearLocalError("scope");
                        setSelectedBlockIds((current) =>
                          event.target.checked
                            ? [...new Set([...current, block.id])]
                            : current.filter((id) => id !== block.id)
                        );
                      }}
                      className="mt-1"
                    />
                    <span>
                      <span className="font-medium">{block.title}</span>
                      <span className="mt-1 block text-xs leading-5 text-muted-foreground">
                        {block.subtitle}
                      </span>
                    </span>
                  </label>
                ))}
              </div>
            ) : (
              <div className="mt-3 grid gap-2">
                {visibleSections.map((section) => (
                  <label
                    key={`${track}-${section.id}`}
                    className="flex cursor-pointer gap-3 rounded-2xl border bg-background/70 p-3 text-sm has-checked:border-emerald-500 has-checked:bg-emerald-500/5"
                  >
                    <input
                      type="checkbox"
                      name="sectionIds"
                      value={section.id}
                      checked={selectedSectionIds.includes(section.id)}
                      onChange={(event) => {
                        clearLocalError("scope");
                        setSelectedSectionIds((current) =>
                          event.target.checked
                            ? [...new Set([...current, section.id])]
                            : current.filter((id) => id !== section.id)
                        );
                      }}
                      className="mt-1"
                    />
                    <span>
                      <span className="font-medium">{section.title}</span>
                      <span className="ml-2 text-xs text-muted-foreground">
                        {section.pillarTitle}
                      </span>
                      {section.description && (
                        <span className="mt-1 block text-xs leading-5 text-muted-foreground">
                          {section.description}
                        </span>
                      )}
                    </span>
                  </label>
                ))}
              </div>
            )}
            {(localErrors.scope ||
              state.fieldErrors?.sectionIds ||
              state.fieldErrors?.useCaseBlockIds) && (
              <p className="mt-2 text-xs text-destructive" role="alert">
                {localErrors.scope ||
                  state.fieldErrors?.sectionIds ||
                  state.fieldErrors?.useCaseBlockIds}
              </p>
            )}
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="organizationUnit">Area / team</Label>
          <Input
            id="organizationUnit"
            name="organizationUnit"
            placeholder="Marketing, Operations..."
            aria-invalid={Boolean(
              localErrors.organizationUnit || state.fieldErrors?.organizationUnit
            )}
            onChange={() => clearLocalError("organizationUnit")}
          />
          {(localErrors.organizationUnit || state.fieldErrors?.organizationUnit) && (
            <p className="text-xs text-destructive">
              {localErrors.organizationUnit || state.fieldErrors?.organizationUnit}
            </p>
          )}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="name">Nome</Label>
          <Input id="name" name="name" placeholder="Nome" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="surname">Cognome</Label>
          <Input id="surname" name="surname" placeholder="Cognome" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="role">Ruolo</Label>
          <Input id="role" name="role" placeholder="Es. Project Manager" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="seniority">Seniority</Label>
          <Input id="seniority" name="seniority" placeholder="Es. Senior, Manager, Director" />
        </div>
      </div>
      {state.message && (
        <p className={`text-sm ${state.ok ? "text-emerald-600" : "text-destructive"}`}>
          {state.message}
        </p>
      )}
      {state.data?.inviteUrl && (
        <div className="rounded-2xl border bg-muted/30 p-3">
          <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
            Link survey
          </div>
          <div className="mt-2 flex flex-col gap-2 md:flex-row md:items-center">
            <code className="flex-1 overflow-hidden text-ellipsis rounded-lg bg-background px-3 py-2 text-xs">
              {state.data.inviteUrl}
            </code>
            <Button
              type="button"
              variant="outline"
              onClick={async () => {
                await navigator.clipboard.writeText(state.data?.inviteUrl ?? "");
                setCopiedUrl(state.data?.inviteUrl ?? null);
              }}
            >
              {copiedUrl === state.data.inviteUrl ? "Copiato" : "Copia"}
            </Button>
          </div>
        </div>
      )}
      <Button type="submit" disabled={pending}>
        {pending ? "Creo invito..." : "Crea link respondent"}
      </Button>
    </form>
  );
}
