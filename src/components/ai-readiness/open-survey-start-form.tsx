"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  startOpenSurveyAction,
  type AiReadinessActionState,
} from "@/lib/actions/ai-readiness";
import { validateOpenSurveyStartFields } from "@/lib/ai-readiness/form-validation";
import { SURVEY_TEXT } from "@/lib/public/survey";
import { cn } from "@/lib/utils";
import { PUBLIC_FIELD, PUBLIC_LABEL, PUBLIC_PRIMARY } from "@/components/public/classes";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const INITIAL: AiReadinessActionState<{ personalUrl: string }> = { ok: true };

const S = SURVEY_TEXT.start;

/** Il valore dell'elenco per «Un'altra area»: allora l'area si scrive nel campo sotto. */
export const OTHER_AREA = "__altra__";

function storageKey(openToken: string) {
  return `unbundle-air-open:${openToken.slice(-16)}`;
}

/** La survey già iniziata da questo dispositivo; null senza, o se localStorage non risponde. */
function readExistingUrl(openToken: string): string | null {
  try {
    return window.localStorage.getItem(storageKey(openToken));
  } catch {
    return null;
  }
}

/**
 * L'avvio del questionario dal link aperto (`/s/<token>`). (Rilascio 10, ondata 4, PROPOSTA-10 §3.11) «La tua area»
 * dall'elenco delle aree che la rilevazione conosce già (`areas`, scritte come sono: nessuna si divide in due), con
 * «Un'altra area» da scrivere; senza aree, il campo da scrivere di prima. Niente email facoltativa (D12: a
 * quell'indirizzo non arrivava niente; il server accetta l'avvio senza, come prima). «Inizia» a tutta larghezza, alto
 * 48 px; da un dispositivo che l'ha già iniziato il pieno è «Riprendi da dove eri» e l'avvio diventa bordato. Campi a 16 px.
 */
