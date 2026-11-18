import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronRight, ExternalLink, Factory, Inbox, Users, Wrench } from "lucide-react";
import { PageContainer } from "@/components/dashboard/page-container";
import { SettingsSection } from "@/components/dashboard/settings-section";
import { requireWorkspacePage } from "@/lib/auth/require-workspace";
import { factoryNavVisible, loadFactoryOverview, type FactoryCaseRow, type FactoryTodo } from "@/lib/db/queries/use-case-factory-line";
import { factoryStoreReady } from "@/lib/db/queries/use-case-factory";
import { cliStoreReady } from "@/lib/db/queries/use-case-cli-auth";
import { viewerFromSession } from "@/lib/db/queries/use-case-hub";
import { ucLsDomains } from "@/lib/db/queries/uc-access";
import { getAppUcExecutor } from "@/lib/db/uc-executor";
import { AGENT_FACTORY_TEMPLATE_VERSION, benchFacts, compareVersions, evalsFact, STATION_LABEL, STATIONS, type Station } from "@/lib/use-cases/factory/line";
import { abilitiesForUseCase } from "@/lib/use-cases/permissions";
import { isUseCaseHubWorkspace } from "@/lib/use-cases/rollout";
import { canReviewWorkspacePortfolio } from "@/lib/workspace-permissions";
import { externalRefusals, listBuilders, listWhereChoices, type BuilderRow } from "@/lib/db/queries/use-case-workspace-team";
import { loadMemberCandidates } from "@/lib/db/queries/uc-shell";
import { ROLE_LABEL } from "@/lib/uc/views/labels";
import { builderStateText, builderWhereText, externalRemoveConfirm } from "@/lib/use-cases/factory/builders-text";
import { BuilderFacts } from "@/components/agent-factory/builder-facts";
import { AddBuilder, RemoveBuilder } from "./team-forms";

/**
 * «Agent Factory» (rilascio 8.1a, docs/rilascio-8/RILASCIO-8.1-COSTRUZIONE.md §2): i casi di un cliente
 * dall'impostazione all'esercizio, con lo stesso contesto per tutti quelli che ci lavorano.
 *
 * - «Da fare per te» in alto: solo le tue cose, con il link dove si agisce.
 * - La linea: quanti casi in ogni stazione.
 * - Le famiglie (i repository): ogni caso con la stazione, il prossimo passo, i compiti e le sessioni dei coding
 *   agent. Mai una cifra per persona.
 * - (Ondata 0) «Repository da aggiornare», al posto dei turni: chi ci lavora lo prende.
 * - (8.1b, 8.0c) «Chi costruisce», solo per il manager di Lateral Space: il team di Lateral Space del cliente (in tutti
 *   i casi, anche in quelli che si apriranno) e chi costruisce da fuori, «Sviluppatore esterno», con il suo «Dove». Ogni
 *   riga dice se la CLI è collegata, o perché da fuori oggi non costruisce. «Togli» chiede conferma con i casi e i
 *   repository di GitHub (da togliere a mano).
 * - (8.2a) Per ogni caso le evals («evals 96%», «sotto soglia») e il consiglio del banco di prova; in «Da fare per te»,
 *   a chi costruisce il caso, il consiglio del banco e le evals sotto soglia, con il link a «Evals e banco di prova».
 *
 * La vede chi costruisce (ruolo di Lateral Space nel team di un caso o, 8.0c, da fuori con il predicato unico), con i
 * suoi casi, e il manager del workspace di Lateral Space, con tutti. Agli altri: 404.
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

/** (8.1b) Le PR del caso in una riga: aperte, unite, e di solito quanto dalla presa all'unione. */
function prLine(p: FactoryCaseRow["prs"]): string | null {
  if (!p.open && !p.merged) return null;
  const parts = [p.open ? `${count(p.open)} PR ${p.open === 1 ? "aperta" : "aperte"}` : null, p.merged ? `${count(p.merged)} ${p.merged === 1 ? "unita" : "unite"}` : null].filter(Boolean);
  const days = p.medianDays === null ? null : p.medianDays < 1 ? "di solito in meno di un giorno dalla presa all'unione" : `di solito ${new Intl.NumberFormat("it-IT", { maximumFractionDigits: 1 }).format(p.medianDays)} giorni dalla presa all'unione`;
  const spend =
    p.costPerPrUsd !== null || p.tokensPerPr !== null
      ? `in media ${[p.costPerPrUsd !== null ? new Intl.NumberFormat("it-IT", { style: "currency", currency: "USD" }).format(p.costPerPrUsd) : null, p.tokensPerPr !== null ? `${count(p.tokensPerPr)} token` : null].filter(Boolean).join(" e ")} per PR unita`
      : null;
  return [parts.join(" e "), days, spend].filter(Boolean).join(", ");
}

function todoHref(workspaceId: string, t: FactoryTodo): string {
  if (t.href) return t.href;
  if (t.kind === "collega") return `/dashboard/${workspaceId}/settings#cli`;
  if (t.kind === "domande") return `/dashboard/${workspaceId}/use-cases/${t.useCaseId}/proposte`;
  if (t.kind === "banco" || t.kind === "evals") return `/dashboard/${workspaceId}/casi-duso/${t.caseId}/progetto#banco`;
  return `/dashboard/${workspaceId}/casi-duso/${t.caseId}/progetto${t.kind === "approva" ? "" : "#compiti"}`;
}

