"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { ChevronLeft, ChevronRight, Lock, SearchX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/uc/ui/empty-state";
import { StatusDot } from "@/components/uc/ui/status-dot";
import { selectCatalogItemsAction } from "@/lib/actions/uc-catalog-selection";
import { cn } from "@/lib/utils";
import { answersText, questionsText } from "@/lib/uc/views/bulk";
import { QUESTIONS_PAGE_SIZE, hasActiveQuestionFilter, questionQuery, withoutQuestionFilters, type QuestionAudience, type QuestionDefaults, type QuestionFilter } from "@/lib/uc/views/catalog-filter";
import { formatCountIt } from "@/lib/uc/views/format";
import { WORDS } from "@/lib/uc/views/labels";
import type { ContactOption, QuestionGroupView, QuestionRowView, QuestionSegmentItem } from "@/lib/uc/views/rows";
import { mineExcludedText } from "@/lib/uc/views/verification";
import type { ItemStatus } from "@/lib/uc/vocab";
import { QuestionSelectionBar, type BulkPermissions, type BulkSelection } from "./bulk-actions";
import { QuestionToolbar, type QuestionFilterOptions } from "./catalog-filters";
import { CHECKBOX_CLASS } from "./checkbox";
import { ValueText } from "./value-text";

export interface QuestionListProps {
  workspaceId: string;
  caseId: string;
  /** `/dashboard/<ws>/casi-duso/<caso>/domande`. */
  basePath: string;
  audience: QuestionAudience;
  filter: QuestionFilter;
  defaults: QuestionDefaults;
  segments: QuestionSegmentItem[];
  rows: QuestionRowView[];
  /** Gruppi per argomento; null = elenco semplice. */
  groups: QuestionGroupView[] | null;
  /** Domande del segmento aperto, in tutte le pagine. */
  total: number;
  /** Risposte da verificare date da chi guarda (Lateral Space). */
  mine: number;
  /** «115 domande senza referente · Assegna ›»: solo per chi assegna. */
  unassigned: { count: number; href: string } | null;
  options: QuestionFilterOptions;
  permissions: BulkPermissions;
  contacts: ContactOption[];
  /** «Verifica una alla volta» (chi valida). */
  reviewHref: string | null;
  documentsHref: string;
  /** La domanda aperta nel pannello (`?apri=`), evidenziata nella lista. */
  openId: string | null;
}

/** Riga: la stessa classe per tutte le 50, una volta sola nel codice. */
const ROW = "group/row relative flex min-h-14 min-w-0 items-start gap-3 px-3 py-2.5 transition-colors hover:bg-muted/50 sm:px-4";
const LINK = "flex min-w-0 flex-1 items-start gap-3 rounded-sm outline-none after:absolute after:inset-0 focus-visible:after:ring-3 focus-visible:after:ring-ring/50";

/**
 * Domande (DESIGN §3.6.2, §3.6.7, §3.6.8): barra degli strumenti, righe per
 * argomento, piè di pagina compatto e selezione sul modello di Mail. Il clic su
 * una riga apre il pannello (`?apri=<id>`); con Cmd o Ctrl apre la pagina
 * intera. Filtri e ricerca cambiano l'URL dentro una transizione: intanto la
 * lista si attenua (`aria-busy`).
 */
