import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronRight, Factory, Inbox, Wrench } from "lucide-react";
import { PageContainer } from "@/components/dashboard/page-container";
import { SettingsSection } from "@/components/dashboard/settings-section";
import { requireWorkspacePage } from "@/lib/auth/require-workspace";
import { factoryNavVisible, loadFactoryOverview, type FactoryCaseRow, type FactoryTodo } from "@/lib/db/queries/use-case-factory-line";
import { factoryStoreReady } from "@/lib/db/queries/use-case-factory";
import { cliStoreReady } from "@/lib/db/queries/use-case-cli-auth";
import { viewerFromSession } from "@/lib/db/queries/use-case-hub";
import { getAppUcExecutor } from "@/lib/db/uc-executor";
import { AGENT_FACTORY_TEMPLATE_VERSION, compareVersions, STATION_LABEL, STATIONS, type Station } from "@/lib/use-cases/factory/line";
import { abilitiesForUseCase } from "@/lib/use-cases/permissions";
import { isUseCaseHubWorkspace } from "@/lib/use-cases/rollout";
import { canReviewWorkspacePortfolio } from "@/lib/workspace-permissions";

/**
 * «Agent Factory» (rilascio 8.1a, docs/rilascio-8/RILASCIO-8.1-COSTRUZIONE.md §2): i casi di un cliente
 * dall'impostazione all'esercizio, con lo stesso contesto per tutti quelli che ci lavorano.
 *
 * - «Da fare per te» in alto: solo le tue cose, con il link dove si agisce.
 * - La linea: quanti casi in ogni stazione.
 * - Le famiglie (i repository): ogni caso con la stazione, il prossimo passo, i compiti e le sessioni dei coding
 *   agent. Mai una cifra per persona.
 * - La coda della fabbrica, al posto dei turni: chi ci lavora la prende.
 *
 * La vede chi costruisce (ruolo di Lateral Space nel team di un caso), con i suoi casi, e il manager del workspace
 * di Lateral Space, con tutti. Agli altri: 404.
 */
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Agent Factory" };

const STATION_TONE: Record<Station, string> = {
  dossier: "border-border text-muted-foreground",
  impostazione: "border-uc-giallo bg-uc-giallo-bg",
  approvato: "border-primary/40",
  costruzione: "border-primary bg-primary/10",
  collaudo: "border-uc-verde bg-uc-verde-bg",
  esercizio: "border-uc-verde bg-uc-verde-bg",
};

const count = (n: number) => new Intl.NumberFormat("it-IT", { useGrouping: "always" }).format(n);

function since(iso: string | null): string | null {
  if (!iso) return null;
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  return days <= 0 ? "oggi" : days === 1 ? "ieri" : `${days} giorni fa`;
}

function todoHref(workspaceId: string, t: FactoryTodo): string {
  if (t.kind === "domande") return `/dashboard/${workspaceId}/use-cases/${t.useCaseId}/proposte`;
  return `/dashboard/${workspaceId}/casi-duso/${t.caseId}/progetto${t.kind === "approva" ? "" : "#compiti"}`;
}

function CaseRow({ workspaceId, c }: { workspaceId: string; c: FactoryCaseRow }) {
  const live = c.tasks.total - c.tasks.cancelled;
  const facts = [
    live > 0 ? `${c.tasks.done}/${live} compiti fatti${c.tasks.inProgress + c.tasks.inReview ? ` · ${c.tasks.inProgress + c.tasks.inReview} in corso` : ""}` : null,
    c.sessions.count ? `${count(c.sessions.count)} ${c.sessions.count === 1 ? "sessione" : "sessioni"} dei coding agent, l'ultima ${since(c.sessions.lastAt)}` : null,
  ].filter(Boolean);
  return (
    <li>
      <Link href={`/dashboard/${workspaceId}/casi-duso/${c.caseId}/progetto`} className="flex min-h-11 items-start justify-between gap-3 py-3 hover:bg-muted/40 sm:-mx-2 sm:rounded-md sm:px-2">
        <div className="min-w-0">
          <p className="text-sm">
            <span className="font-medium tabular-nums">{c.code}</span> · {c.title}
          </p>
          <p className="mt-0.5 text-sm text-muted-foreground">{c.nextStep}</p>
          {facts.length ? <p className="mt-0.5 text-xs text-muted-foreground">{facts.join(" · ")}</p> : null}
        </div>
        <span className="flex shrink-0 items-center gap-1">
          <span className={`rounded-full border px-2 py-0.5 text-xs ${STATION_TONE[c.station]}`}>{STATION_LABEL[c.station]}</span>
          <ChevronRight aria-hidden className="size-4 text-muted-foreground" />
        </span>
      </Link>
    </li>
  );
}

