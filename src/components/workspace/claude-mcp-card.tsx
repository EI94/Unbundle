"use client";

import Link from "next/link";
import { useActionState, useState, type ReactNode } from "react";
import { toast } from "sonner";
import {
  createClaudeMcpTokenAction,
  revokeClaudeMcpTokenAction,
  type CreateClaudeMcpTokenData,
  type RevokeClaudeMcpTokenData,
  type WorkspaceIntegrationActionState,
} from "@/lib/actions/workspace-integrations";
import {
  buildClaudeColleagueGuide,
  buildClaudeInstallCommand,
  buildClaudeStarterPrompt,
} from "@/lib/integrations/claude-onboarding";
import { CASE_SCOPES, UC_CASE_SCOPE_PREFIX } from "@/lib/uc/mcp-access";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Bot,
  CheckCircle2,
  Copy,
  FolderCode,
  KeyRound,
  MessagesSquare,
  ShieldCheck,
  WandSparkles,
} from "lucide-react";

type TokenItem = {
  id: string;
  label: string;
  provider: string;
  tokenPrefix: string;
  scopes: string[];
  lastUsedAt: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
  createdAt: string;
};

const INITIAL_CREATE: WorkspaceIntegrationActionState<CreateClaudeMcpTokenData> =
  { ok: true };
const INITIAL_REVOKE: WorkspaceIntegrationActionState<RevokeClaudeMcpTokenData> =
  { ok: true };

function formatDate(value: string | null) {
  if (!value) return "senza scadenza";
  return new Intl.DateTimeFormat("it-IT", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(value));
}

function isActive(token: TokenItem) {
  return (
    !token.revokedAt &&
    (!token.expiresAt || new Date(token.expiresAt).getTime() > Date.now())
  );
}

function tokenFromAction(data: CreateClaudeMcpTokenData): TokenItem {
  return {
    id: data.tokenId,
    label: data.label,
    provider: "claude_mcp",
    tokenPrefix: data.tokenPrefix,
    scopes: ["portfolio:submit"],
    lastUsedAt: null,
    expiresAt: data.expiresAt,
    revokedAt: null,
    createdAt: data.createdAt,
  };
}

/** Token di un dossier (PIANO §5.8): scope `cases:*` e il marcatore `uc:case:<id>`. */
function isCaseToken(token: TokenItem) {
  return token.scopes.some(
    (scope) => scope.startsWith(UC_CASE_SCOPE_PREFIX) || CASE_SCOPES.includes(scope)
  );
}

const CASE_MARKER =
  /^uc:case:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;

/** Il dossier del token, dal marcatore `uc:case:<id>`; null se manca. */
function dossierIdOf(token: TokenItem): string | null {
  for (const scope of token.scopes) {
    const match = CASE_MARKER.exec(scope);
    if (match) return match[1];
  }
  return null;
}

/** Codice e titolo di un dossier, per i gruppi di «Claude Code sui dossier». */
export type ClaudeCardDossier = { id: string; code: string | null; title: string };

/**
 * Accessi attivi raggruppati per dossier, nell'ordine dell'elenco. Il nome del
 * gruppo è codice e titolo del dossier, se la pagina li passa; altrimenti il
 * gruppo non ha un titolo suo (ogni accesso mostra già il suo nome).
 */
function activeAccessByDossier(tokens: TokenItem[], dossiers: readonly ClaudeCardDossier[]) {
  const names = new Map(dossiers.map((d) => [d.id.toLowerCase(), d.code ? `${d.code} · ${d.title}` : d.title]));
  const groups = new Map<string, { dossierId: string | null; name: string | null; tokens: TokenItem[] }>();
  for (const token of tokens) {
    if (!isCaseToken(token) || !isActive(token)) continue;
    const dossierId = dossierIdOf(token);
    const key = dossierId ?? `token:${token.id}`;
    const group = groups.get(key);
    if (group) group.tokens.push(token);
    else
      groups.set(key, {
        dossierId,
        name: (dossierId && names.get(dossierId)) || null,
        tokens: [token],
      });
  }
  return [...groups.values()];
}

