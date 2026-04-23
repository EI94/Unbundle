import { auth } from "@/lib/auth";
import { redirect, notFound } from "next/navigation";
import { getWorkspaceById } from "@/lib/db/queries/workspaces";
import { getSlackInstallationByWorkspace } from "@/lib/db/queries/slack";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EsgToggle } from "@/components/dashboard/esg-toggle";
import { SlackInstallButton } from "@/components/dashboard/slack-install-button";
import { SlackNotifyChannelForm } from "@/components/dashboard/slack-notify-channel-form";
import { MessageSquare, CheckCircle, Leaf } from "lucide-react";

function decodeSlackErrorParam(raw: string | undefined): string {
  if (!raw) return "";
  try {
    return decodeURIComponent(raw.replace(/\+/g, " "));
  } catch {
    return raw;
  }
}

function slackInstallErrorHint(decoded: string): string | null {
  const t = decoded.toLowerCase();
  if (t.includes("bad_client_secret")) {
    return (
      "Il valore di SLACK_CLIENT_SECRET su Vercel non corrisponde al Client Secret dell’app Slack " +
      "(oppure è vuoto o di un’altra app). Apri https://api.slack.com/apps → seleziona l’app Unbundle → " +
      "Basic Information → App Credentials → copia «Client Secret» e in Vercel (Project → Settings → " +
      "Environment Variables) imposta SLACK_CLIENT_SECRET per Production, salva e fai Redeploy. " +
      "Se hai rigenerato il secret in Slack, il vecchio su Vercel non funziona più."
    );
  }
  if (
    t.includes("did not match any configured") ||
    t.includes("bad_redirect_uri") ||
    t.includes("redirect_uri")
  ) {
    return (
      "L’URL di callback non è nella lista Slack. Vai su api.slack.com/apps → la tua app → OAuth & Permissions → " +
      "Redirect URLs e aggiungi **esattamente** l’URL che vedi nell’errore (host + `/api/slack/oauth`). " +
      "Se installi da un deploy Vercel preview (es. `*.vercel.app`), quell’host va aggiunto **in aggiunta** a " +
      "produzione (`www.theunbundle.com` / `theunbundle.com`). Slack non accetta wildcard: ogni dominio preview usato va elencato, oppure testa Slack solo da produzione."
    );
  }
  return null;
}