export function OpenSurveyStartForm({
  openToken,
  named,
  areas,
}: {
  openToken: string;
  named: boolean;
  /** Le aree che la rilevazione conosce già (`surveyAreas`); vuoto: si scrive. */
  areas: readonly string[];
}) {
  const router = useRouter();
  const action = startOpenSurveyAction.bind(null, openToken);
  const [state, formAction, pending] = useActionState(action, INITIAL);
  const [existingUrl, setExistingUrl] = useState<string | null>(null);
  const [localErrors, setLocalErrors] = useState<Record<string, string>>({});
  const [area, setArea] = useState("");

  function clearLocalError(name: string) {
    setLocalErrors((current) => {
      if (!current[name]) return current;
      const next = { ...current };
      delete next[name];
      return next;
    });
  }

  // Anti-duplicati: se da questo dispositivo la survey è già stata iniziata,
  // proponi di riprenderla invece di crearne una nuova. Letta una volta al montaggio, dopo
  // l'idratazione: un'altra scheda che la inizia non fa comparire l'avviso qui, né lo fa un nuovo
  // rendering di questa dopo l'avvio, mentre si apre la survey.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- localStorage esiste solo nel browser, letto una volta al montaggio
    setExistingUrl(readExistingUrl(openToken));
  }, [openToken]);

  useEffect(() => {
    if (state.ok && state.data?.personalUrl) {
      try {
        window.localStorage.setItem(storageKey(openToken), state.data.personalUrl);
      } catch {}
      router.push(state.data.personalUrl);
    }
  }, [state, router, openToken]);

  const errorOf = (name: string) => localErrors[name] || state.fieldErrors?.[name];
  const areaError = errorOf("organizationUnit");

  return (
    <div className="mt-6 space-y-5">
      {existingUrl && (
        <div className="rounded-xl bg-card p-4 ring-1 ring-foreground/10" data-testid="open-resume-banner">
          <p className="font-medium">{S.resume}</p>
          <Button className={cn("mt-3", PUBLIC_PRIMARY)} type="button" onClick={() => router.push(existingUrl)}>
            {S.resumeButton}
          </Button>
        </div>
      )}

      <form
        action={formAction}
        className="space-y-5"
        noValidate
        onSubmit={(event) => {
          const data = new FormData(event.currentTarget);
          const errors = validateOpenSurveyStartFields({
            named,
            firstName: String(data.get("firstName") ?? ""),
            lastName: String(data.get("lastName") ?? ""),
            organizationUnit: String(data.get("organizationUnit") ?? ""),
          });
          if (Object.keys(errors).length > 0) {
            event.preventDefault();
            setLocalErrors(errors);
          }
        }}
      >
        {named && (
          <div className="grid gap-4 sm:grid-cols-2">
            {(["firstName", "lastName"] as const).map((name) => (
              <div key={name} className="space-y-1.5">
                <Label htmlFor={name} className={PUBLIC_LABEL}>
                  {S[name]}
                </Label>
                <Input
                  id={name}
                  name={name}
                  className={PUBLIC_FIELD}
                  autoComplete={name === "firstName" ? "given-name" : "family-name"}
                  aria-invalid={Boolean(errorOf(name))}
                  aria-describedby={errorOf(name) ? `${name}-errore` : undefined}
                  onChange={() => clearLocalError(name)}
                />
                {errorOf(name) && (
                  <p id={`${name}-errore`} className="text-sm text-destructive">
                    {errorOf(name)}
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
        <div className="space-y-1.5">
          <Label htmlFor="organizationUnit" className={PUBLIC_LABEL}>
            {S.area}
          </Label>
          {areas.length > 0 ? (
            <select
              id="organizationUnit"
              // Con «Un'altra area» il valore è quello scritto nel campo sotto, che porta lo stesso nome.
              name={area === OTHER_AREA ? undefined : "organizationUnit"}
              value={area}
              onChange={(event) => {
                setArea(event.target.value);
                clearLocalError("organizationUnit");
              }}
              aria-invalid={Boolean(areaError && area !== OTHER_AREA)}
              aria-describedby={areaError && area !== OTHER_AREA ? "organizationUnit-aiuto organizationUnit-errore" : "organizationUnit-aiuto"}
              className="h-11 w-full min-w-0 rounded-lg border border-input bg-background px-3 text-base text-foreground aria-invalid:border-destructive"
            >
              <option value="">{S.areaChoose}</option>
              {areas.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
              <option value={OTHER_AREA}>{S.areaOther}</option>
            </select>
          ) : (
            // Nessuna area ancora: si scrive, come prima.
            <Input
              id="organizationUnit"
              name="organizationUnit"
              className={PUBLIC_FIELD}
              aria-invalid={Boolean(areaError)}
              aria-describedby={areaError ? "organizationUnit-aiuto organizationUnit-errore" : "organizationUnit-aiuto"}
              onChange={() => clearLocalError("organizationUnit")}
            />
          )}
          {areas.length > 0 && area === OTHER_AREA && (
            <div className="space-y-1.5 pt-2">
              <Label htmlFor="organizationUnitOther" className={PUBLIC_LABEL}>
                {S.areaOtherLabel}
              </Label>
              <Input
                id="organizationUnitOther"
                name="organizationUnit"
                className={PUBLIC_FIELD}
                autoFocus
                aria-invalid={Boolean(areaError)}
                aria-describedby={areaError ? "organizationUnit-errore" : undefined}
                onChange={() => clearLocalError("organizationUnit")}
              />
            </div>
          )}
          <p id="organizationUnit-aiuto" className="text-sm text-muted-foreground">
            {S.areaHint}
          </p>
          {areaError && (
            <p id="organizationUnit-errore" className="text-sm text-destructive">
              {areaError}
            </p>
          )}
        </div>
        {!state.ok && state.message && (
          <p className="text-destructive" role="alert">
            {state.message}
          </p>
        )}
        <Button type="submit" className={PUBLIC_PRIMARY} variant={existingUrl ? "outline" : "default"} disabled={pending} data-testid="open-start-btn">
          {pending ? S.starting : existingUrl ? S.restart : S.start}
        </Button>
      </form>
    </div>
  );
}