function TokenList({
  tokens,
  canManage,
  revokeFormAction,
  revokePending,
  confirmText,
}: {
  tokens: TokenItem[];
  canManage: boolean;
  revokeFormAction: (formData: FormData) => void;
  revokePending: boolean;
  confirmText: string;
}) {
  return (
    <div className="divide-y rounded-2xl border">
      {tokens.map((token) => {
        const active = isActive(token);
        return (
          <div
            key={token.id}
            className="flex flex-wrap items-center justify-between gap-3 p-3"
          >
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <div className="min-w-0 break-words text-sm font-medium">
                  {token.label}
                </div>
                <Badge variant={active ? "secondary" : "outline"}>
                  {active ? "Attivo" : "Non attivo"}
                </Badge>
              </div>
              <div className="mt-1 break-words text-xs text-muted-foreground">
                {token.tokenPrefix} · creato il{" "}
                {formatDate(token.createdAt)} · scade il{" "}
                {formatDate(token.expiresAt)} · ultimo uso{" "}
                {token.lastUsedAt ? formatDate(token.lastUsedAt) : "mai"}
              </div>
            </div>
            {canManage && active ? (
              <form
                action={revokeFormAction}
                onSubmit={(event) => {
                  if (!window.confirm(confirmText)) {
                    event.preventDefault();
                  }
                }}
              >
                <input type="hidden" name="tokenId" value={token.id} />
                <Button
                  type="submit"
                  variant="destructive"
                  size="sm"
                  disabled={revokePending}
                >
                  Revoca
                </Button>
              </form>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function OnboardingStep({
  index,
  title,
  description,
}: {
  index: string;
  title: string;
  description: string;
}) {
  return (
    <div className="rounded-2xl border bg-background/60 p-4">
      <div className="mb-3 flex h-7 w-7 items-center justify-center rounded-full bg-sky-500/10 text-xs font-semibold text-sky-500">
        {index}
      </div>
      <h3 className="text-sm font-semibold">{title}</h3>
      <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
        {description}
      </p>
    </div>
  );
}

function CopyButton({
  copied,
  kind,
  onCopy,
  children,
}: {
  copied: string | null;
  kind: string;
  onCopy: () => void;
  children: ReactNode;
}) {
  return (
    <Button type="button" variant="outline" onClick={onCopy}>
      <Copy className="mr-1 h-3.5 w-3.5" />
      {copied === kind ? "Copiato" : children}
    </Button>
  );
}

/** La nota della card v1 con l'area «Use case» accesa (docs/use-case/DESIGN.md §9.7, D11). */
export const CLAUDE_V1_HUB_NOTE = "Per proporre con Claude ora si usa il connettore «Unbundle».";

/**
 * Integrazioni › Claude: la card «Claude per Unbundle» (server stdio v1, resta
 * finché ci sono token attivi, D11) e, accanto, il blocco «Claude Code sui
 * dossier» con gli accessi attivi per dossier (DESIGN §8.3 WP10). Gli accessi
 * ai dossier si creano dal dossier («Sviluppo con Claude»); qui si vedono e si
 * revocano. `dossiers`: codice e titolo dei dossier, per dare un nome ai
 * gruppi; senza, il gruppo prende il nome dell'accesso.
 *
 * Con l'area «Use case» accesa (`useCaseHub`, docs/use-case/DESIGN.md §9.7):
 * niente token v1 nuovi (lo rifiuta anche `createClaudeMcpTokenAction`); la card
 * mostra solo l'elenco, la revoca e la nota, e con zero token v1 attivi non
 * compare. `tokens` sono solo quelli con `provider = 'claude_mcp'`
 * (`getWorkspaceIntegrationTokens`): i token personali del MCP del team hanno
 * la loro card e non contano qui.
 */
export function ClaudeMcpCard({
  workspaceId,
  workspaceName,
  canManage,
  tokens,
  dossiers = [],
  useCaseHub = false,
}: {
  workspaceId: string;
  workspaceName: string;
  canManage: boolean;
  tokens: TokenItem[];
  dossiers?: readonly ClaudeCardDossier[];
  /** Area «Use case» accesa per il workspace: solo elenco, revoca e nota (D11). */
  useCaseHub?: boolean;
}) {
  const createAction = createClaudeMcpTokenAction.bind(null, workspaceId);
  const revokeAction = revokeClaudeMcpTokenAction.bind(null, workspaceId);
  const [createState, createFormAction, createPending] = useActionState(
    createAction,
    INITIAL_CREATE
  );
  const [revokeState, revokeFormAction, revokePending] = useActionState(
    revokeAction,
    INITIAL_REVOKE
  );
  const [localTokens, setLocalTokens] = useState(tokens);
  const [copied, setCopied] = useState<
    "token" | "setup" | "guide" | "prompt" | null
  >(null);

  // L'elenco del server (dopo una rilettura) e le risposte delle action aggiornano l'elenco locale
  // nello stesso rendering, non in un effetto dopo: prima l'elenco del server, poi la chiave appena
  // creata in cima e la revoca, come facevano i tre effetti di prima.
  const [seen, setSeen] = useState({ tokens, created: createState.data, revoked: revokeState.data });
  if (seen.tokens !== tokens || seen.created !== createState.data || seen.revoked !== revokeState.data) {
    setSeen({ tokens, created: createState.data, revoked: revokeState.data });
    let next = seen.tokens !== tokens ? tokens : localTokens;
    if (seen.created !== createState.data && createState.ok && createState.data) {
      const nextToken = tokenFromAction(createState.data);
      next = [nextToken, ...next.filter((token) => token.id !== nextToken.id)];
    }
    const revoked = revokeState.ok ? revokeState.data : undefined;
    if (seen.revoked !== revokeState.data && revoked) {
      next = next.map((token) => (token.id === revoked.tokenId ? { ...token, revokedAt: revoked.revokedAt } : token));
    }
    setLocalTokens(next);
  }

  async function copy(value: string, kind: "token" | "setup" | "guide" | "prompt") {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(kind);
      toast.success("Copiato negli appunti");
    } catch {
      toast.error("Non riesco a copiare automaticamente. Seleziona il testo manualmente.");
    }
  }

  // I token dei dossier stanno nello stesso elenco del workspace ma non
  // aggiungono contributi: hanno il loro blocco e non contano come setup.
  // Solo i token v1 (`provider = 'claude_mcp'`, non di un dossier): un altro provider non conta.
  const portfolioTokens = localTokens.filter((token) => token.provider === "claude_mcp" && !isCaseToken(token));
  const dossierGroups = activeAccessByDossier(localTokens, dossiers);
  const activeTokens = portfolioTokens.filter(isActive).length;
  // D11: con l'area accesa la card resta finché ci sono token v1 attivi, e non ne crea di nuovi.
  const showV1 = !useCaseHub || activeTokens > 0;
  const canCreate = canManage && !useCaseHub;
  const feedback = createState.message ?? revokeState.message ?? null;
  const feedbackOk = createState.message ? createState.ok : revokeState.ok;
  const setupCommand = createState.data
    ? buildClaudeInstallCommand(createState.data)
    : null;
  const colleagueGuide = createState.data
    ? buildClaudeColleagueGuide({
        ...createState.data,
        workspaceName,
      })
    : null;
  const starterPrompt = buildClaudeStarterPrompt(workspaceName);

  return (
    <>
    {showV1 ? (
    <section className="overflow-hidden rounded-xl bg-card text-card-foreground ring-1 ring-foreground/10" aria-labelledby="claude-card-title" data-slot="claude-v1-card">
      <div className="border-b bg-[radial-gradient(circle_at_top_left,rgba(14,165,233,0.14),transparent_34%)] p-4 sm:p-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex min-w-0 items-start gap-3">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-sky-500/10">
              <Bot className="size-5 text-sky-400" aria-hidden />
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2 id="claude-card-title" className="text-base font-semibold">Claude per Unbundle</h2>
              </div>
              <p className="mt-1 max-w-2xl text-sm leading-relaxed text-muted-foreground">
                I colleghi possono dire a Claude che vogliono segnalare una best
                practice o un use case AI. Claude fa le domande mancanti, mostra
                il riepilogo e salva nel workspace solo dopo conferma.
              </p>
            </div>
          </div>
          <Badge variant={activeTokens > 0 ? "secondary" : "outline"} className="shrink-0 self-start">
            {activeTokens > 0
              ? `Attivo · ${activeTokens} ${activeTokens === 1 ? "configurazione" : "configurazioni"}`
              : "Da configurare"}
          </Badge>
        </div>
      </div>

      <div className="@container space-y-6 p-4 sm:p-6">
        {useCaseHub ? (
          <p className="rounded-2xl border bg-muted/20 p-4 text-sm text-muted-foreground" data-slot="claude-v1-note">
            {CLAUDE_V1_HUB_NOTE}
          </p>
        ) : null}
        {useCaseHub ? null : (
        <div className="grid gap-3 @2xl:grid-cols-3">
          <OnboardingStep
            index="1"
            title="L'amministratore collega Claude"
            description="Crea un accesso valido solo per questo workspace: dura 180 giorni e puoi revocarlo quando vuoi."
          />
          <OnboardingStep
            index="2"
            title="Il team usa Claude"
            description="Un collega scrive in linguaggio naturale: voglio inviare questo use case a Unbundle."
          />
          <OnboardingStep
            index="3"
            title="Unbundle valida"
            description="Niente numeri inventati, niente invii silenziosi: campi coerenti, riepilogo e conferma finale."
          />
        </div>
        )}

        {useCaseHub ? null : canCreate ? (
          <form
            action={createFormAction}
            className="rounded-2xl border bg-muted/20 p-4"
          >
            <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2 text-sm font-medium">
                  <WandSparkles className="h-4 w-4" />
                  Crea setup Claude per il team
                </div>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                  Genera il comando da incollare nel Terminale (Mac o Linux) per
                  collegare Claude Code a questo workspace, più un messaggio
                  pronto per i colleghi.
                </p>
              </div>
              <Badge variant="outline">Workspace {workspaceName}</Badge>
            </div>
            <div className="grid gap-3 @md:grid-cols-[1fr_auto]">
              <div className="space-y-1.5">
                <Label htmlFor="claude-token-label">Nome setup</Label>
                <Input
                  id="claude-token-label"
                  name="label"
                  className="h-10 text-base sm:h-8 sm:text-sm"
                  defaultValue={`Claude team - ${workspaceName}`}
                  aria-invalid={!!createState.fieldErrors?.label}
                />
                {createState.fieldErrors?.label ? (
                  <p className="text-xs text-red-500">
                    {createState.fieldErrors.label}
                  </p>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    Usa un nome riconoscibile, ad esempio team, funzione o pilot.
                  </p>
                )}
              </div>
              <div className="flex items-end">
                <Button type="submit" className="h-10 w-full sm:h-8 @md:w-auto" disabled={createPending}>
                  <KeyRound className="mr-1 h-3.5 w-3.5" />
                  {createPending ? "Preparo..." : "Prepara setup"}
                </Button>
              </div>
            </div>
            {feedback ? (
              <div
                className={`mt-4 rounded-lg border px-3 py-2 text-sm ${
                  feedbackOk
                    ? "border-green-500/30 bg-green-500/10 text-green-300"
                    : "border-red-500/30 bg-red-500/10 text-red-300"
                }`}
                role="status"
              >
                {feedback}
              </div>
            ) : null}
          </form>
        ) : (
          <div className="rounded-2xl border bg-muted/20 p-4 text-sm text-muted-foreground">
            Puoi vedere lo stato della connessione. Solo gli amministratori
            dell&apos;organizzazione possono creare o revocare l&apos;accesso di Claude.
          </div>
        )}

        {createState.data && setupCommand && colleagueGuide ? (
          <section className="space-y-4 rounded-3xl border border-sky-500/25 bg-sky-500/5 p-4">
            <div className="flex flex-col gap-3 @2xl:flex-row @2xl:items-start @2xl:justify-between">
              <div>
                <div className="flex items-center gap-2 text-sm font-semibold text-sky-300">
                  <CheckCircle2 className="h-4 w-4" />
                  Setup kit pronto
                </div>
                <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                  Copialo ora. Per sicurezza il token resta visibile solo in
                  questa schermata, poi potrai solo revocarlo e rigenerarlo.
                </p>
              </div>
              <Badge variant="secondary">
                Scade il {formatDate(createState.data.expiresAt)}
              </Badge>
            </div>

            <div className="grid gap-4 @4xl:grid-cols-[1.2fr_0.8fr]">
              <div className="space-y-3 rounded-2xl border bg-background p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-semibold">Installazione in Claude</h3>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Da usare una volta nell&apos;ambiente Claude del team, oppure da
                      ogni collega se non avete una distribuzione centralizzata.
                    </p>
                  </div>
                  <CopyButton
                    copied={copied}
                    kind="setup"
                    onCopy={() => copy(setupCommand, "setup")}
                  >
                    Copia setup
                  </CopyButton>
                </div>
                <Textarea
                  readOnly
                  className="min-h-36 resize-none font-mono text-xs"
                  value={setupCommand}
                />
                <div className="rounded-xl border border-amber-500/25 bg-amber-500/10 p-3 text-xs leading-relaxed text-amber-200">
                  Il comando contiene una chiave workspace. Condividilo solo con
                  persone autorizzate. Se serve, revoca il setup e generane uno
                  nuovo in pochi secondi.
                </div>
              </div>

              <div className="space-y-3">
                <div className="rounded-2xl border bg-background p-4">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <div>
                      <h3 className="text-sm font-semibold">Messaggio per colleghi</h3>
                      <p className="mt-1 text-xs text-muted-foreground">
                        Guida pronta da incollare nel canale interno.
                      </p>
                    </div>
                    <CopyButton
                      copied={copied}
                      kind="guide"
                      onCopy={() => copy(colleagueGuide, "guide")}
                    >
                      Copia guida
                    </CopyButton>
                  </div>
                  <Textarea
                    readOnly
                    className="min-h-32 resize-none text-xs"
                    value={colleagueGuide}
                  />
                </div>

                <div className="rounded-2xl border bg-background p-4">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <div>
                      <h3 className="text-sm font-semibold">Prompt di prova</h3>
                      <p className="mt-1 text-xs text-muted-foreground">
                        Per far partire subito il flusso guidato.
                      </p>
                    </div>
                    <CopyButton
                      copied={copied}
                      kind="prompt"
                      onCopy={() => copy(starterPrompt, "prompt")}
                    >
                      Copia prompt
                    </CopyButton>
                  </div>
                  <p className="rounded-xl border bg-muted/30 p-3 text-sm leading-relaxed">
                    {starterPrompt}
                  </p>
                </div>
              </div>
            </div>
          </section>
        ) : null}

        {useCaseHub ? null : (
        <section className="rounded-2xl border bg-muted/10 p-4">
          <div className="mb-4 flex items-start gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-500/10">
              <ShieldCheck className="h-4 w-4 text-emerald-500" />
            </div>
            <div>
              <h3 className="text-sm font-semibold">Esperienza utente finale</h3>
              <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                Una volta configurato, il collega non vede token o API. Gli basta
                dire a Claude di inviare a Unbundle una best practice o un use
                case AI. Claude gestisce domande, coerenza delle risposte,
                riepilogo, conferma e salvataggio.
              </p>
            </div>
          </div>
          <div className="grid gap-3 @xl:grid-cols-2">
            <div className="rounded-xl border bg-background p-3">
              <div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
                <MessagesSquare className="h-3.5 w-3.5" />
                Cosa scrive l&apos;utente
              </div>
              <p className="text-sm leading-relaxed">
                “Claude, voglio segnalare a Unbundle un use case AI: automatizzare
                il tracking dei progetti. Guidami tu.”
              </p>
            </div>
            <div className="rounded-xl border bg-background p-3">
              <div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
                <CheckCircle2 className="h-3.5 w-3.5" />
                Cosa succede dopo
              </div>
              <p className="text-sm leading-relaxed">
                Il contributo entra negli use case del workspace, viene valutato sulla
                griglia del workspace e resta modificabile dal team autorizzato.
              </p>
            </div>
          </div>
        </section>
        )}

        <section className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold">Setup configurati</h3>
            <span className="text-xs text-muted-foreground">
              Può aggiungere contributi agli use case del workspace
            </span>
          </div>
          {portfolioTokens.length === 0 ? (
            <div className="rounded-2xl border border-dashed p-4 text-sm text-muted-foreground">
              Nessun setup creato. Preparane uno quando vuoi abilitare Claude per
              questo workspace.
            </div>
          ) : (
            <TokenList
              tokens={portfolioTokens}
              canManage={canManage}
              revokeFormAction={revokeFormAction}
              revokePending={revokePending}
              confirmText="Revocare questo setup? Claude non potrà più inviare contributi con questa configurazione."
            />
          )}
        </section>

      </div>
    </section>
    ) : null}

    {dossierGroups.length > 0 ? (
      <section className="rounded-xl bg-card p-4 text-card-foreground ring-1 ring-foreground/10 sm:p-6" aria-labelledby="claude-dossier-title">
        <div className="flex min-w-0 items-start gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted">
            <FolderCode className="size-5 text-muted-foreground" aria-hidden />
          </div>
          <div className="min-w-0">
            <h2 id="claude-dossier-title" className="text-base font-semibold">
              Claude Code sui dossier
            </h2>
            <p className="mt-1 max-w-2xl text-sm leading-relaxed text-muted-foreground">
              Claude Code legge il catalogo validato di un dossier, in sola lettura. Ogni lettura resta in Attività. Gli accessi si creano
              dal dossier, in «Sviluppo con Claude»; qui si vedono e si revocano.
            </p>
          </div>
        </div>
        <div className="mt-5 space-y-5">
          {dossierGroups.map((group) => (
            <div key={group.dossierId ?? group.tokens[0].id} className="min-w-0 space-y-2">
              {group.name || group.dossierId ? (
                <div className="flex min-w-0 flex-wrap items-center justify-between gap-x-3 gap-y-1">
                  {group.name ? <h3 className="min-w-0 text-sm font-semibold break-words">{group.name}</h3> : null}
                  {group.dossierId ? (
                    <Link
                      href={`/dashboard/${workspaceId}/casi-duso/${group.dossierId}`}
                      className="ml-auto inline-flex min-h-11 items-center text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline sm:min-h-0"
                    >
                      Apri il dossier
                    </Link>
                  ) : null}
                </div>
              ) : null}
              <TokenList
                tokens={group.tokens}
                canManage={canManage}
                revokeFormAction={revokeFormAction}
                revokePending={revokePending}
                confirmText="Revocare questo accesso? Claude Code non leggerà più il dossier con questa chiave."
              />
            </div>
          ))}
        </div>
      </section>
    ) : null}
    </>
  );
}
