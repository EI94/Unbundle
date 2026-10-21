"use client";

import { useActionState, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { AlertTriangle, Bot, Check, Copy, KeyRound, ShieldAlert } from "lucide-react";
import {
  createTeamMcpTokenAction,
  revokeAllTeamMcpTokensAction,
  revokeTeamMcpTokenAction,
  type CreateTeamMcpTokenData,
  type RevokeAllTeamMcpTokensData,
  type RevokeTeamMcpTokenData,
  type TeamMcpActionState,
} from "@/lib/actions/team-mcp-tokens";
import type { TeamMcpCardData, TeamMcpTokenView } from "@/lib/db/queries/team-mcp-tokens";
import { SettingsSection } from "@/components/dashboard/settings-section";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

/**
 * Impostazioni › Integrazioni › «Claude per il team» (docs/use-case/DESIGN.md §9.4 «Token
 * personali»; PIANO-LAVORI H5b): ogni revisore crea il suo token per il MCP del team
 * «Unbundle Use case», con etichetta e «Solo lettura», lo copia una volta e lo revoca. Chi
 * gestisce il workspace vede in più quanti token sono attivi nel workspace e li revoca tutti.
 *
 * I dati arrivano già pronti dalla pagina (`loadTeamMcpCard`): solo i token di chi guarda,
 * date in italiano, nessun hash. La pagina monta la card solo con l'area accesa e per chi ha
 * un ruolo da revisore. Il token in chiaro esiste solo nella risposta dell'azione che lo crea.
 */

/** Il risultato di un'azione della card con il suo numero d'ordine: 0 finché l'azione non è mai partita. */
export type CardActionState<Data> = TeamMcpActionState<Data> & { seq: number };

export type CardActionKind = "create" | "revoke" | "revokeAll";

const INITIAL_CREATE: CardActionState<CreateTeamMcpTokenData> = { ok: true, seq: 0 };
const INITIAL_REVOKE: CardActionState<RevokeTeamMcpTokenData> = { ok: true, seq: 0 };
const INITIAL_REVOKE_ALL: CardActionState<RevokeAllTeamMcpTokensData> = { ok: true, seq: 0 };

let lastSeq = 0;

/**
 * L'azione per `useActionState`: chiama la server action con i soli dati del modulo. Lo stato
 * precedente resta nel browser, perché dopo una creazione contiene il token in chiaro e React lo
 * manderebbe al server come argomento. Ogni risultato riceve un numero d'ordine crescente, così
 * la card mostra solo il risultato dell'ultima azione (`latestCardAction`).
 */
export function cardAction<Data>(
  run: (formData: FormData) => Promise<TeamMcpActionState<Data>>,
  onDone?: (result: TeamMcpActionState<Data>) => void
): (previous: CardActionState<Data>, formData: FormData) => Promise<CardActionState<Data>> {
  return async (_previous, formData) => {
    const result = await run(formData);
    onDone?.(result);
    lastSeq += 1;
    return { ...result, seq: lastSeq };
  };
}

/** L'azione più recente con un risultato, oppure null se nessuna è ancora partita. */
export function latestCardAction(seqs: Readonly<Record<CardActionKind, number>>): CardActionKind | null {
  let latest: CardActionKind | null = null;
  for (const kind of ["create", "revoke", "revokeAll"] as const) {
    if (seqs[kind] > 0 && (latest === null || seqs[kind] > seqs[latest])) latest = kind;
  }
  return latest;
}

/** Nome dell'header HTTP che porta il token, come lo vuole il MCP del team. */
const AUTH_HEADER = "Authorization";
const TOKEN_PLACEHOLDER = "IL_TUO_TOKEN";

/**
 * Il token appena creato, finché si può usare: sparisce quando chi guarda lo nasconde o quando
 * l'elenco lo dà non più attivo (revocato da solo o con «Revoca tutti», oppure scaduto). Se
 * l'elenco non si legge, il pannello resta: il token esiste.
 */
export function newTokenToShow(
  created: CreateTeamMcpTokenData | null | undefined,
  hiddenTokenId: string | null,
  tokens: readonly Pick<TeamMcpTokenView, "id" | "active">[]
): CreateTeamMcpTokenData | null {
  if (!created || created.tokenId === hiddenTokenId) return null;
  return tokens.some((token) => token.id === created.tokenId && !token.active) ? null : created;
}

function claudeCodeCommand(data: Pick<TeamMcpCardData, "claudeCodeName" | "url">, token: string): string {
  return `claude mcp add --transport http ${data.claudeCodeName} ${data.url} --header "${AUTH_HEADER}: Bearer ${token}"`;
}

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

function CopyButton({ value, label, className }: { value: string; label: string; className?: string }) {
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
      {copied ? "Copiato" : label}
    </Button>
  );
}

