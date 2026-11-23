"use client";

import { useActionState, useCallback, useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronRight } from "lucide-react";
import { createAiReadinessAssessmentAction, type AiReadinessActionState } from "@/lib/actions/ai-readiness";
import { AI_READINESS_DEFAULT_COPY } from "@/lib/ai-readiness/copy";
import { READINESS_TEXT } from "@/lib/ai-readiness/dashboard-text";
import { AI_READINESS_SYSTEM_TEMPLATE } from "@/lib/ai-readiness/default-template";
import { readinessPillarText } from "@/lib/programma/text";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

const INITIAL: AiReadinessActionState<{ assessmentId: string }> = { ok: true };


const C = READINESS_TEXT.create;

const FIELD_LABELS: Record<string, string> = {
  name: C.name,
  controllerName: C.controller,
  processorName: C.processor,
  legalBasis: C.legalBasis,
  supportEmail: C.supportEmail,
  dataRetentionDays: C.retention,
  aggregationThreshold: C.threshold,
  pillars: C.areas,
};

/** I campi che stanno nella piega «Privacy e soglie», tutti già compilati: con un errore lì, la piega si apre. */
export const FOLDED_FIELDS: readonly string[] = ["displayName", "description", "introCopy", "controllerName", "processorName", "legalBasis", "privacyNoticeUrl", "dpoEmail", "dataRetentionDays", "aggregationThreshold"];

/** L'ultimo invio ha un errore in un campo della piega: allora, e solo allora, la piega si apre da sola. */
export function foldedErrorIn(state: { ok: boolean; fieldErrors?: Record<string, string> }): boolean {
  return !state.ok && Object.keys(state.fieldErrors ?? {}).some((key) => FOLDED_FIELDS.includes(key));
}

/** Che cosa misura ogni area, in una riga. */
const AREA_HINTS: Record<string, string> = {
  technology: "Sistemi, strumenti approvati e regole d'uso. Di solito per l'IT.",
  context: "Dati e conoscenza aziendale: dove stanno e quanto sono affidabili.",
  workflow: "Persone, ruoli e processi dei team.",
  adoption: "Quanto le persone conoscono e usano l'AI. Di solito per tutti.",
  use_cases: "Idee concrete proposte dalle persone.",
};

const FIELD = "h-11 text-base sm:h-9 sm:text-sm";
const CHOICE = "flex min-h-11 cursor-pointer items-start gap-3 rounded-lg border p-3 text-sm has-checked:border-foreground/60 has-checked:bg-muted/60";

/**
 * Nuova rilevazione (rilascio 10, ondata 7b; audit «Fuori» AD-2, §8.4): in vista il nome, le aree e la modalità; la
 * privacy e la soglia in «Privacy e soglie (già compilate)», chiusa: si apre da sola solo se un suo campo non passa la
 * verifica. (Revisione 7b) L'email per le domande di chi risponde sta in vista, sopra la piega, vuota e obbligatoria:
 * chi risponde la legge nel questionario e nell'informativa, ed è il contatto del cliente, mai quello di chi crea la
 * rilevazione (una persona di Lateral Space). Un invio senza email lo dice lì e porta lì il cursore. Un solo pulsante
 * pieno, «Crea la rilevazione». Quello che si scrive resta sul dispositivo finché la rilevazione non nasce. L'azione è
 * quella di oggi.
 */
