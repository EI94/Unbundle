"use client";

import { useActionState, useOptimistic, useState, useTransition, type ReactNode } from "react";
import { toast } from "sonner";
import { AlertTriangle, Cable, Check, Copy, KeyRound, ShieldAlert } from "lucide-react";
import {
  createConnectorTokenAction,
  revokeConnectorTokenAction,
  setConnectorEnabledAction,
  type ConnectorSettingsActionState,
  type CreateConnectorTokenData,
  type RevokeConnectorTokenData,
} from "@/lib/actions/connector-settings";
import type { ConnectorConfigView, ConnectorSettingsView, ConnectorTokenView } from "@/lib/connector/settings-view";
import { SettingsSection } from "@/components/dashboard/settings-section";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

/**
 * Parte interattiva della scheda «Connettore Claude» (K7r). I dati arrivano già
 * pronti dal componente server (`connector-card.tsx`): date scritte in italiano,
 * nessun hash, nessun segreto. Il token in chiaro esiste solo nella risposta
 * dell'azione che lo crea, e si mostra una volta.
 */

export type ConnectorTokenPolicy = {
  ttlDays: number;
  warningDays: number;
  /** In Claude l'header non si modifica: cambiare token vuol dire rimuovere e riaggiungere il connettore. */
  rotationNote: string;
};

const INITIAL_CREATE: ConnectorSettingsActionState<CreateConnectorTokenData> = { ok: true };
const INITIAL_REVOKE: ConnectorSettingsActionState<RevokeConnectorTokenData> = { ok: true };
const COUNT = new Intl.NumberFormat("it-IT", { useGrouping: "always" });

function Notice({ tone, icon, title, children }: { tone: "danger" | "warning" | "muted"; icon?: ReactNode; title?: string; children: ReactNode }) {
  return (
    <div
      role={tone === "danger" ? "alert" : tone === "warning" ? "status" : "note"}
      className={cn(
        "flex gap-3 rounded-lg border px-3 py-2.5 text-sm leading-relaxed",
        tone === "danger" && "border-red-500/30 bg-red-500/10 text-red-200",
        tone === "warning" && "border-amber-500/30 bg-amber-500/10 text-amber-100",
        tone === "muted" && "bg-muted/30 text-muted-foreground"
      )}
    >
      {icon ? <span className="mt-0.5 shrink-0" aria-hidden>{icon}</span> : null}
      <div className="min-w-0">
        {title ? <p className="font-medium">{title}</p> : null}
        <div>{children}</div>
      </div>
    </div>
  );
}

function Field({ term, children }: { term: string; children: ReactNode }) {
  return (
    <div className="grid gap-1 py-2.5 @md:grid-cols-[11rem_1fr] @md:gap-3">
      <dt className="text-xs font-medium text-muted-foreground @md:text-sm @md:font-normal">{term}</dt>
      <dd className="min-w-0 break-words text-sm">{children}</dd>
    </div>
  );
}

function CopyButton({ value, label, copiedLabel = "Copiato", className }: { value: string; label: string; copiedLabel?: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      toast.success("Copiato negli appunti");
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Non riesco a copiare in automatico. Seleziona il testo e copialo.");
    }
  }
  return (
    <Button type="button" variant="outline" size="sm" className={className} onClick={copy}>
      {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
      {copied ? copiedLabel : label}
    </Button>
  );
}

function EnabledSwitch({ workspaceId, enabled, canEnable }: { workspaceId: string; enabled: boolean; canEnable: boolean }) {
  const [shown, setShown] = useOptimistic(enabled);
  const [pending, startTransition] = useTransition();

  function change(checked: boolean) {
    const confirmed = window.confirm(
      checked
        ? "Riattivare il connettore? Chi lo ha in Claude potrà di nuovo cercare, inviare e chiedere lo stato delle segnalazioni."
        : "Sospendere il connettore? Per tutta l'organizzazione Claude risponderà che il servizio è sospeso e proporrà di inviare il riepilogo per email."
    );
    if (!confirmed) return;
    startTransition(async () => {
      setShown(checked);
      try {
        const result = await setConnectorEnabledAction(workspaceId, checked);
        if (result.ok) toast.success(result.message ?? "Salvato.");
        else toast.error(result.message ?? "Modifica non salvata. Riprova.");
      } catch {
        toast.error("Modifica non salvata. Riprova.");
      }
    });
  }

  return (
    <div className="flex items-center gap-3">
      <span className="text-sm text-muted-foreground" aria-hidden>
        {shown ? "Acceso" : "Sospeso"}
      </span>
      <Switch
        id="connector-enabled"
        aria-label="Connettore Claude acceso per l'organizzazione"
        checked={shown}
        onCheckedChange={change}
        // Spegnere si può sempre; accendere solo con guida, profilo e modello (l'avviso dice cosa manca).
        disabled={pending || (!shown && !canEnable)}
      />
    </div>
  );
}