function CaseRow({ workspaceId, c }: { workspaceId: string; c: FactoryCaseRow }) {
  const live = c.tasks.total - c.tasks.cancelled;
  const facts = [
    live > 0 ? `${c.tasks.done}/${live} compiti fatti${c.tasks.inProgress + c.tasks.inReview ? ` · ${c.tasks.inProgress + c.tasks.inReview} in corso` : ""}` : null,
    c.sessions.count ? `${count(c.sessions.count)} ${c.sessions.count === 1 ? "sessione" : "sessioni"} dei coding agent, l'ultima ${since(c.sessions.lastAt)}` : null,
    prLine(c.prs),
    evalsFact(c.evals),
    ...benchFacts(c.benches),
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

/** Una persona di «Chi costruisce»: nome, da fuori o no, ruolo, dove, la CLI (o perché da fuori oggi non costruisce). */
function BuilderLine({ workspaceId, m }: { workspaceId: string; m: BuilderRow }) {
  const role = m.external ? "Sviluppatore" : ROLE_LABEL[m.role as keyof typeof ROLE_LABEL];
  const facts = [...(m.external ? ["esterno"] : []), role, builderWhereText(m.where, m.whereCodes), builderStateText(m)];
  const confirm = m.external
    ? externalRemoveConfirm({ name: m.name, openCases: m.openCases, repos: m.repos })
    : {
        title: `Togliere ${m.name} da chi costruisce?`,
        text: `Esce da tutti i casi aperti dove è ${role.toLowerCase()} e non entra in quelli nuovi; i compiti che ha lì tornano da prendere. I ruoli dati caso per caso restano; l'unico responsabile di un caso non si toglie.`,
      };
  return (
    <li className="flex min-h-11 items-center justify-between gap-3 py-2 text-sm">
      <span className="min-w-0">
        <span className="font-medium break-words">{m.name}</span>
        <BuilderFacts email={m.external ? null : m.email} facts={facts} />
      </span>
      <RemoveBuilder workspaceId={workspaceId} userId={m.userId} name={m.name} title={confirm.title} text={confirm.text} />
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
  const lsDomains = ucLsDomains();
  if (!(await factoryNavVisible(executor, { workspaceId, userId: session.user.id, lsManager, lsDomains }))) notFound();
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
  const view = await loadFactoryOverview(executor, { workspaceId, userId: session.user.id, seeAll: lsManager, canSeeNeeds: abilitiesForUseCase(viewer).canSeeNeeds, lsDomains });
  const [builders, candidates, choices] = lsManager
    ? await Promise.all([listBuilders(executor, workspaceId, lsDomains), loadMemberCandidates(executor, { workspaceId, lsDomains }), listWhereChoices(executor, workspaceId)])
    : [null, [], []];
  // (8.0c) Chi da fuori oggi «Aggiungi» rifiuterebbe (Contributore, e-mail da verificare): si vede, non si sceglie.
  const refused = lsManager
    ? await externalRefusals(
        executor,
        workspaceId,
        candidates.filter((c) => !c.isLateralSpace).map((c) => c.userId),
        lsDomains,
      )
    : new Map<string, string>();
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
                {t.href ? (
                  <a href={t.href} target="_blank" rel="noreferrer" className="flex min-h-11 items-center justify-between gap-3 py-2 text-sm hover:underline">
                    <span>
                      <span className="font-medium tabular-nums">{t.code}</span> · {t.text}
                    </span>
                    <ExternalLink aria-label="Su GitHub" className="size-4 shrink-0 text-muted-foreground" />
                  </a>
                ) : (
                  <Link href={todoHref(workspaceId, t)} className="flex min-h-11 items-center justify-between gap-3 py-2 text-sm hover:underline">
                    {t.code ? (
                      <span>
                        <span className="font-medium tabular-nums">{t.code}</span> · {t.text}
                      </span>
                    ) : (
                      <span>{t.text}</span>
                    )}
                    <ChevronRight aria-hidden className="size-4 shrink-0 text-muted-foreground" />
                  </Link>
                )}
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
          <p className="text-sm text-muted-foreground">Nessun caso ancora: un caso entra nell&apos;Agent Factory con «Avvia la realizzazione», dalla pagina del suo use case.</p>
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

        {builders ? (
          <SettingsSection
            id="team"
            icon={Users}
            title="Chi costruisce"
            description="Lavorano ai casi del cliente da Unbundle e con Claude Code. Chi è in tutti i casi entra anche in quelli nuovi. Il progetto di ogni caso lo approva il suo responsabile."
          >
            {builders.length ? (
              <ul className="divide-y">
                {builders.map((m) => (
                  <BuilderLine key={m.userId} workspaceId={workspaceId} m={m} />
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">Ancora nessuno: chi aggiungi qui lavora ai casi del cliente.</p>
            )}
            <AddBuilder
              workspaceId={workspaceId}
              candidates={candidates.map((c) => ({ userId: c.userId, name: c.name, isLateralSpace: c.isLateralSpace, blocked: c.isLateralSpace ? null : (refused.get(c.userId) ?? null) }))}
              choices={choices}
            />
          </SettingsSection>
        ) : null}

        {view.queue.length ? (
          <SettingsSection id="coda" icon={Wrench} title="Repository da aggiornare" description="Hanno un modello più vecchio dell'ultimo. Chi ci lavora li prende: niente turni.">
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