export default async function SettingsPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceId: string }>;
  searchParams: Promise<{ slack?: string; slack_error?: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const { workspaceId } = await params;
  const workspace = await getWorkspaceById(workspaceId);
  if (!workspace) notFound();

  const search = await searchParams;
  const slackInstallation = await getSlackInstallationByWorkspace(workspaceId);
  const isSlackInstalled = !!slackInstallation;
  const slackErrDecoded = decodeSlackErrorParam(search.slack_error);
  const slackErrHint = slackErrDecoded ? slackInstallErrorHint(slackErrDecoded) : null;

  return (
    <div className="flex-1 p-6 lg:p-8 max-w-3xl">
      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight">Integrazioni</h1>
        <p className="mt-1 text-muted-foreground">
          Configura le integrazioni esterne per il tuo workspace
        </p>
      </div>

      {search.slack === "installed" && isSlackInstalled && (
        <div className="mb-6 flex items-center gap-2 rounded-lg border border-green-500/20 bg-green-500/5 px-4 py-3 text-sm text-green-400">
          <CheckCircle className="h-4 w-4" />
          Slack installato con successo!
        </div>
      )}

      {search.slack === "installed" && !isSlackInstalled && (
        <div className="mb-6 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
          <p className="font-medium text-amber-50">OAuth Slack completato, ma questo workspace non risulta collegato</p>
          <p className="mt-2 text-amber-100/90 leading-relaxed">
            Succede se l’URL ha <code className="text-amber-50/90">?slack=installed</code> ma sei in un altro
            workspace Unbundle, oppure se l’installazione è finita su un <strong>database</strong> diverso da
            quello che usa questa pagina (es. OAuth da preview <code className="text-amber-50/90">*.vercel.app</code>{" "}
            e DB preview, mentre qui leggi altro). Riprova{" "}
            <strong>Installa su Slack</strong> da questa pagina, oppure apri Integrazioni dal workspace corretto.
          </p>
        </div>
      )}

      {search.slack_error && (
        <div className="mb-6 rounded-lg border border-red-500/20 bg-red-500/5 px-4 py-3 text-sm text-red-400">
          <p className="font-medium">Installazione Slack non completata</p>
          {slackErrHint ? (
            <p className="mt-2 text-red-200/95 leading-relaxed">{slackErrHint}</p>
          ) : null}
          <p className="mt-2 text-xs text-red-300/80 break-words font-mono">{slackErrDecoded}</p>
          {!slackErrHint ? (
            <p className="mt-2 text-xs text-muted-foreground">
              In Slack App → OAuth & Permissions controlla le Redirect URL (
              <code className="text-foreground/80">/api/slack/oauth</code> sullo stesso host di Unbundle)
              e le variabili <code className="text-foreground/80">SLACK_CLIENT_ID</code> /{" "}
              <code className="text-foreground/80">SLACK_CLIENT_SECRET</code> su Vercel.
            </p>
          ) : null}
        </div>
      )}

      <div className="space-y-6">
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-purple-500/10">
                  <MessageSquare className="h-5 w-5 text-purple-400" />
                </div>
                <div>
                  <CardTitle className="text-base">Slack</CardTitle>
                  <p className="text-sm text-muted-foreground">
                    Bot per proporre use case AI direttamente da Slack
                  </p>
                </div>
              </div>
              {isSlackInstalled ? (
                <Badge variant="outline" className="border-green-500/30 text-green-400">
                  <CheckCircle className="mr-1 h-3 w-3" />
                  Connesso
                </Badge>
              ) : (
                <SlackInstallButton workspaceId={workspaceId} />
              )}
            </div>
          </CardHeader>
          {!isSlackInstalled && (
            <CardContent className="pt-0">
              <p className="text-xs text-muted-foreground leading-relaxed border-t border-border/60 pt-4">
                Dopo la connessione potrai impostare qui sotto il <strong>canale per notifiche admin</strong>{" "}
                (opzionale). In Slack, invita il bot in un canale con{" "}
                <code className="text-foreground/80">/invite @Unbundle</code> (o il nome della tua app). Se nelle DM
                compare &quot;invio messaggi disattivato&quot;, in{" "}
                <a
                  className="text-purple-400 underline hover:text-purple-300"
                  href="https://api.slack.com/apps"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  api.slack.com/apps
                </a>{" "}
                → <strong>App Home</strong> abilita la scheda Messaggi / messaggi dall’utente. Per le menzioni:
                <strong> Event Subscriptions</strong> deve usare lo stesso backend che ha salvato il token (URL{" "}
                <code className="text-foreground/80">…/api/slack/events</code>); Slack consente un solo URL: di
                solito va quello di <strong>produzione</strong> se il DB è condiviso con OAuth da produzione.
              </p>
            </CardContent>
          )}
          {isSlackInstalled && (
            <CardContent className="pt-0">
              <div className="rounded-lg bg-accent/30 px-4 py-3 text-sm">
                <p className="text-muted-foreground">
                  Workspace: <span className="text-foreground font-medium">{slackInstallation.slackTeamName ?? slackInstallation.slackTeamId}</span>
                </p>
                <p className="text-muted-foreground mt-1">
                  Nei <strong>canali</strong>, invita il bot (<code className="font-mono text-purple-400">/invite @Unbundle</code>) prima
                  di menzionarlo. Nelle <strong>DM</strong> con il bot, se Slack blocca l’invio, abilita i messaggi utente
                  in <strong>App Home</strong> nella configurazione dell’app. Le menzioni richiedono che{" "}
                  <strong>Event Subscriptions</strong> sia attivo e l’URL punti a questo deploy (stesso database di
                  questa installazione).
                </p>
                <p className="text-muted-foreground mt-2">
                  Il campo sotto è solo per <strong>notifiche admin</strong> verso un canale (ID che inizia con{" "}
                  <span className="font-mono">C</span>/<span className="font-mono">G</span>), non sostituisce
                  l’invito al canale.
                </p>
                <SlackNotifyChannelForm
                  workspaceId={workspaceId}
                  initialChannelId={slackInstallation.notifyChannelId}
                />
              </div>
            </CardContent>
          )}
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-green-500/10">
                  <Leaf className="h-5 w-5 text-green-400" />
                </div>
                <div>
                  <CardTitle className="text-base">Scoring ESG</CardTitle>
                  <p className="text-sm text-muted-foreground">
                    Includi Environmental, Social, Governance nella valutazione use case
                  </p>
                </div>
              </div>
              <EsgToggle
                workspaceId={workspaceId}
                initialEnabled={workspace.esgEnabled === true}
              />
            </div>
          </CardHeader>
        </Card>
      </div>
    </div>
  );
}