export function QuestionList(props: QuestionListProps) {
  const { basePath, audience, filter, defaults, rows, groups, total } = props;
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const navigate = (href: string, opts: { replace?: boolean } = {}) =>
    startTransition(() => (opts.replace ? router.replace(href, { scroll: false }) : router.push(href, { scroll: false })));
  const query = questionQuery(filter, defaults);
  const ls = audience === "ls";
  const selectable = props.permissions.any;

  // La selezione vale per la vista in cui è nata: cambiando filtri o pagina si svuota da sé.
  const viewKey = `${query}|${filter.pagina}`;
  const [selecting, setSelecting] = useState(false);
  const [sel, setSel] = useState<{ key: string; picked: ReadonlyMap<string, ItemStatus>; all: BulkSelection | null }>({ key: viewKey, picked: new Map(), all: null });
  const current = sel.key === viewKey ? sel : { key: viewKey, picked: new Map<string, ItemStatus>(), all: null };
  const clear = () => setSel({ key: viewKey, picked: new Map(), all: null });
  const toggle = (row: QuestionRowView, on: boolean) => {
    // Togliere una domanda da «tutte le N» torna alla selezione della pagina.
    const next = new Map(current.all ? rows.map((r) => [r.id, r.status] as const) : current.picked);
    if (on) next.set(row.id, row.status);
    else next.delete(row.id);
    setSel({ key: viewKey, picked: next, all: null });
  };
  const [loadingAll, setLoadingAll] = useState(false);
  async function selectAll() {
    setLoadingAll(true);
    try {
      const r = await selectCatalogItemsAction(props.workspaceId, props.caseId, { kind: "domande", query: questionQuery(filter, defaults, {}, { explicit: true }) });
      if (!r.ok) toast.error(r.message);
      else setSel({ key: viewKey, picked: current.picked, all: { scope: "risultati", byStatus: r.data.byStatus, count: r.data.total, truncated: r.data.truncated } });
    } catch {
      toast.error("Selezione non riuscita. Riprova tra poco.");
    } finally {
      setLoadingAll(false);
    }
  }
  const selection: BulkSelection = current.all ?? { scope: "pagina", byStatus: byStatusOf(current.picked), count: current.picked.size, truncated: false };
  const isPicked = (id: string) => current.all !== null || current.picked.has(id);

  const openPanel = (e: React.MouseEvent<HTMLAnchorElement>, id: string) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
    e.preventDefault();
    navigate(`${basePath}${questionQuery(filter, defaults, { pagina: filter.pagina }, { extra: { apri: id } })}`);
  };

  const byId = new Map(rows.map((r) => [r.id, r]));
  const renderRow = (r: QuestionRowView) => (
    <QuestionRow
      key={r.id}
      row={r}
      audience={audience}
      vista={filter.vista}
      showMust={!filter.soloIndispensabili}
      href={`${basePath}/${r.id}`}
      open={props.openId === r.id}
      onOpen={openPanel}
      selecting={selectable && selecting}
      picked={isPicked(r.id)}
      onPick={toggle}
    />
  );

  const pages = Math.max(1, Math.ceil(total / QUESTIONS_PAGE_SIZE));
  const first = total === 0 ? 0 : (filter.pagina - 1) * QUESTIONS_PAGE_SIZE + 1;
  const last = Math.min(filter.pagina * QUESTIONS_PAGE_SIZE, total);
  const reviewing = ls && filter.vista === "da-verificare";
  const mineNote = reviewing ? mineExcludedText(props.mine, "elenco") : null;

  return (
    // Al telefono la riga «N selezionate» della barra va da sola, i pulsanti sotto (la barra è di `ui/selection-bar`).
    <div className="min-w-0 space-y-4 max-sm:[&_[data-slot=selection-bar]>p]:basis-full">
      <QuestionToolbar
        basePath={basePath}
        audience={audience}
        filter={filter}
        defaults={defaults}
        segments={props.segments}
        documentsHref={props.documentsHref}
        options={props.options}
        navigate={navigate}
        selection={{
          available: selectable,
          active: selecting,
          onToggle: () => {
            if (selecting) clear();
            setSelecting(!selecting);
          },
        }}
      />

      {props.unassigned && props.unassigned.count > 0 && (
        <p className="text-sm text-muted-foreground">
          {questionsText(props.unassigned.count)} senza referente ·{" "}
          <Link href={props.unassigned.href} className="inline-flex min-h-11 items-center font-medium text-foreground underline-offset-4 hover:underline sm:min-h-0">
            Assegna ›
          </Link>
        </p>
      )}

      {reviewing && total > 0 && (
        <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
          <p className="text-sm">{answersText(total)} da verificare, dalla più vecchia.</p>
          {props.reviewHref && (
            <Button variant="outline" className="min-h-11 sm:min-h-8" render={<Link href={props.reviewHref} />} nativeButton={false}>
              Verifica una alla volta
            </Button>
          )}
        </div>
      )}

      <div aria-busy={pending} className={cn("min-w-0 transition-opacity", pending && "opacity-60")}>
        {rows.length === 0 ? (
          <ListEmpty filter={filter} audience={audience} onClear={() => navigate(`${basePath}${questionQuery({ ...withoutQuestionFilters(filter), q: null }, defaults)}`)} />
        ) : groups ? (
          <div className="space-y-6">
            {groups.map((g) => (
              <section key={g.key || "senza"} aria-label={g.title} className="min-w-0">
                <h2 className="mb-1.5 text-xs tracking-wide text-muted-foreground">
                  <span className="font-medium text-foreground">{g.title}</span>
                  {g.meta && ` · ${g.meta}`}
                </h2>
                <ul className="divide-y overflow-hidden rounded-xl bg-card ring-1 ring-foreground/10">{g.rowIds.map((id) => renderRow(byId.get(id)!))}</ul>
              </section>
            ))}
          </div>
        ) : (
          <ul className="divide-y overflow-hidden rounded-xl bg-card ring-1 ring-foreground/10">{rows.map(renderRow)}</ul>
        )}
      </div>

      {mineNote && <p className="border-t pt-3 text-sm text-muted-foreground">{mineNote}</p>}

      {pages > 1 && (
        <nav aria-label="Pagine" className="flex min-w-0 flex-wrap items-center justify-between gap-2 text-sm">
          <span className="text-muted-foreground tabular-nums">
            {formatCountIt(first)}–{formatCountIt(last)} di {formatCountIt(total)}
          </span>
          <span className="flex gap-1">
            {filter.pagina > 1 && (
              <Button variant="ghost" className="min-h-11 sm:min-h-8" onClick={() => navigate(`${basePath}${questionQuery(filter, defaults, { pagina: filter.pagina - 1 })}`)}>
                <ChevronLeft aria-hidden />
                Precedenti
              </Button>
            )}
            {filter.pagina < pages && (
              <Button variant="ghost" className="min-h-11 sm:min-h-8" onClick={() => navigate(`${basePath}${questionQuery(filter, defaults, { pagina: filter.pagina + 1 })}`)}>
                Successive
                <ChevronRight aria-hidden />
              </Button>
            )}
          </span>
        </nav>
      )}

      {selectable && selecting && selection.count > 0 && (
        <QuestionSelectionBar
          workspaceId={props.workspaceId}
          caseId={props.caseId}
          selection={selection}
          total={loadingAll ? selection.count : total}
          permissions={props.permissions}
          contacts={props.contacts}
          onCancel={clear}
          onSelectAll={() => void selectAll()}
          onDone={clear}
        />
      )}
    </div>
  );
}