function ConfigDetails({ config }: { config: ConnectorConfigView }) {
  return (
    <div className="grid gap-6 @3xl:grid-cols-2">
      <div className="min-w-0 space-y-4">
        <div className="space-y-2 rounded-lg border bg-muted/20 p-3">
          <p className="text-sm font-medium">Indirizzo da copiare</p>
          <div className="flex flex-col gap-2 @sm:flex-row @sm:items-center">
            <code className="min-w-0 flex-1 break-all rounded-md bg-background px-2 py-1.5 font-mono text-xs" data-connector-url>
              {config.url}
            </code>
            <CopyButton value={config.url} label="Copia indirizzo" className="self-start @sm:self-auto" />
          </div>
          <p className="text-xs leading-relaxed text-muted-foreground">
            L&apos;Owner dell&apos;organizzazione Claude lo aggiunge con «Add custom connector». Il token va in «Request
            headers»: nome <code className="font-mono">Authorization</code>, valore <code className="font-mono">Bearer</code>{" "}
            seguito da uno spazio e dal token.
          </p>
        </div>
        <dl className="divide-y">
          <Field term="Slug">
            <code className="font-mono">{config.slug}</code>
          </Field>
          <Field term="Prefisso dei codici">
            <span className="font-medium">{config.codePrefix}</span>
            {config.nextCode ? <span className="text-muted-foreground"> · il prossimo codice è {config.nextCode}</span> : null}
          </Field>
          <Field term="Nome visualizzato">
            {config.displayName ?? <span className="text-muted-foreground">Non impostato: Claude dice «questa organizzazione»</span>}
          </Field>
          <Field term="Versione della guida">
            {config.guideVersion ? (
              config.guideVersion
            ) : (
              <span className="text-muted-foreground">{config.hasGuide ? "Guida senza versione" : "Nessuna guida caricata"}</span>
            )}
          </Field>
          <Field term="Accesso">
            {config.authMode === "oauth" ? "Accesso personale con OAuth (fase 2)" : "Token condiviso nell'header (fase 1)"}
            <span className="text-muted-foreground">
              {config.identityMode === "verificata" ? " · identità verificata" : " · chi propone dà il nome (email facoltativa)"}
            </span>
          </Field>
        </dl>
      </div>

      <div className="min-w-0">
        <p className="text-sm font-medium">Regole d&apos;accesso</p>
        <p className="mt-1 text-xs text-muted-foreground">In sola lettura: si cambiano con la configurazione del workspace.</p>
        <dl className="mt-2 divide-y">
          <Field term="Domini email ammessi">
            {config.allowedDomains.length ? (
              <ul className="flex flex-wrap gap-1.5">
                {config.allowedDomains.map((domain) => (
                  <li key={domain}>
                    <Badge variant="outline" className="font-mono">{domain}</Badge>
                  </li>
                ))}
              </ul>
            ) : (
              <span className="text-muted-foreground">Nessuno</span>
            )}
            <p className="mt-1 text-xs text-muted-foreground">Servono all&apos;accesso personale (fase 2).</p>
          </Field>
          <Field term="Origini ammesse">
            {config.allowedOrigins.length ? (
              <ul className="flex flex-wrap gap-1.5">
                {config.allowedOrigins.map((origin) => (
                  <li key={origin}>
                    <Badge variant="outline" className="font-mono">{origin}</Badge>
                  </li>
                ))}
              </ul>
            ) : (
              <span className="text-muted-foreground">Nessuna</span>
            )}
            <p className="mt-1 text-xs text-muted-foreground">
              Una richiesta con un header Origin fuori elenco viene rifiutata; senza Origin passa.
            </p>
          </Field>
          <Field term="Limiti">
            <ul className="space-y-1">
              <li>{`${COUNT.format(config.limits.submitsPerHour)} invii e ${COUNT.format(config.limits.readsPerHour)} letture l'ora per token`}</li>
              <li>{COUNT.format(config.limits.submitsPerDayWorkspace)} invii al giorno per il workspace, da mezzanotte (ora italiana)</li>
              <li className="text-muted-foreground">{COUNT.format(config.limits.submitsPerHourPerUser)} invii l&apos;ora per persona (fase 2)</li>
            </ul>
          </Field>
        </dl>
      </div>
    </div>
  );
}

