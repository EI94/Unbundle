import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronDown, FileText } from "lucide-react";
import { PageContainer } from "@/components/dashboard/page-container";
import { casePath } from "@/components/uc/catalog/paths";
import { canWrite, openShellPage } from "@/components/uc/shell/case-data";
import { BlockEditButton, type BlockEditorConfig } from "@/components/uc/shell/description-editor";
import { BlockContent, DescriptionSection, VersionsList } from "@/components/uc/shell/description-view";
import { DetailSheet } from "@/components/uc/ui/detail-sheet";
import { EmptyState } from "@/components/uc/ui/empty-state";
import { requireWorkspacePage } from "@/lib/auth/require-workspace";
import { loadSolutionDescription } from "@/lib/db/queries/uc-solution";
import {
  askedVersion,
  blockRaw,
  blockTitle,
  blockValueForEditor,
  descriptionAtVersion,
  descriptionBlockDef,
  descriptionVersions,
  descriptionView,
  stableJson,
  type DescriptionBlockView,
} from "@/lib/uc/views/description";
import { formatDayIt, formatLongDayIt } from "@/lib/uc/views/format";
import { audienceFor, isLsViewer } from "@/lib/uc/views/status-groups";
import { SolutionNav } from "./_parts/solution-nav";

function first(v: string | string[] | undefined): string | null {
  const s = Array.isArray(v) ? v[0] : v;
  return typeof s === "string" && s ? s : null;
}

/**
 * Soluzione › Descrizione (DESIGN §3.7.1): una colonna di lettura con «In
 * breve», il problema, la soluzione, come funziona, cosa non fa e l'esempio;
 * il resto in «Altro», chiuso. Lo zero non si mostra: un blocco vuoto non
 * compare, se non al responsabile Lateral Space mentre modifica la pagina
 * (`?modifica=1`), come «+ Aggiungi …». In fondo, per Lateral Space,
 * «Modificata il … · Versioni ›» (`?apri=versioni`); `?versione=N` legge una
 * versione precedente. Gli altri ruoli leggono solo la versione attuale: niente
 * piè di pagina, pannello né versioni vecchie (i parametri si ignorano).
 *
 * Un giro solo (`loadSolutionDescription`): niente prontezza dal vivo.
 */