function byStatusOf(picked: ReadonlyMap<string, ItemStatus>): Partial<Record<ItemStatus, string[]>> {
  const out: Partial<Record<ItemStatus, string[]>> = {};
  for (const [id, status] of picked) (out[status] ??= []).push(id);
  return out;
}

const EMPTY_TEXT: Readonly<Record<QuestionFilter["vista"], string>> = {
  "da-fare": "Nessuna domanda da fare.",
  "da-verificare": "Niente da verificare, adesso.",
  bloccate: "Nessuna domanda bloccata.",
  "a-posto": "Ancora nessuna domanda a posto.",
  tutte: "Nessuna domanda.",
};

function ListEmpty({ filter, audience, onClear }: { filter: QuestionFilter; audience: QuestionAudience; onClear: () => void }) {
  if (filter.q) {
    return (
      <EmptyState
        icon={SearchX}
        title={`Nessuna domanda trovata per “${filter.q}”.`}
        action={
          <Button variant="outline" className="min-h-11 sm:min-h-8" onClick={onClear}>
            Togli i filtri
          </Button>
        }
      />
    );
  }
  if (hasActiveQuestionFilter(filter)) {
    return (
      <EmptyState
        title="Nessuna domanda con questi filtri."
        action={
          <Button variant="outline" className="min-h-11 sm:min-h-8" onClick={onClear}>
            Togli i filtri
          </Button>
        }
      />
    );
  }
  const text = audience === "cliente" && filter.vista === "da-fare" ? "Nessuna domanda da rispondere." : audience === "cliente" && filter.vista === "da-verificare" ? "Nessuna risposta in verifica." : EMPTY_TEXT[filter.vista];
  return <EmptyState title={text} />;
}

