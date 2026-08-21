"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  startOpenSurveyAction,
  type AiReadinessActionState,
} from "@/lib/actions/ai-readiness";
import { validateOpenSurveyStartFields } from "@/lib/ai-readiness/form-validation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const INITIAL: AiReadinessActionState<{ personalUrl: string }> = { ok: true };

function storageKey(openToken: string) {
  return `unbundle-air-open:${openToken.slice(-16)}`;
}

export function OpenSurveyStartForm({
  openToken,
  named,
}: {
  openToken: string;
  named: boolean;
}) {
  const router = useRouter();
  const action = startOpenSurveyAction.bind(null, openToken);
  const [state, formAction, pending] = useActionState(action, INITIAL);
  const [existingUrl, setExistingUrl] = useState<string | null>(null);
  const [localErrors, setLocalErrors] = useState<Record<string, string>>({});

  function clearLocalError(name: string) {
    setLocalErrors((current) => {
      if (!current[name]) return current;
      const next = { ...current };
      delete next[name];
      return next;
    });
  }

  // Anti-duplicati: se da questo dispositivo la survey è già stata iniziata,
  // proponi di riprenderla invece di crearne una nuova.
  useEffect(() => {
    try {
      setExistingUrl(window.localStorage.getItem(storageKey(openToken)));
    } catch {}
  }, [openToken]);

  useEffect(() => {
    if (state.ok && state.data?.personalUrl) {
      try {
        window.localStorage.setItem(storageKey(openToken), state.data.personalUrl);
      } catch {}
      router.push(state.data.personalUrl);
    }
  }, [state, router, openToken]);

  return (
    <div className="space-y-4">
      {existingUrl && (
        <div
          className="rounded-2xl border border-emerald-500/40 bg-emerald-500/10 p-4 text-sm"
          data-testid="open-resume-banner"
        >
          <p className="font-medium">Hai già iniziato questa survey da questo dispositivo.</p>
          <Button
            className="mt-3"
            type="button"
            onClick={() => router.push(existingUrl)}
          >
            Riprendi da dove eri
          </Button>
        </div>
      )}

      <form
        action={formAction}
        className="space-y-4 rounded-[28px] border bg-card p-6"
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
        <h2 className="text-lg font-semibold">Inizia la survey</h2>
        {named && (
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="firstName">Nome <span className="text-destructive">*</span></Label>
              <Input
                id="firstName"
                name="firstName"
                autoComplete="given-name"
                placeholder="Es. Maria"
                aria-invalid={Boolean(localErrors.firstName || state.fieldErrors?.firstName)}
                onChange={() => clearLocalError("firstName")}
              />
              {(localErrors.firstName || state.fieldErrors?.firstName) && (
                <p className="text-xs text-destructive">
                  {localErrors.firstName || state.fieldErrors?.firstName}
                </p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="lastName">Cognome <span className="text-destructive">*</span></Label>
              <Input
                id="lastName"
                name="lastName"
                autoComplete="family-name"
                placeholder="Es. Bianchi"
                aria-invalid={Boolean(localErrors.lastName || state.fieldErrors?.lastName)}
                onChange={() => clearLocalError("lastName")}
              />
              {(localErrors.lastName || state.fieldErrors?.lastName) && (
                <p className="text-xs text-destructive">
                  {localErrors.lastName || state.fieldErrors?.lastName}
                </p>
              )}
            </div>
          </div>
        )}
        <div className="space-y-1.5">
          <Label htmlFor="organizationUnit">Area / team <span className="text-destructive">*</span></Label>
          <Input
            id="organizationUnit"
            name="organizationUnit"
            placeholder="Es. Operations, Vendite, IT..."
            aria-invalid={Boolean(
              localErrors.organizationUnit || state.fieldErrors?.organizationUnit
            )}
            onChange={() => clearLocalError("organizationUnit")}
          />
          <p className="text-xs text-muted-foreground">Serve solo per aggregare i risultati per area.</p>
          {(localErrors.organizationUnit || state.fieldErrors?.organizationUnit) && (
            <p className="text-xs text-destructive">
              {localErrors.organizationUnit || state.fieldErrors?.organizationUnit}
            </p>
          )}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="email">Email (opzionale)</Label>
          <Input id="email" name="email" type="email" placeholder="Se vuoi che ti ricontattiamo sui risultati" />
        </div>
        {!state.ok && state.message && (
          <p className="text-sm text-destructive" role="alert">{state.message}</p>
        )}
        <Button type="submit" size="lg" disabled={pending} data-testid="open-start-btn">
          {pending ? "Preparo la tua survey..." : "Inizia →"}
        </Button>
      </form>
    </div>
  );
}
