"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { updateWhatsappWebhookAction, type ActionState } from "@/lib/actions/portfolio";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SETTINGS_TEXT } from "./settings-text";

const T = SETTINGS_TEXT.links.alerts;
const INITIAL: ActionState = { ok: true };


/**
 * Collegamenti › «Altri avvisi» (rilascio 10, ondata 6b, §3.10; prima la sezione «WhatsApp»): l'indirizzo del servizio
 * esterno che avvisa il gruppo WhatsApp del team a ogni nuovo use case, in parole semplici; come funziona per chi lo
 * configura in «Dettagli tecnici». «Salva» compare solo dopo una modifica, bordato. Lo stesso controllo di prima sul
 * server (`updateWhatsappWebhookAction`: chi gestisce il workspace, un indirizzo http o https); le frasi del server
 * («Webhook salvato.») qui sono quelle della scheda (`SETTINGS_TEXT.links.alerts`).
 */
export function AlertsForm({ workspaceId, initialUrl }: { workspaceId: string; initialUrl: string }) {
  const [state, formAction, pending] = useActionState(updateWhatsappWebhookAction.bind(null, workspaceId), INITIAL);
  const router = useRouter();
  const [url, setUrl] = useState(initialUrl);
  const dirty = url.trim() !== initialUrl.trim();
  const invalid = !state.ok && Boolean(state.fieldErrors?.whatsappWebhookUrl);

  useEffect(() => {
    if (state.ok && state.message) router.refresh();
  }, [router, state.message, state.ok]);

  return (
    <form action={formAction} className="space-y-3" data-slot="settings-alerts">
      <p className="text-sm">{T.lead}</p>
      <div className="space-y-1.5">
        <Label htmlFor="settings-alerts-url">{T.field}</Label>
        <Input
          id="settings-alerts-url"
          name="whatsappWebhookUrl"
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          placeholder={T.placeholder}
          inputMode="url"
          autoComplete="off"
          className="h-11 text-base sm:h-9 sm:text-sm"
          aria-invalid={invalid || undefined}
          aria-describedby="settings-alerts-hint"
        />
        {invalid ? (
          <p id="settings-alerts-hint" role="alert" className="text-xs text-destructive">
            {T.invalid}
          </p>
        ) : (
          <p id="settings-alerts-hint" className="sr-only">
            {T.lead}
          </p>
        )}
      </div>
      <details className="text-xs text-muted-foreground">
        <summary className="inline-flex min-h-11 cursor-pointer items-center sm:min-h-8">{SETTINGS_TEXT.technical}</summary>
        <p className="mt-1">{T.technical}</p>
      </details>
      {dirty || pending ? (
        <Button type="submit" variant="outline" className="min-h-11 sm:min-h-9" disabled={pending}>
          {pending ? T.saving : T.save}
        </Button>
      ) : null}
      {state.ok && state.message && !dirty ? (
        <p role="status" className="text-xs text-uc-verde">
          {T.saved}
        </p>
      ) : null}
      {!state.ok && !invalid && state.message ? (
        <p role="alert" className="text-xs text-destructive">
          {state.message}
        </p>
      ) : null}
    </form>
  );
}