function stateBadge(token: ConnectorTokenView) {
  switch (token.state) {
    case "attivo":
      return <Badge variant="secondary">Attivo</Badge>;
    case "in_scadenza":
      return (
        <Badge variant="outline" className="border-amber-500/40 text-amber-300">
          Scade {token.expiresIn}
        </Badge>
      );
    case "scaduto":
      return <Badge variant="outline" className="text-muted-foreground">Scaduto</Badge>;
    case "revocato":
      return <Badge variant="outline" className="text-muted-foreground">Revocato</Badge>;
  }
}

function TokenRow({
  token,
  revokeAction,
  revokePending,
}: {
  token: ConnectorTokenView;
  revokeAction: (formData: FormData) => void;
  revokePending: boolean;
}) {
  const meta = [
    token.tokenPrefix,
    `creato il ${token.createdOn}`,
    token.revokedOn ? `revocato il ${token.revokedOn}` : token.expiresOn ? `${token.state === "scaduto" ? "scaduto" : "scade"} il ${token.expiresOn}` : "senza scadenza",
    `ultimo uso ${token.lastUsedOn ?? "mai"}`,
  ];
  return (
    <li className="flex flex-col gap-3 p-3 @lg:flex-row @lg:items-start @lg:justify-between" data-connector-token={token.state}>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="min-w-0 break-words text-sm font-medium">{token.label}</span>
          {stateBadge(token)}
          {token.exposed ? (
            token.active ? (
              <Badge variant="destructive" data-connector-exposed>
                esposto, da revocare
              </Badge>
            ) : (
              <Badge variant="outline" className="text-muted-foreground">
                esposto
              </Badge>
            )
          ) : null}
        </div>
        <p className="mt-1 break-words text-xs text-muted-foreground">{meta.join(" · ")}</p>
      </div>
      {token.active ? (
        <form
          action={revokeAction}
          onSubmit={(event) => {
            const ok = window.confirm(
              `Revocare «${token.label}»? Se è il token inserito in Claude, il connettore si ferma per tutta l'organizzazione finché l'Owner non lo riaggiunge con un token nuovo.`
            );
            if (!ok) event.preventDefault();
          }}
        >
          <input type="hidden" name="tokenId" value={token.id} />
          <Button type="submit" variant="destructive" size="sm" disabled={revokePending}>
            Revoca
          </Button>
        </form>
      ) : null}
    </li>
  );
}

function NewTokenPanel({ data, onHide }: { data: CreateConnectorTokenData; onHide: () => void }) {
  return (
    <section className="space-y-3 rounded-lg border border-sky-500/30 bg-sky-500/5 p-4" aria-labelledby="connector-new-token-title">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h4 id="connector-new-token-title" className="text-sm font-semibold">
            Token creato: copialo ora
          </h4>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            «{data.label}» scade il {data.expiresOn}. Per sicurezza non sarà più mostrato: qui resterà solo l&apos;inizio.
          </p>
        </div>
        <Button type="button" variant="ghost" size="sm" onClick={onHide}>
          Nascondi il token
        </Button>
      </div>
      <div className="flex flex-col gap-2 @sm:flex-row @sm:items-center">
        <code className="min-w-0 flex-1 break-all rounded-md bg-background px-2 py-1.5 font-mono text-xs" data-connector-new-token>
          {data.token}
        </code>
        <CopyButton value={data.token} label="Copia token" className="self-start @sm:self-auto" />
      </div>
      <p className="text-xs leading-relaxed text-muted-foreground">
        Consegnalo all&apos;Owner dell&apos;organizzazione Claude: va in «Request headers», come spiegato sopra. Non mandarlo in
        chat o per email in chiaro.
      </p>
    </section>
  );
}

