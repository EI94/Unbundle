"use client";

import { useActionState, useEffect, useId, useState } from "react";
import { ChevronRight } from "lucide-react";
import {
  createAiReadinessRespondentInviteAction,
  type AiReadinessActionState,
  type CreateRespondentInviteData,
} from "@/lib/actions/ai-readiness";
import { READINESS_TEXT } from "@/lib/ai-readiness/dashboard-text";
import { READINESS_TRACKS, type ReadinessTrack } from "@/lib/ai-readiness/dashboard-view";
import { CopyButton } from "@/components/uc/ui/copy-button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

const INITIAL: AiReadinessActionState<CreateRespondentInviteData> = { ok: true };
const V = READINESS_TEXT.invite;
const TRACK_ORDER: readonly ReadinessTrack[] = ["internal", "use_case_expert", "everyone"];

type SectionOption = { id: string; title: string; audience?: "everyone" | "internal"; area: string };
type UseCaseBlockOption = { id: string; title: string; subtitle: string };

const FIELD = "h-11 text-base sm:h-9 sm:text-sm";
const CHOICE = "flex min-h-11 cursor-pointer items-start gap-3 rounded-lg border p-3 text-sm has-checked:border-foreground/60 has-checked:bg-muted/60";

/**
 * «Invita una persona» (rilascio 10, ondata 7b, §3.9; audit «Fuori» AD-10): il modulo del pannello. In vista l'email,
 * che cosa riceve (i tre percorsi di oggi, in un `fieldset`) e l'area; nome, cognome, ruolo, anzianità e le domande da
 * includere in «Altri dettagli», chiusi. Il pulsante pieno è quello del pannello (`form={formId}`). Il link personale si
 * vede una volta, appena creato, con «Copia»: nessuna email parte da qui. L'azione è quella di oggi.
 */