function QuestionRow({
  row: r,
  audience,
  vista,
  showMust,
  href,
  open,
  onOpen,
  selecting,
  picked,
  onPick,
}: {
  row: QuestionRowView;
  audience: QuestionAudience;
  vista: QuestionFilter["vista"];
  showMust: boolean;
  href: string;
  open: boolean;
  onOpen: (e: React.MouseEvent<HTMLAnchorElement>, id: string) => void;
  selecting: boolean;
  picked: boolean;
  onPick: (row: QuestionRowView, on: boolean) => void;
}) {
  const client = audience === "cliente";
  // Lo stato non si dice solo con il colore: con «Tutte» la parola c'è sempre.
  const state = r.sublabel ?? (vista === "tutte" ? r.label : null);
  const meta: React.ReactNode[] = [];
  if (state) meta.push(state);
  if (client && r.moduleTitle) meta.push(r.moduleTitle);
  if (client) meta.push(r.assignee ? `Risponde: ${r.assignee}` : "Senza referente");
  if (r.lockReason) meta.push(r.lockReason);
  if (r.due) meta.push(<span className={cn(r.due.overdue && "text-uc-rosso")}>{r.due.text}</span>);
  const who = !client && audience !== "sviluppatore" ? (r.answer ? [r.answer.by, r.answer.when].filter(Boolean).join(" · ") || r.assignee || "Senza referente" : (r.assignee ?? "Senza referente")) : null;
  const whoMissing = who === "Senza referente";
  return (
    <li className={cn(ROW, (picked || open) && "bg-muted/60")} data-state={picked ? "selected" : undefined}>
      {selecting && (
        <label className="relative z-10 -my-1.5 -ml-1.5 flex size-11 shrink-0 cursor-pointer items-center justify-center sm:size-8">
          <input type="checkbox" className={CHECKBOX_CLASS} checked={picked} onChange={(e) => onPick(r, e.target.checked)} aria-label={`Seleziona «${r.title}»`} />
        </label>
      )}
      <a href={href} onClick={(e) => onOpen(e, r.id)} aria-current={open ? "true" : undefined} className={LINK}>
        <span className="mt-1.5 shrink-0">
          <StatusDot tone={r.tone} label={r.label} hideLabel />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 items-start gap-3">
            <span className="line-clamp-2 min-w-0 flex-1 text-sm font-medium break-words">{r.title}</span>
            {r.answer && <span className="hidden max-w-56 shrink-0 truncate text-sm text-muted-foreground md:inline">«{r.answer.excerpt}»</span>}
            {who && <span className={cn("hidden max-w-48 shrink-0 truncate text-right text-sm sm:inline", whoMissing ? "text-uc-giallo" : "text-muted-foreground")}>{who}</span>}
          </span>
          {r.answer && <span className="mt-0.5 block truncate text-sm text-muted-foreground md:hidden">«{r.answer.excerpt}»</span>}
          {r.value && <ValueText value={r.value} className="mt-0.5 line-clamp-2 block text-sm" />}
          {r.checks && <span className={cn("mt-0.5 block text-xs break-words", r.checks.error ? "text-uc-rosso" : "text-foreground")}>{r.checks.text}</span>}
          {(meta.length > 0 || who || (showMust && r.must) || r.personal || r.outOfContract || (!client && !r.assignee && r.roleLabel)) && (
            <span className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-muted-foreground">
              {who && (
                <span className="sm:hidden">
                  <span className={cn(whoMissing && "text-uc-giallo")}>{who}</span>
                  {meta.length > 0 && <span aria-hidden> ·</span>}
                </span>
              )}
              {meta.map((m, i) => (
                <span key={i} className="inline-flex items-center gap-1.5">
                  {i > 0 && <span aria-hidden>·</span>}
                  {m}
                </span>
              ))}
              {!client && !r.assignee && r.roleLabel && (
                <span>
                  {meta.length > 0 && <span aria-hidden>· </span>}
                  {r.roleLabel}
                </span>
              )}
              {showMust && r.must && <Badge>{WORDS.indispensabile}</Badge>}
              {r.outOfContract && <Badge dashed>{WORDS.fuoriContratto}</Badge>}
              {r.personal && (
                <span title={WORDS.datoPersonale} className="inline-flex items-center text-uc-lucchetto">
                  <Lock className="size-3.5" aria-hidden />
                  <span className="sr-only">{WORDS.datoPersonale}</span>
                </span>
              )}
            </span>
          )}
        </span>
        <ChevronRight className="mt-1 size-4 shrink-0 text-muted-foreground" aria-hidden />
      </a>
    </li>
  );
}

function Badge({ dashed = false, children }: { dashed?: boolean; children: React.ReactNode }) {
  return <span className={cn("inline-flex h-5 items-center rounded-4xl border px-2 font-medium whitespace-nowrap text-foreground", dashed && "border-dashed")}>{children}</span>;
}