function TokensSection({
  workspaceId,
  tokens,
  canCreate,
  policy,
  defaultLabel,
}: {
  workspaceId: string;
  tokens: ConnectorTokenView[];
  /** Solo con guida, profilo e modello delle istruzioni: senza, il token non servirebbe a nulla. */
  canCreate: boolean;
  policy: ConnectorTokenPolicy;
  defaultLabel: string;
}) {
  const [createState, createAction, createPending] = useActionState(createConnectorTokenAction.bind(null, workspaceId), INITIAL_CREATE);
  const [revokeState, revokeAction, revokePending] = useActionState(revokeConnectorTokenAction.bind(null, workspaceId), INITIAL_REVOKE);
  const [hiddenTokenId, setHiddenTokenId] = useState<string | null>(null);
  const active = tokens.filter((t) => t.active);
  const inactive = tokens.filter((t) => !t.active);
  const created = createState.ok && createState.data && createState.data.tokenId !== hiddenTokenId ? createState.data : null;

  return (
    <section className="space-y-4 border-t pt-6" aria-labelledby="connector-tokens-title">
      <div>
        <h3 id="connector-tokens-title" className="flex items-center gap-2 text-sm font-semibold">
          <KeyRound className="size-4 text-muted-foreground" aria-hidden />
          Token del connettore
        </h3>
        <p className="mt-1 max-w-3xl text-xs leading-relaxed text-muted-foreground">
          Un token dura {policy.ttlDays} giorni. Da {policy.warningDays} giorni prima della scadenza qui compare un avviso. {policy.rotationNote}
        </p>
      </div>

      {canCreate ? (
        <form action={createAction} className="space-y-1.5 rounded-lg border bg-muted/20 p-3">
          <Label htmlFor="connector-token-label">Nome del token</Label>
          <div className="flex flex-col gap-2 @md:flex-row">
            <Input
              id="connector-token-label"
              name="label"
              defaultValue={defaultLabel}
              maxLength={80}
              className="h-10 flex-1 text-base sm:h-8 sm:text-sm"
              aria-invalid={!!createState.fieldErrors?.label}
              aria-describedby="connector-token-label-hint"
            />
            <Button type="submit" variant="secondary" className="h-10 sm:h-8" disabled={createPending} data-connector-create>
              <KeyRound aria-hidden />
              {createPending ? "Creo il token..." : "Crea token"}
            </Button>
          </div>
          <p id="connector-token-label-hint" className={cn("text-xs", createState.fieldErrors?.label ? "text-red-400" : "text-muted-foreground")}>
            {createState.fieldErrors?.label ??
              (active.length ? "Il token attuale resta valido finché non lo revochi." : "Un nome riconoscibile, per esempio il mese in cui lo crei.")}
          </p>
        </form>
      ) : null}

      {!createState.ok && createState.message ? (
        <p role="status" className="text-sm text-red-400">
          {createState.message}
        </p>
      ) : null}

      {created ? <NewTokenPanel data={created} onHide={() => setHiddenTokenId(created.tokenId)} /> : null}

      {revokeState.message ? (
        <p role="status" className={cn("text-sm", revokeState.ok ? "text-green-400" : "text-red-400")}>
          {revokeState.message}
        </p>
      ) : null}

      {active.length ? (
        <ul className="divide-y rounded-lg border" aria-label="Token attivi">
          {active.map((token) => (
            <TokenRow key={token.id} token={token} revokeAction={revokeAction} revokePending={revokePending} />
          ))}
        </ul>
      ) : (
        <p className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">Nessun token attivo.</p>
      )}

      {inactive.length ? (
        <details className="group rounded-lg border">
          <summary className="cursor-pointer px-3 py-2 text-sm text-muted-foreground">Token non più attivi ({inactive.length})</summary>
          <ul className="divide-y border-t">
            {inactive.map((token) => (
              <TokenRow key={token.id} token={token} revokeAction={revokeAction} revokePending={revokePending} />
            ))}
          </ul>
        </details>
      ) : null}
    </section>
  );
}