export default async function SolutionDescriptionPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceId: string; caseId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { workspaceId, caseId } = await params;
  const { session, access } = await requireWorkspacePage(workspaceId);
  const { caseAccess, executor } = await openShellPage({ workspaceId, caseId, session, access, page: "descrizione" });
  const data = await loadSolutionDescription(executor, { workspaceId, caseId });
  if (!data) notFound();

  const sp = await searchParams;
  const roles = caseAccess.roles;
  // Le versioni (autori, blocchi cambiati) restano a Lateral Space (DESIGN §3.7.1, §6.1): il cliente legge solo quella attuale.
  const ls = isLsViewer(roles);
  const versions = descriptionVersions(data.description, data.history);
  const shownVersion = ls ? askedVersion(sp.versione, versions[0].version) : null;
  const shown = shownVersion !== null ? descriptionAtVersion(data.description, data.history, shownVersion) : data.description;
  if (!shown) notFound();

  // In pausa e a caso chiuso i controlli di scrittura non ci sono (DESIGN §3.3).
  const canEdit = shownVersion === null && roles.includes("ls_lead") && canWrite(caseAccess) && caseAccess.status !== "sospeso";
  const editing = canEdit && first(sp.modifica) === "1";
  const view = descriptionView(shown, { audience: audienceFor(roles), includeEmpty: editing });
  const base = casePath(workspaceId, caseId, "soluzione");
  const all = canEdit ? descriptionView(shown, { audience: "ls", includeEmpty: true }) : null;
  const hasEmpty = all ? [...all.main, ...all.more].some((b) => b.empty) : false;

  const editorFor = (key: string): BlockEditorConfig | null => {
    if (!canEdit) return null;
    const def = descriptionBlockDef(key);
    if (!def) return null;
    return {
      workspaceId,
      caseId,
      blockKey: def.key,
      title: def.title,
      kind: def.kind,
      fields: def.fields ?? [],
      hint: def.hint ?? null,
      value: blockValueForEditor(def, blockRaw(def, shown)),
      base: stableJson(shown[def.key] ?? null),
    };
  };

  const section = (b: DescriptionBlockView, level: "h2" | "h3") => (
    <DescriptionSection key={b.def.key} title={b.def.title} level={level} editor={editorFor(b.def.key)} editing={editing} empty={b.empty} addLabel={b.def.add}>
      <BlockContent blockKey={b.def.key} content={b.content} perimeterLabel={data.perimeterLabel} />
    </DescriptionSection>
  );

  const current = versions[0];
  const lastChange = ls && versions.length > 1 ? formatDayIt(current.createdAt, { now: new Date() }) : null;
  const versionsOpen = ls && first(sp.apri) === "versioni" && versions.length > 1;
  const pageHref = shownVersion !== null ? `${base}?versione=${shownVersion}` : base;
  const inBreve = editorFor("in_breve");
  const hasMore = view.more.length > 0 || view.extras.length > 0;

  return (
    <PageContainer>
      <SolutionNav workspaceId={workspaceId} caseId={caseId} roles={roles} active="descrizione" />
      <div className="max-w-3xl space-y-8">
        {shownVersion !== null && (
          <p className="rounded-xl bg-muted/50 p-3 text-sm ring-1 ring-foreground/10">
            Stai leggendo la versione {shownVersion}, non quella attuale.{" "}
            <Link href={base} className="font-medium underline underline-offset-4">
              Torna alla versione attuale
            </Link>
          </p>
        )}

        {view.empty && !editing ? (
          <EmptyState
            variant="page"
            icon={FileText}
            title="La descrizione non c'è ancora."
            action={inBreve ? <BlockEditButton editor={inBreve} variant="scrivi" label={descriptionBlockDef("in_breve")?.add ?? "Scrivi «In breve»"} /> : undefined}
          />
        ) : (
          <>
            {view.main.map((b) => section(b, "h2"))}
            {hasMore && (
              <details open={editing} className="group/altro min-w-0 border-t border-border pt-4">
                <summary className="flex min-h-11 cursor-pointer list-none items-center gap-1.5 text-base font-semibold select-none [&::-webkit-details-marker]:hidden">
                  <ChevronDown className="size-4 text-muted-foreground transition-transform group-open/altro:rotate-180" aria-hidden />
                  Altro
                </summary>
                <div className="mt-4 space-y-6">
                  {view.more.map((b) => section(b, "h3"))}
                  {view.extras.map((x) => (
                    <section key={x.key} className="min-w-0 space-y-2">
                      <h3 className="text-sm font-semibold break-words">{x.title}</h3>
                      <ul className="list-disc space-y-1.5 pl-5 text-sm">
                        {x.lines.map((l, i) => (
                          <li key={i} className="pl-1 break-words">
                            {l}
                          </li>
                        ))}
                      </ul>
                    </section>
                  ))}
                </div>
              </details>
            )}
          </>
        )}

        {(lastChange || (canEdit && (hasEmpty || editing))) && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            {lastChange && (
              <p>
                Modificata il {lastChange} ·{" "}
                <Link href={`${pageHref}${pageHref.includes("?") ? "&" : "?"}apri=versioni`} scroll={false} className="inline-flex min-h-11 items-center underline-offset-4 hover:text-foreground hover:underline sm:min-h-0">
                  Versioni ›
                </Link>
              </p>
            )}
            {canEdit && editing && (
              <Link href={base} className="inline-flex min-h-11 items-center underline-offset-4 hover:text-foreground hover:underline sm:min-h-0">
                Fine modifica
              </Link>
            )}
            {canEdit && !editing && hasEmpty && !view.empty && (
              <Link href={`${base}?modifica=1`} className="inline-flex min-h-11 items-center underline-offset-4 hover:text-foreground hover:underline sm:min-h-0">
                Completa la descrizione
              </Link>
            )}
          </div>
        )}
      </div>

      {versionsOpen && (
        <DetailSheet title="Versioni della descrizione" closeHref={pageHref}>
          <VersionsList
            versions={versions}
            shownVersion={shownVersion}
            authorOf={(id) => (id ? (data.authors.get(id) ?? "Persona di Lateral Space") : null)}
            dayOf={(iso) => formatLongDayIt(iso)}
            changedText={(v) => (v.changed.length > 0 ? `Cambiati: ${v.changed.map(blockTitle).join(", ")}` : null)}
            readHref={(v) => (v.current ? base : `${base}?versione=${v.version}`)}
          />
        </DetailSheet>
      )}
    </PageContainer>
  );
}