export function AssessmentCreateForm({ workspaceId, workspaceName }: { workspaceId: string; workspaceName: string }) {
  const router = useRouter();
  const action = createAiReadinessAssessmentAction.bind(null, workspaceId);
  const [state, formAction, pending] = useActionState(action, INITIAL);
  // La piega è chiusa; si apre da sola quando l'ultimo invio ha un errore in uno dei suoi campi; poi la apre e la chiude
  // chi scrive.
  const [privacyToggle, setPrivacyToggle] = useState<{ open: boolean; at: AiReadinessActionState<{ assessmentId: string }> } | null>(null);
  const [missingContact, setMissingContact] = useState<string | null>(null);
  const privacyOpen = privacyToggle && privacyToggle.at === state ? privacyToggle.open : foldedErrorIn(state) || (privacyToggle?.open ?? false);
  const foldId = useId();

  const formRef = useRef<HTMLFormElement>(null);

  // Autosave live: ogni modifica viene salvata sul dispositivo, cosi un
  // errore di validazione (o un refresh) non fa mai perdere quanto digitato.
  const persistDraft = useCallback(() => {
    const form = formRef.current;
    if (!form) return;
    try {
      window.localStorage.setItem(
        draftKey(workspaceId),
        JSON.stringify(collectFormValues(form))
      );
    } catch {}
  }, [workspaceId]);

  const restoreDraft = useCallback(() => {
    const form = formRef.current;
    if (!form) return;
    try {
      const raw = window.localStorage.getItem(draftKey(workspaceId));
      if (raw) applyFormValues(form, JSON.parse(raw));
    } catch {}
  }, [workspaceId]);

  useEffect(() => {
    restoreDraft();
  }, [restoreDraft]);

  useEffect(() => {
    if (state.ok && state.data?.assessmentId) {
      // Successo: bozza locale non piu necessaria.
      try { window.localStorage.removeItem(draftKey(workspaceId)); } catch {}
      router.push(
        `/dashboard/${workspaceId}/ai-readiness?assessment=${state.data.assessmentId}`
      );
      return;
    }
    if (!state.ok) {
      // React 19 resetta il form dopo l'action: ripristina i valori digitati
      // e porta l'utente all'elenco errori.
      restoreDraft();
      formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [state, router, workspaceId, restoreDraft]);

  const errorFields = !state.ok
    ? Object.keys(state.fieldErrors ?? {}).map((key) => FIELD_LABELS[key] ?? key)
    : [];
  const err = (key: string) => (state.fieldErrors?.[key] ? <p className="text-xs text-destructive">{state.fieldErrors[key]}</p> : null);

  return (
    <form
      ref={formRef}
      action={formAction}
      onChange={persistDraft}
      // Le verifiche le fanno la pagina e il server, con le loro parole: il browser non ferma l'invio su un campo nascosto
      // nella piega, dove non potrebbe portare il cursore.
      noValidate
      onSubmit={(event) => {
        const field = event.currentTarget.elements.namedItem("supportEmail");
        if (field instanceof HTMLInputElement && !field.value.trim()) {
          event.preventDefault();
          setMissingContact(C.supportEmailMissing);
          field.focus();
          return;
        }
        setMissingContact(null);
      }}
      className="space-y-6"
      data-slot="readiness-create"
    >
      <p className="text-sm text-muted-foreground">{C.lead}</p>
      {!state.ok && state.message ? (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm" role="alert" data-testid="create-error-summary">
          <p className="font-medium">{state.message}</p>
          {errorFields.length > 0 ? (
            <ul className="mt-2 list-inside list-disc text-xs">
              {errorFields.map((label) => (
                <li key={label}>{label}</li>
              ))}
            </ul>
          ) : null}
          <p className="mt-2 text-xs text-muted-foreground">{C.errorsKept}</p>
        </div>
      ) : null}
      <div className="grid gap-1.5">
        <Label htmlFor="name">{C.name}</Label>
        <Input id="name" name="name" defaultValue={C.nameDefault(workspaceName)} className={FIELD} />
        {err("name")}
      </div>
      <fieldset className="grid gap-2">
        <legend className="mb-1.5 text-sm font-medium">{C.areas}</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {AI_READINESS_SYSTEM_TEMPLATE.pillars.map((pillar) => (
            <label key={pillar.id} className={CHOICE}>
              <input type="checkbox" name="pillars" value={pillar.id} defaultChecked className="mt-0.5 size-4" />
              <span className="min-w-0">
                <span className="font-medium">{readinessPillarText(pillar.id)}</span>
                <span className="mt-0.5 block text-xs text-muted-foreground">{AREA_HINTS[pillar.id] ?? pillar.description}</span>
              </span>
            </label>
          ))}
        </div>
        {err("pillars")}
      </fieldset>
      <fieldset className="grid gap-2">
        <legend className="mb-1.5 text-sm font-medium">{C.mode}</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          <label className={CHOICE}>
            <input type="radio" name="surveyMode" value="anonymous" defaultChecked className="mt-0.5 size-4" />
            <span className="min-w-0">
              <span className="font-medium">{C.anonymous}</span>
              <span className="mt-0.5 block text-xs text-muted-foreground">{C.anonymousHint}</span>
            </span>
          </label>
          <label className={CHOICE}>
            <input type="radio" name="surveyMode" value="named" className="mt-0.5 size-4" />
            <span className="min-w-0">
              <span className="font-medium">{C.named}</span>
              <span className="mt-0.5 block text-xs text-muted-foreground">{C.namedHint}</span>
            </span>
          </label>
        </div>
      </fieldset>

      <div className="grid gap-1.5">
        <Label htmlFor="supportEmail">{C.supportEmail}</Label>
        <Input
          id="supportEmail"
          name="supportEmail"
          type="email"
          required
          aria-required="true"
          autoComplete="off"
          aria-describedby="supportEmail-aiuto"
          aria-invalid={missingContact || state.fieldErrors?.supportEmail ? true : undefined}
          onChange={() => setMissingContact(null)}
          className={FIELD}
        />
        <p id="supportEmail-aiuto" className="text-xs text-muted-foreground">
          {C.supportEmailHint}
        </p>
        {missingContact ? (
          <p role="alert" className="text-xs text-destructive">
            {missingContact}
          </p>
        ) : (
          err("supportEmail")
        )}
      </div>

      <div className="border-t pt-2">
        <button
          type="button"
          aria-expanded={privacyOpen}
          aria-controls={foldId}
          onClick={() => setPrivacyToggle({ open: !privacyOpen, at: state })}
          className="flex min-h-11 w-full items-center justify-between gap-3 rounded-md text-left text-sm font-medium outline-none focus-visible:ring-3 focus-visible:ring-ring/50 sm:min-h-9"
        >
          {C.privacyFold}
          <ChevronRight aria-hidden className={cn("size-4 text-muted-foreground transition-transform duration-150 motion-reduce:transition-none", privacyOpen && "rotate-90")} />
        </button>
        <div id={foldId} hidden={!privacyOpen} className="grid gap-4 pt-3 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <Label htmlFor="displayName">{C.displayName}</Label>
            <Input id="displayName" name="displayName" defaultValue={workspaceName} className={FIELD} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="aggregationThreshold">{C.threshold}</Label>
            <Input id="aggregationThreshold" name="aggregationThreshold" type="number" inputMode="numeric" min={3} max={50} defaultValue={5} className={FIELD} />
            {err("aggregationThreshold")}
          </div>
          <div className="grid gap-1.5 sm:col-span-2">
            <Label htmlFor="description">{C.description}</Label>
            <Textarea id="description" name="description" className="text-base sm:text-sm" />
          </div>
          <div className="grid gap-1.5 sm:col-span-2">
            <Label htmlFor="introCopy">{C.intro}</Label>
            <Textarea id="introCopy" name="introCopy" defaultValue={AI_READINESS_DEFAULT_COPY.intro} className="text-base sm:text-sm" />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="controllerName">{C.controller}</Label>
            <Input id="controllerName" name="controllerName" defaultValue={workspaceName} className={FIELD} />
            {err("controllerName")}
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="processorName">{C.processor}</Label>
            <Input id="processorName" name="processorName" defaultValue="Unbundle / Lateral Space" className={FIELD} />
            {err("processorName")}
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="legalBasis">{C.legalBasis}</Label>
            <Input id="legalBasis" name="legalBasis" defaultValue="Legittimo interesse / misurazione organizzativa" className={FIELD} />
            {err("legalBasis")}
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="privacyNoticeUrl">{C.noticeUrl}</Label>
            <Input id="privacyNoticeUrl" name="privacyNoticeUrl" type="url" placeholder="https://" className={FIELD} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="dpoEmail">{C.dpoEmail}</Label>
            <Input id="dpoEmail" name="dpoEmail" type="email" className={FIELD} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="dataRetentionDays">{C.retention}</Label>
            <Input id="dataRetentionDays" name="dataRetentionDays" type="number" inputMode="numeric" min={30} max={3650} defaultValue={365} className={FIELD} />
            {err("dataRetentionDays")}
          </div>
        </div>
      </div>

      <Button type="submit" className="min-h-11 sm:min-h-9" disabled={pending}>
        {pending ? C.pending : C.submit}
      </Button>
    </form>
  );
}


function draftKey(workspaceId: string) {
  return `unbundle-air-create:${workspaceId}`;
}

function collectFormValues(form: HTMLFormElement) {
  const values: Record<string, string> = {};
  for (const el of Array.from(form.elements)) {
    const input = el as HTMLInputElement;
    if (!input.name || input.name.startsWith("$")) continue;
    if (input.type === "radio" || input.type === "checkbox") {
      if (input.checked) values[`${input.name}__${input.value}`] = "1";
      else values[`${input.name}__${input.value}`] = "";
    } else {
      values[input.name] = input.value;
    }
  }
  return values;
}

function applyFormValues(form: HTMLFormElement, values: Record<string, string>) {
  for (const el of Array.from(form.elements)) {
    const input = el as HTMLInputElement;
    if (!input.name || input.name.startsWith("$")) continue;
    if (input.type === "radio" || input.type === "checkbox") {
      const saved = values[`${input.name}__${input.value}`];
      if (saved != null) input.checked = saved === "1";
    } else if (values[input.name] != null) {
      input.value = values[input.name];
    }
  }
}