export function ConnectorCardPanel({
  workspaceId,
  view,
  routeEnabled,
  policy,
  defaultLabel,
}: {
  workspaceId: string;
  view: ConnectorSettingsView;
  /** Interruttore generale dell'ambiente (`MCP_CONNECTOR_ENABLED`). */
  routeEnabled: boolean;
  policy: ConnectorTokenPolicy;
  defaultLabel: string;
}) {
  const { config, status, tokens } = view;
  const exposed = tokens.filter((t) => t.exposed && t.active);
  const expiring = tokens.filter((t) => t.state === "in_scadenza");

  return (
    <SettingsSection
      id="connettore-claude"
      icon={Cable}
      iconClassName="bg-orange-500/10 text-orange-400"
      title="Connettore Claude"
      description="Le persone dell'organizzazione propongono use case e best practice dialogando con Claude. Ogni segnalazione arriva in questo workspace con un codice e uno stato."
      aside={
        config ? (
          <EnabledSwitch workspaceId={workspaceId} enabled={config.enabled} canEnable={config.canActivate} />
        ) : (
          <Badge variant="outline" className="text-muted-foreground">
            Non configurato
          </Badge>
        )
      }
    >
      <div className="space-y-6">
        {(config && !routeEnabled) || (config && !config.profileReady) || status !== "attivo" || exposed.length || expiring.length ? (
          <div className="space-y-2">
            {config && !routeEnabled ? (
              <Notice tone="muted">
                In questo ambiente l&apos;interruttore generale è spento (<code className="font-mono">MCP_CONNECTOR_ENABLED</code>):
                l&apos;indirizzo risponde 404 a tutti, qualunque sia lo stato qui sotto.
              </Notice>
            ) : null}
            {config && !config.profileReady ? (
              <Notice tone="danger" icon={<AlertTriangle className="size-4" />} title="Profilo del cliente mancante">
                Mancano il profilo del cliente o il modello delle istruzioni del server: ogni richiesta di Claude riceve un
                errore. Li carica Lateral Space con lo script operatore; fino ad allora il connettore non si accende e non
                riceve token nuovi.
              </Notice>
            ) : null}
            {status === "non_configurato" ? (
              <Notice tone="muted">Il connettore non è configurato per questo workspace: revoca i token che restano.</Notice>
            ) : null}
            {status === "sospeso" ? (
              <Notice tone="warning" icon={<AlertTriangle className="size-4" />} title="Connettore sospeso">
                Claude vede ancora il connettore, ma ogni strumento risponde che il servizio è sospeso e propone di inviare il
                riepilogo per email.
              </Notice>
            ) : null}
            {status === "senza_token" ? (
              <Notice tone="warning" icon={<AlertTriangle className="size-4" />} title="Nessun token attivo">
                Claude riceve un errore di accesso. Crea un token e consegnalo all&apos;Owner dell&apos;organizzazione Claude.
              </Notice>
            ) : null}
            {exposed.map((token) => (
              <Notice key={`exposed-${token.id}`} tone="danger" icon={<ShieldAlert className="size-4" />} title="Token esposto, da revocare">
                «{token.label}» è arrivato dentro un indirizzo web il {token.exposedOn}: consideralo compromesso. Crea un token
                nuovo, fallo inserire all&apos;Owner in Claude, poi revoca quello esposto.
              </Notice>
            ))}
            {expiring.map((token) => (
              <Notice key={`expiring-${token.id}`} tone="warning" icon={<AlertTriangle className="size-4" />} title="Token in scadenza">
                «{token.label}» scade il {token.expiresOn}, {token.expiresIn}. Crea un token nuovo e fallo inserire
                all&apos;Owner prima della scadenza.
              </Notice>
            ))}
          </div>
        ) : null}

        {config ? <ConfigDetails config={config} /> : null}

        {config || tokens.length ? (
          <TokensSection
            workspaceId={workspaceId}
            tokens={tokens}
            canCreate={config?.canActivate === true}
            policy={policy}
            defaultLabel={defaultLabel}
          />
        ) : null}
      </div>
    </SettingsSection>
  );
}