function CopyLine({ value, label, testId }: { value: string; label: string; testId?: string }) {
  return (
    <div className="flex flex-col gap-2 @sm:flex-row @sm:items-start">
      <code className="min-w-0 flex-1 break-all rounded-md bg-background px-2 py-1.5 font-mono text-xs" data-team-mcp={testId}>
        {value}
      </code>
      <CopyButton value={value} label={label} className="self-start" />
    </div>
  );
}

function stateBadge(token: TeamMcpTokenView) {
  switch (token.state) {
    // La scadenza vicina la dice l'avviso in cima e la data la riga sotto: qui basta «Attivo».
    case "attivo":
    case "in_scadenza":
      return <Badge variant="secondary">Attivo</Badge>;
    case "scaduto":
      return <Badge variant="outline" className="text-muted-foreground">Scaduto</Badge>;
    case "revocato":
      return <Badge variant="outline" className="text-muted-foreground">Revocato</Badge>;
  }
}

function TokenRow({ token, revokeAction, revokePending }: { token: TeamMcpTokenView; revokeAction: (formData: FormData) => void; revokePending: boolean }) {
  const meta = [
    token.tokenPrefix,
    token.readOnly ? "solo lettura" : "lettura e scrittura",
    `creato il ${token.createdOn}`,
    token.revokedOn ? `revocato il ${token.revokedOn}` : token.expiresOn ? `${token.state === "scaduto" ? "scaduto" : "scade"} il ${token.expiresOn}` : null,
    `ultimo uso ${token.lastUsedOn ?? "mai"}`,
  ].filter(Boolean);
  return (
    <li className="flex flex-col gap-3 p-3 @lg:flex-row @lg:items-start @lg:justify-between" data-team-mcp-token={token.state}>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="min-w-0 break-words text-sm font-medium">{token.label}</span>
          {stateBadge(token)}
        </div>
        <p className="mt-1 break-words text-xs text-muted-foreground">{meta.join(" · ")}</p>
      </div>
      {token.active ? (
        <form
          action={revokeAction}
          onSubmit={(event) => {
            if (!window.confirm(`Revocare «${token.label}»? Claude non potrà più usarlo.`)) event.preventDefault();
          }}
        >
          <input type="hidden" name="tokenId" value={token.id} />
          <Button type="submit" variant="outline" size="sm" disabled={revokePending}>
            Revoca
          </Button>
        </form>
      ) : null}
    </li>
  );
}

function NewTokenPanel({ data, card, onHide }: { data: CreateTeamMcpTokenData; card: TeamMcpCardData; onHide: () => void }) {
  return (
    <section className="space-y-3 rounded-lg border border-sky-500/30 bg-sky-500/5 p-4" aria-labelledby="team-mcp-new-token-title" data-team-mcp-new-token>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h4 id="team-mcp-new-token-title" className="text-sm font-semibold">
            Token creato: copialo ora
          </h4>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            «{data.label}», {data.readOnly ? "solo lettura" : "lettura e scrittura"}, scade il {data.expiresOn}. Per sicurezza non sarà
            più mostrato: qui resterà solo l&apos;inizio.
          </p>
        </div>
        <Button type="button" variant="ghost" size="sm" onClick={onHide}>
          Nascondi il token
        </Button>
      </div>
      <CopyLine value={data.token} label="Copia" testId="token" />
      <div className="space-y-1.5">
        <p className="text-xs text-muted-foreground">Per Claude Code, il comando con il token già dentro:</p>
        <CopyLine value={claudeCodeCommand(card, data.token)} label="Copia il comando" />
      </div>
      <p className="text-xs leading-relaxed text-muted-foreground">
        Il token vale come te: non mandarlo in chat o per email e non metterlo in un indirizzo web.
      </p>
    </section>
  );
}