export function RespondentInviteForm({
  formId,
  workspaceId,
  assessmentId,
  sections,
  useCaseBlocks,
  onPendingChange,
}: {
  formId: string;
  workspaceId: string;
  assessmentId: string;
  sections: readonly SectionOption[];
  useCaseBlocks: readonly UseCaseBlockOption[];
  onPendingChange?: (pending: boolean) => void;
}) {
  const action = createAiReadinessRespondentInviteAction.bind(null, workspaceId, assessmentId);
  const [state, formAction, pending] = useActionState(action, INITIAL);
  useEffect(() => {
    onPendingChange?.(pending);
  }, [onPendingChange, pending]);
  const [track, setTrack] = useState<ReadinessTrack>("internal");
  const [details, setDetails] = useState(false);
  const sectionsOf = (t: ReadinessTrack) => sections.filter((s) => (t === "internal" ? s.audience === "internal" : s.audience !== "internal")).map((s) => s.id);
  const [sectionIds, setSectionIds] = useState<string[]>(() => sectionsOf("internal"));
  const [blockIds, setBlockIds] = useState<string[]>(() => useCaseBlocks.map((b) => b.id));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const ids = { email: useId(), unit: useId(), name: useId(), surname: useId(), role: useId(), seniority: useId(), details: useId() };
  const visibleSections = sections.filter((s) => (track === "internal" ? s.audience === "internal" : s.audience !== "internal"));
  const scopeCount = track === "use_case_expert" ? blockIds.length : sectionIds.length;
  const fieldError = (name: string) => errors[name] ?? state.fieldErrors?.[name] ?? null;

  function chooseTrack(next: ReadinessTrack) {
    setTrack(next);
    setErrors({});
    if (next === "use_case_expert") setBlockIds(useCaseBlocks.map((b) => b.id));
    else setSectionIds(sectionsOf(next));
  }

  const toggle = (list: string[], id: string, on: boolean) => (on ? [...new Set([...list, id])] : list.filter((x) => x !== id));

  return (
    <form
      id={formId}
      action={formAction}
      noValidate
      className="space-y-5"
      data-testid="targeted-invite-form"
      data-survey-track={track}
      onSubmit={(event) => {
        const data = new FormData(event.currentTarget);
        const next: Record<string, string> = {};
        if (!String(data.get("email") ?? "").trim()) next.email = V.errors.email;
        if (String(data.get("organizationUnit") ?? "").trim().length < 2) next.organizationUnit = V.errors.unit;
        if (scopeCount === 0) {
          next.scope = V.errors.scope;
          setDetails(true);
        }
        if (Object.keys(next).length) {
          event.preventDefault();
          setErrors(next);
        }
      }}
    >
      <p className="text-sm text-muted-foreground">{V.description}</p>

      <div className="grid gap-1.5">
        <Label htmlFor={ids.email}>{V.email}</Label>
        <Input id={ids.email} name="email" type="email" autoComplete="off" aria-invalid={fieldError("email") ? true : undefined} className={FIELD} onChange={() => setErrors((e) => ({ ...e, email: "" }))} />
        {fieldError("email") ? <p className="text-xs text-destructive">{fieldError("email")}</p> : null}
      </div>

      <fieldset className="grid gap-2">
        <legend className="mb-1.5 text-sm font-medium">{V.track}</legend>
        {TRACK_ORDER.map((key) => (
          <label key={key} className={CHOICE}>
            <input type="radio" name="surveyTrack" value={key} checked={track === key} onChange={() => chooseTrack(key)} className="mt-0.5 size-4" />
            <span className="min-w-0">
              <span className="font-medium">{READINESS_TRACKS[key].label}</span>
              <span className="mt-0.5 block text-xs text-muted-foreground">{READINESS_TRACKS[key].hint}</span>
            </span>
          </label>
        ))}
      </fieldset>

      <div className="grid gap-1.5">
        <Label htmlFor={ids.unit}>{V.unit}</Label>
        <Input id={ids.unit} name="organizationUnit" placeholder={V.unitPlaceholder} aria-invalid={fieldError("organizationUnit") ? true : undefined} className={FIELD} onChange={() => setErrors((e) => ({ ...e, organizationUnit: "" }))} />
        {fieldError("organizationUnit") ? <p className="text-xs text-destructive">{fieldError("organizationUnit")}</p> : null}
      </div>

      <div className="border-t pt-2">
        <button
          type="button"
          aria-expanded={details}
          aria-controls={ids.details}
          onClick={() => setDetails(!details)}
          className="flex min-h-11 w-full items-center justify-between gap-3 rounded-md text-left text-sm font-medium outline-none focus-visible:ring-3 focus-visible:ring-ring/50 sm:min-h-9"
        >
          {V.details}
          <ChevronRight aria-hidden className={cn("size-4 text-muted-foreground transition-transform duration-150 motion-reduce:transition-none", details && "rotate-90")} />
        </button>
        <div id={ids.details} hidden={!details} className="space-y-4 pt-2">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor={ids.name}>{V.name}</Label>
              <Input id={ids.name} name="name" autoComplete="off" className={FIELD} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor={ids.surname}>{V.surname}</Label>
              <Input id={ids.surname} name="surname" autoComplete="off" className={FIELD} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor={ids.role}>{V.role}</Label>
              <Input id={ids.role} name="role" autoComplete="off" className={FIELD} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor={ids.seniority}>{V.seniority}</Label>
              <Input id={ids.seniority} name="seniority" autoComplete="off" className={FIELD} />
            </div>
          </div>
          <input type="hidden" name="scopeConfigured" value="1" />
          <fieldset className="grid gap-2">
            <legend className="mb-1 text-sm font-medium">{V.questions}</legend>
            <p className="text-xs text-muted-foreground">{V.questionsHint}</p>
            {track === "use_case_expert"
              ? useCaseBlocks.map((block) => (
                  <label key={block.id} className={CHOICE}>
                    <input type="checkbox" name="useCaseBlockIds" value={block.id} checked={blockIds.includes(block.id)} onChange={(e) => setBlockIds((list) => toggle(list, block.id, e.target.checked))} className="mt-0.5 size-4" />
                    <span className="min-w-0">
                      <span className="font-medium">{block.title}</span>
                      <span className="mt-0.5 block text-xs text-muted-foreground">{block.subtitle}</span>
                    </span>
                  </label>
                ))
              : visibleSections.map((section) => (
                  <label key={`${track}-${section.id}`} className={CHOICE}>
                    <input type="checkbox" name="sectionIds" value={section.id} checked={sectionIds.includes(section.id)} onChange={(e) => setSectionIds((list) => toggle(list, section.id, e.target.checked))} className="mt-0.5 size-4" />
                    <span className="min-w-0">
                      <span className="font-medium">{section.title}</span>
                      <span className="ml-2 text-xs text-muted-foreground">{section.area}</span>
                    </span>
                  </label>
                ))}
            {fieldError("scope") || state.fieldErrors?.sectionIds || state.fieldErrors?.useCaseBlockIds ? (
              <p role="alert" className="text-xs text-destructive">
                {fieldError("scope") || state.fieldErrors?.sectionIds || state.fieldErrors?.useCaseBlockIds}
              </p>
            ) : null}
          </fieldset>
        </div>
      </div>

      {state.message && !state.ok ? (
        <p role="alert" className="text-sm text-destructive">
          {state.message}
        </p>
      ) : null}
      {state.ok && state.data?.inviteUrl ? (
        <div className="space-y-2 rounded-lg border p-3" data-slot="invite-created">
          <p className="text-sm font-medium">{V.created}</p>
          <p className="text-xs text-muted-foreground">{V.createdHint}</p>
          <Input readOnly value={state.data.inviteUrl} aria-label={V.created} onFocus={(e) => e.currentTarget.select()} className="h-11 font-mono text-base sm:h-9 sm:text-xs" />
          <CopyButton value={state.data.inviteUrl} label={READINESS_TEXT.collection.copy} />
        </div>
      ) : null}
      {pending ? <span className="sr-only" aria-live="polite">{V.pending}</span> : null}
    </form>
  );
}