export default async function AgentFactoryPage({ params }: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await params;
  const { session, access } = await requireWorkspacePage(workspaceId);
  if (!isUseCaseHubWorkspace(workspaceId) || process.env.UC_ENABLED !== "true") notFound();
  const viewer = viewerFromSession(session.user, access.role);
  const lsManager = viewer.isLateralSpace && canReviewWorkspacePortfolio(access.role);
  const executor = await getAppUcExecutor();
  if (!(await factoryNavVisible(executor, { workspaceId, userId: session.user.id, lsManager }))) notFound();
  // La pagina legge le tabelle della 0030 e della 0031: finché non ci sono (il primo avvio dopo un rilascio), lo dice.
  const [factoryReady, cliReady] = await Promise.all([factoryStoreReady(executor), cliStoreReady(executor)]);
  if (!factoryReady || !cliReady) {
    return (
      <PageContainer>
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Agent Factory</h1>
        <p className="mt-2 text-sm text-muted-foreground">Non ancora disponibile: riprova tra qualche minuto.</p>
      </PageContainer>
    );
  }
  const view = await loadFactoryOverview(executor, { workspaceId, userId: session.user.id, seeAll: lsManager, canSeeNeeds: abilitiesForUseCase(viewer).canSeeNeeds });
  const counts = STATIONS.map((station) => ({ station, n: view.cases.filter((c) => c.station === station).length }));

  return (
    <PageContainer>
      <header>
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Agent Factory</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {view.cases.length === 1 ? "1 caso" : `${view.cases.length} casi`} dall&apos;impostazione all&apos;esercizio{lsManager ? "" : ", quelli dove sei nel team"}.
        </p>
      </header>

      {view.todos.length ? (
        <section aria-labelledby="per-te" className="mt-6 rounded-md border p-4">
          <h2 id="per-te" className="text-sm font-semibold">
            Da fare per te
          </h2>
          <ul className="mt-2 divide-y">
            {view.todos.map((t, i) => (
              <li key={`${t.kind}-${t.useCaseId}-${i}`}>
                <Link href={todoHref(workspaceId, t)} className="flex min-h-11 items-center justify-between gap-3 py-2 text-sm hover:underline">
                  <span>
                    <span className="font-medium tabular-nums">{t.code}</span> · {t.text}
                  </span>
                  <ChevronRight aria-hidden className="size-4 shrink-0 text-muted-foreground" />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section aria-label="La linea" className="mt-6 grid grid-cols-3 gap-2 sm:grid-cols-6">
        {counts.map(({ station, n }) => (
          <div key={station} className={`rounded-md border p-3 ${n ? "" : "opacity-60"}`}>
            <p className="text-2xl font-semibold tabular-nums">{n}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">{STATION_LABEL[station]}</p>
          </div>
        ))}
      </section>

      <div className="mt-6 space-y-6">
        {view.cases.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nessun caso ancora: un caso entra nella fabbrica con «Avvia la realizzazione», dalla pagina del suo use case.</p>
        ) : (
          view.families.map((f) => (
            <SettingsSection
              key={f.repo ?? "senza"}
              id={f.repo ? `famiglia-${f.repo.split("/")[1]}` : "da-avviare"}
              icon={f.repo ? Factory : Inbox}
              title={f.repo ? f.repo.split("/")[1] : "Da avviare"}
              description={
                f.repo
                  ? `${f.repo}${f.templateVersion ? ` · modello ${f.templateVersion}${compareVersions(f.templateVersion, AGENT_FACTORY_TEMPLATE_VERSION) < 0 ? " (indietro)" : ""}` : ""}${f.commonVersion ? ` · comune ${f.commonVersion}` : ""}`
                  : "Ancora senza repository: «unbundle repo create <ID>» crea quello della famiglia, o aggiunge la cartella del caso."
              }
            >
              <ul className="divide-y">
                {f.cases.map((c) => (
                  <CaseRow key={c.caseId} workspaceId={workspaceId} c={c} />
                ))}
              </ul>
            </SettingsSection>
          ))
        )}

        {view.queue.length ? (
          <SettingsSection id="coda" icon={Wrench} title="La coda della fabbrica" description="Il lavoro sulla fabbrica stessa. Chi ci lavora la prende: niente turni.">
            <ul className="divide-y">
              {view.queue.map((q) => (
                <li key={q.repo} className="py-2.5 text-sm">
                  <span className="font-medium">{q.repo}</span> · {q.text}
                </li>
              ))}
            </ul>
          </SettingsSection>
        ) : null}
      </div>
    </PageContainer>
  );
}