function ConnectSteps({ card }: { card: TeamMcpCardData }) {
  return (
    <details className="group rounded-lg border">
      <summary className="cursor-pointer px-3 py-2 text-sm font-medium">Come collegare Claude</summary>
      <div className="space-y-4 border-t p-3 text-sm leading-relaxed">

        <div className="space-y-1.5">
          <p className="font-medium">Claude Code</p>
          <p className="text-xs text-muted-foreground">Nel terminale, con il tuo token al posto di {TOKEN_PLACEHOLDER}:</p>
          <CopyLine value={claudeCodeCommand(card, TOKEN_PLACEHOLDER)} label="Copia il comando" testId="claude-code" />
        </div>
        <div className="space-y-1.5">
          <p className="font-medium">claude.ai</p>
          <ol className="list-decimal space-y-1 pl-5 text-xs text-muted-foreground">
            <li>Aggiungi un connettore personalizzato e chiamalo «{card.connectorName}».</li>
            <li>
              Indirizzo: <code className="break-all font-mono">{card.url}</code>
            </li>
            <li>
              In «Request headers»: nome <code className="font-mono">{AUTH_HEADER}</code>, valore <code className="font-mono">Bearer</code> seguito da uno
              spazio e dal token.
            </li>
          </ol>
          <p className="text-xs text-muted-foreground">
            Aggiungilo solo per te, mai come connettore dell&apos;organizzazione: chi lo usa agisce con il tuo nome e i tuoi permessi.
          </p>
        </div>
      </div>
    </details>
  );
}

function RevokeAll({ activeCount, action, pending }: { activeCount: number; action: (formData: FormData) => void; pending: boolean }) {
  return (
    <div className="flex flex-col gap-3 border-t pt-4 @md:flex-row @md:items-center @md:justify-between" data-team-mcp-workspace>
      <div className="min-w-0">
        <p className="text-sm font-medium">
          {activeCount === 1 ? "1 token attivo nel workspace" : `${activeCount} token attivi nel workspace`}
        </p>
        <p className="mt-0.5 text-xs text-muted-foreground">Di tutte le persone che valutano. Ognuno vede solo i propri.</p>
      </div>
      <form
        action={action}
        onSubmit={(event) => {
          const ok = window.confirm(
            `Revocare tutti i ${activeCount === 1 ? "token" : `${activeCount} token`} del workspace? Claude smette di funzionare per tutte le persone che lo usano con Unbundle Use case.`
          );
          if (!ok) event.preventDefault();
        }}
      >
        <Button type="submit" variant="destructive" size="sm" disabled={pending}>
          Revoca tutti
        </Button>
      </form>
    </div>
  );
}

