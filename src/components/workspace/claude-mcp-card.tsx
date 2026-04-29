"use client";

import { useActionState, useEffect, useState, type ReactNode } from "react";
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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Bot,
  CheckCircle2,
  Copy,
  KeyRound,
  MessagesSquare,
  ShieldCheck,
  Sparkles,
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

export function ClaudeMcpCard({
  workspaceId,
  workspaceName,
  canManage,
  tokens,
}: {
  workspaceId: string;
  workspaceName: string;
  canManage: boolean;
  tokens: TokenItem[];
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

  useEffect(() => {
    setLocalTokens(tokens);
  }, [tokens]);

  useEffect(() => {
    if (!createState.ok || !createState.data) return;
    const nextToken = tokenFromAction(createState.data);
    setLocalTokens((current) => [
      nextToken,
      ...current.filter((token) => token.id !== nextToken.id),
    ]);
  }, [createState.data, createState.ok]);

  useEffect(() => {
    if (!revokeState.ok || !revokeState.data) return;
    setLocalTokens((current) =>
      current.map((token) =>
        token.id === revokeState.data?.tokenId
          ? { ...token, revokedAt: revokeState.data.revokedAt }
          : token
      )
    );
  }, [revokeState.data, revokeState.ok]);

  async function copy(value: string, kind: "token" | "setup" | "guide" | "prompt") {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(kind);
      toast.success("Copiato negli appunti");
    } catch {
      toast.error("Non riesco a copiare automaticamente. Seleziona il testo manualmente.");
    }
  }

  const activeTokens = localTokens.filter(isActive).length;
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
    <div className="overflow-hidden rounded-xl border bg-card text-card-foreground">
      <div className="border-b bg-[radial-gradient(circle_at_top_left,rgba(14,165,233,0.18),transparent_34%),linear-gradient(135deg,rgba(125,211,252,0.08),transparent_45%)] p-6">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex items-start gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-sky-500/10 ring-1 ring-sky-500/20">
              <Bot className="h-5 w-5 text-sky-500" />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-base font-semibold">Claude per Unbundle</h2>
                <Badge variant="secondary" className="gap-1">
                  <Sparkles className="h-3 w-3" />
                  Effetto wow
                </Badge>
              </div>
              <p className="mt-1 max-w-2xl text-sm leading-relaxed text-muted-foreground">
                I colleghi possono dire a Claude che vogliono segnalare una best
                practice o un use case AI. Claude fa le domande mancanti, mostra
                il riepilogo e salva nel workspace solo dopo conferma.
              </p>
            </div>
          </div>
          <Badge variant={activeTokens > 0 ? "secondary" : "outline"} className="shrink-0">
            {activeTokens > 0 ? "Connesso" : "Da configurare"} · {activeTokens} setup attivi
          </Badge>
        </div>
      </div>

      <div className="space-y-6 p-6">
        <div className="grid gap-3 md:grid-cols-3">
          <OnboardingStep
            index="1"
            title="L'Admin connette"
            description="Crea un setup team legato solo a questo workspace. La chiave resta revocabile e valida 180 giorni."
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

        {canManage ? (
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
                  Genera un kit copiabile: collega Claude senza path locali o
                  istruzioni da sviluppatore.
                </p>
              </div>
              <Badge variant="outline">Workspace {workspaceName}</Badge>
            </div>
            <div className="grid gap-3 md:grid-cols-[1fr_auto]">
              <div className="space-y-1.5">
                <Label htmlFor="claude-token-label">Nome setup</Label>
                <Input
                  id="claude-token-label"
                  name="label"
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
                <Button type="submit" disabled={createPending}>
                  <KeyRound className="mr-1 h-3.5 w-3.5" />
                  {createPending ? "Preparo..." : "Prepara setup"}
                </Button>
              </div>
            </div>
            {feedback ? (
              <div
                className={`mt-4 rounded-lg border px-3 py-2 text-sm ${
                  feedbackOk
                    ? "border-green-500/30 bg-green-500/10 text-green-700 dark:text-green-300"
                    : "border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300"
                }`}
                role="status"
              >
                {feedback}
              </div>
            ) : null}
          </form>
        ) : (
          <div className="rounded-2xl border bg-muted/20 p-4 text-sm text-muted-foreground">
            Puoi vedere lo stato della connessione. Solo Executive Sponsor e
            Transformation Lead possono creare o revocare setup Claude.
          </div>
        )}

        {createState.data && setupCommand && colleagueGuide ? (
          <section className="space-y-4 rounded-3xl border border-sky-500/25 bg-sky-500/5 p-4">
            <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
              <div>
                <div className="flex items-center gap-2 text-sm font-semibold text-sky-700 dark:text-sky-300">
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

            <div className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
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
                <div className="rounded-xl border border-amber-500/25 bg-amber-500/10 p-3 text-xs leading-relaxed text-amber-800 dark:text-amber-200">
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
          <div className="grid gap-3 md:grid-cols-2">
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
                Il contributo entra in Raccolta & Ranking, viene valutato sulla
                griglia del workspace e resta modificabile dal team autorizzato.
              </p>
            </div>
          </div>
        </section>

        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">Setup configurati</h3>
            <span className="text-xs text-muted-foreground">
              Scrittura Raccolta & Ranking
            </span>
          </div>
          {localTokens.length === 0 ? (
            <div className="rounded-2xl border border-dashed p-4 text-sm text-muted-foreground">
              Nessun setup creato. Preparane uno quando vuoi abilitare Claude per
              questo workspace.
            </div>
          ) : (
            <div className="divide-y rounded-2xl border">
              {localTokens.map((token) => {
                const active = isActive(token);
                return (
                  <div
                    key={token.id}
                    className="flex flex-wrap items-center justify-between gap-3 p-3"
                  >
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <div className="truncate text-sm font-medium">
                          {token.label}
                        </div>
                        <Badge variant={active ? "secondary" : "outline"}>
                          {active ? "Attivo" : "Non attivo"}
                        </Badge>
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground">
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
                          if (
                            !window.confirm(
                              "Revocare questo setup? Claude non potrà più inviare contributi con questa configurazione."
                            )
                          ) {
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
          )}
        </section>
      </div>
    </div>
  );
}