export function TeamMcpCard({ workspaceId, data }: { workspaceId: string; data: TeamMcpCardData }) {
  const [hiddenTokenId, setHiddenTokenId] = useState<string | null>(null);
  const [readOnly, setReadOnly] = useState(false);
  const [createState, createAction, createPending] = useActionState(
    cardAction(
      (formData) => createTeamMcpTokenAction(workspaceId, formData),
      // Il token appena creato non decide il prossimo: «Solo lettura» torna spenta, come l'etichetta.
      (result) => {
        if (result.ok && result.data) setReadOnly(false);
      }
    ),
    INITIAL_CREATE
  );
  const [revokeState, revokeAction, revokePending] = useActionState(
    cardAction((formData) => revokeTeamMcpTokenAction(workspaceId, formData)),
    INITIAL_REVOKE
  );
  const [revokeAllState, revokeAllAction, revokeAllPending] = useActionState(
    cardAction(() => revokeAllTeamMcpTokensAction(workspaceId)),
    INITIAL_REVOKE_ALL
  );
  // Solo il risultato dell'ultima azione: un messaggio di prima non resta accanto a uno nuovo.
  const latest = latestCardAction({ create: createState.seq, revoke: revokeState.seq, revokeAll: revokeAllState.seq });
  const createFeedback = latest === "create" ? createState : INITIAL_CREATE;
  const status = latest === "revoke" ? revokeState : latest === "revokeAll" ? revokeAllState : null;
  const active = data.tokens.filter((t) => t.active);
  const inactive = data.tokens.filter((t) => !t.active);
  const exposed = active.filter((t) => t.exposed);
  const expiring = active.filter((t) => t.state === "in_scadenza");
  const created = createState.ok ? newTokenToShow(createState.data, hiddenTokenId, data.tokens) : null;

  const createForm = (
    <form action={createAction} className="space-y-3 rounded-lg border bg-muted/20 p-3" data-team-mcp-create>
      <div className="space-y-1.5">
        <Label htmlFor="team-mcp-token-label">Etichetta</Label>
        <Input
          id="team-mcp-token-label"
          name="label"
          defaultValue={data.defaultLabel}
          maxLength={80}
          className="h-10 text-base sm:h-8 sm:text-sm"
          aria-invalid={!!createFeedback.fieldErrors?.label}
          aria-describedby="team-mcp-token-label-hint"
        />
        <p id="team-mcp-token-label-hint" className={cn("text-xs", createFeedback.fieldErrors?.label ? "text-red-400" : "text-muted-foreground")}>
          {createFeedback.fieldErrors?.label ?? "Per riconoscerlo, per esempio «Claude Code sul portatile»."}
        </p>
      </div>
      <div className="flex items-start gap-2">
        <Checkbox id="team-mcp-read-only" className="mt-0.5" checked={readOnly} onCheckedChange={(checked) => setReadOnly(checked === true)} />
        <div className="min-w-0">
          <Label htmlFor="team-mcp-read-only">Solo lettura</Label>
          <p className="text-xs text-muted-foreground">Claude cerca e legge, ma non crea, non modifica e non decide.</p>
        </div>
        {readOnly ? <input type="hidden" name="readOnly" value="on" /> : null}
      </div>
      <div className="flex flex-col gap-2 @md:flex-row @md:items-center @md:justify-between">
        <p className="text-xs text-muted-foreground">Scade dopo {data.ttlDays} giorni. Da {data.warningDays} giorni prima qui compare un avviso.</p>
        <Button type="submit" variant="secondary" className="h-10 self-start sm:h-8 @md:self-auto" disabled={createPending}>
          <KeyRound aria-hidden />
          {createPending ? "Creo il token..." : "Crea il tuo token"}
        </Button>
      </div>
    </form>
  );

  return (
    <SettingsSection
      id="claude-per-il-team"
      icon={Bot}
      iconClassName="bg-sky-500/10 text-sky-400"
      title="Claude per il team"
      description="Con il tuo token Claude cerca, legge, crea e decide gli use case di questo workspace, con i tuoi stessi permessi. Ognuno crea il suo."
    >
      <div className="space-y-5" data-team-mcp-card>
        {data.status === "errore" || !data.routeEnabled || exposed.length || expiring.length ? (
          <div className="space-y-2">
            {data.status === "errore" ? <Notice tone="muted">Non riesco a leggere i tuoi token. Ricarica la pagina tra poco.</Notice> : null}
            {!data.routeEnabled ? (
              <Notice tone="muted">Il collegamento con Claude non è ancora acceso: puoi creare il token, funzionerà quando lo accendiamo.</Notice>
            ) : null}
            {exposed.map((token) => (
              <Notice key={`exposed-${token.id}`} tone="danger" icon={<ShieldAlert className="size-4" />} title="Token esposto, da revocare">
                «{token.label}» è arrivato dentro un indirizzo web il {token.exposedOn}: consideralo compromesso. Revocalo e creane uno nuovo.
              </Notice>
            ))}
            {expiring.map((token) => (
              <Notice key={`expiring-${token.id}`} tone="warning" icon={<AlertTriangle className="size-4" />} title="Token in scadenza">
                «{token.label}» scade {token.expiresIn}. Crea un token nuovo e sostituiscilo in Claude.
              </Notice>
            ))}
          </div>
        ) : null}

        {active.length ? (
          // Con un token già attivo il modulo resta chiuso: di solito ne basta uno (H7).
          <details className="group rounded-lg border" data-team-mcp-create-more>
            <summary className="cursor-pointer px-3 py-2 text-sm font-medium">Crea un altro token</summary>
            <div className="border-t p-3">{createForm}</div>
          </details>
        ) : (
          createForm
        )}

        {!createFeedback.ok && createFeedback.message && !createFeedback.fieldErrors?.label ? (
          <p role="status" className="text-sm text-red-400">
            {createFeedback.message}
          </p>
        ) : null}

        {created ? <NewTokenPanel data={created} card={data} onHide={() => setHiddenTokenId(created.tokenId)} /> : null}

        <ConnectSteps card={data} />
        {data.skillName ? (
          <p className="text-xs leading-relaxed text-muted-foreground" data-team-mcp-skill>
            Dopo un AI Lab, la skill «{data.skillName}» trasforma gli appunti in use case con questo collegamento: carica il suo zip in
            Claude, in Impostazioni › Funzionalità.
          </p>
        ) : null}

        {status?.message ? (
          <p role="status" className={cn("text-sm", status.ok ? "text-green-400" : "text-red-400")} data-team-mcp-status>
            {status.message}
          </p>
        ) : null}

        <section className="space-y-2" aria-labelledby="team-mcp-own-title">
          <h3 id="team-mcp-own-title" className="text-sm font-semibold">
            I tuoi token
          </h3>
          {active.length ? (
            <ul className="divide-y rounded-lg border" aria-label="I tuoi token attivi">
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

        {/* Con zero token attivi nel workspace non c'è niente da dire né da revocare: basta «Nessun token attivo.» sopra. */}
        {data.canRevokeAll && data.workspaceActiveCount ? (
          <RevokeAll activeCount={data.workspaceActiveCount} action={revokeAllAction} pending={revokeAllPending} />
        ) : null}
      </div>
    </SettingsSection>
  );
}
