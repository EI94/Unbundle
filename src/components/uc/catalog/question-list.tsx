"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { ChevronLeft, ChevronRight, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui-10/empty-state";
import { TextAction } from "@/components/ui-10/row";
import { StatusDot } from "@/components/uc/ui/status-dot";
import { selectCatalogItemsAction } from "@/lib/actions/uc-catalog-selection";
import { cn } from "@/lib/utils";
import { QUESTIONS_PAGE_SIZE, hasActiveQuestionFilter, questionQuery, withoutQuestionFilters, type QuestionAudience, type QuestionDefaults, type QuestionFilter } from "@/lib/uc/views/catalog-filter";
import { DOMANDE_TEXT } from "@/lib/uc/views/domande-text";
import { formatCountIt } from "@/lib/uc/views/format";
import { WORDS } from "@/lib/uc/views/labels";
import type { QuestionFilterField } from "@/lib/uc/views/question-bar";
import type { ContactOption, QuestionGroupView, QuestionRowView, QuestionSegmentItem, QuestionTopicGroup } from "@/lib/uc/views/rows";
import { QuestionSelectionBar, type BulkPermissions, type BulkSelection } from "./bulk-actions";
import { QuestionToolbar } from "./catalog-filters";
import { CHECKBOX_CLASS } from "./checkbox";
import {
  WAITING_GROUP,
  emptySelection,
  groupNeedsRead,
  groupPicked,
  rowPicked,
  selectAll,
  selectionFor,
  selectionOf,
  toggleGroup,
  toggleRow,
  type SelectionPart,
  type SelectionState,
} from "./question-selection";
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
  fields: QuestionFilterField[];
  /** Argomenti chiusi (nessun filtro, nessuna ricerca): si vedono i gruppi, non le righe. */
  collapsed: boolean;
  topics: QuestionTopicGroup[];
  /** Il gruppo «In attesa» in cima a «Da fare» (0: non c'è). */
  waiting: number;
  rows: QuestionRowView[];
  groups: QuestionGroupView[];
  /** Domande della vista aperta, in tutte le pagine. */
  total: number;
  /** I file dell'archivio, per «File (6)». */
  files: number;
  permissions: BulkPermissions;
  contacts: ContactOption[];
  /** «Verifica una alla volta», solo se il pulsante pieno della testata non ci porta già. */
  reviewHref: string | null;
  /** La domanda aperta nel pannello (`?apri=`), evidenziata nella lista. */
  openId: string | null;
}

/** Una riga: alta almeno 44 px al telefono, la stessa classe per tutte. */
const ROW = "group/row relative flex min-h-11 min-w-0 items-start gap-3 px-3 py-2.5 transition-colors hover:bg-muted/50 sm:min-h-12 sm:px-4";
const LINK = "flex min-w-0 flex-1 items-start gap-3 rounded-sm outline-none after:absolute after:inset-0 focus-visible:after:ring-3 focus-visible:after:ring-ring/50";
const FRAME = "divide-y overflow-hidden rounded-xl bg-card ring-1 ring-foreground/10";

/** La lettura di «Seleziona tutte (N)», tra quelle in corso. */
const ALL_KEY = "__tutte";

/**
 * Domande (rilascio 10, §3.5): i segmenti e la barra, poi gli argomenti chiusi con il solo conteggio (il gruppo «In
 * attesa» in cima a «Da fare»); un filtro, una ricerca o un argomento aperto mostrano le righe, 50 per pagina,
 * raggruppate per argomento. Ogni riga dice il titolo e una cosa in grigio. Il clic apre il pannello (`?apri=<id>`)
 * e chiuderlo lascia filtri e pagina; con Cmd o Ctrl si apre la pagina intera, che riporta qui con «‹ Domande».
 * «Seleziona» sceglie righe, oppure argomenti interi quando sono chiusi.
 */
export function QuestionList(props: QuestionListProps) {
  const { basePath, audience, filter, defaults, rows, groups, total } = props;
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const navigate = (href: string) => startTransition(() => router.push(href, { scroll: false }));
  const listQuery = questionQuery(filter, defaults, { pagina: filter.pagina });
  const selectable = props.permissions.any;

  // La selezione vale per la vista in cui è nata: cambiando filtri o pagina si svuota da sé. Ogni passaggio si applica
  // allo stato di adesso (`setSel((prev) => …)`): una lettura che arriva dopo un'altra non cancella quello che ha aggiunto.
  const viewKey = listQuery;
  const [selecting, setSelecting] = useState(false);
  const [sel, setSel] = useState<SelectionState>(() => emptySelection(viewKey));
  const current = selectionFor(sel, viewKey);
  const update = (next: (state: SelectionState) => SelectionState) => setSel((prev) => next(selectionFor(prev, viewKey)));
  const clear = () => setSel(emptySelection(viewKey));
  const [loading, setLoading] = useState<ReadonlySet<string>>(() => new Set());
  const busy = (key: string, on: boolean) =>
    setLoading((prev) => {
      const next = new Set(prev);
      if (on) next.add(key);
      else next.delete(key);
      return next;
    });

  /** Le domande di una vista (la pagina con un argomento, «In attesa» o tutta la vista), lette sul server. */
  async function readSelection(patch: Partial<QuestionFilter>): Promise<SelectionPart | null> {
    try {
      const r = await selectCatalogItemsAction(props.workspaceId, props.caseId, { kind: "domande", query: questionQuery(filter, defaults, patch, { explicit: true }) });
      if (!r.ok) {
        toast.error(r.message);
        return null;
      }
      return { byStatus: r.data.byStatus, count: r.data.total, truncated: r.data.truncated };
    } catch {
      toast.error(DOMANDE_TEXT.bar.selectFailed);
      return null;
    }
  }
  async function pickGroup(key: string, patch: Partial<QuestionFilter>, on: boolean) {
    let part: SelectionPart | null = null;
    if (groupNeedsRead(current, key, on)) {
      busy(key, true);
      part = await readSelection(patch);
      busy(key, false);
      if (!part) return;
    }
    update((state) => toggleGroup(state, key, on, part));
  }
  async function pickAll() {
    busy(ALL_KEY, true);
    const part = await readSelection({});
    busy(ALL_KEY, false);
    if (part) update((state) => selectAll(state, part));
  }
  const selection: BulkSelection = selectionOf(current);

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
      // La pagina intera porta con sé i filtri e la pagina della lista: «‹ Domande» ci torna.
      href={`${basePath}/${r.id}${listQuery}`}
      open={props.openId === r.id}
      onOpen={openPanel}
      selecting={selectable && selecting}
      picked={rowPicked(current, r.id)}
      onPick={(row, on) => update((state) => toggleRow(state, row, on, rows))}
    />
  );

  const waitingHref = `${basePath}${questionQuery(filter, defaults, { vista: "bloccate" })}`;
  const topicPatch = (key: string): Partial<QuestionFilter> => ({ argomento: key });
  const pages = Math.max(1, Math.ceil(total / QUESTIONS_PAGE_SIZE));
  const first = total === 0 ? 0 : (filter.pagina - 1) * QUESTIONS_PAGE_SIZE + 1;
  const last = Math.min(filter.pagina * QUESTIONS_PAGE_SIZE, total);
  const clearHref = `${basePath}${questionQuery({ ...withoutQuestionFilters(filter), q: null }, defaults)}`;
  const nothing = props.collapsed ? props.topics.length === 0 && props.waiting === 0 : rows.length === 0 && props.waiting === 0;

  return (
    // Al telefono la riga «N selezionate» della barra va da sola, i pulsanti sotto (la barra è di `ui/selection-bar`).
    <div className="min-w-0 space-y-4 max-sm:[&_[data-slot=selection-bar]>p]:basis-full">
      <QuestionToolbar
        basePath={basePath}
        filter={filter}
        defaults={defaults}
        segments={props.segments}
        fields={props.fields}
        files={{ href: `${basePath}${questionQuery(filter, defaults, { pagina: filter.pagina }, { extra: { apri: "file" } })}`, count: props.files }}
        selection={{
          available: selectable,
          active: selecting,
          onToggle: () => {
            if (selecting) clear();
            setSelecting(!selecting);
          },
        }}
      />

      {props.reviewHref && <TextAction href={props.reviewHref}>{DOMANDE_TEXT.bar.review}</TextAction>}
      {selectable && selecting && props.collapsed && <p className="text-sm text-muted-foreground">{DOMANDE_TEXT.bar.selectTopics}</p>}

      <div aria-busy={pending} className={cn("min-w-0 space-y-6 transition-opacity", pending && "opacity-60")}>
        {nothing ? (
          <ListEmpty filter={filter} audience={audience} clearHref={clearHref} />
        ) : (
          <>
            {props.waiting > 0 && (
              <ul className={FRAME} aria-label={DOMANDE_TEXT.waiting}>
                <GroupRow
                  title={DOMANDE_TEXT.waiting}
                  fact={DOMANDE_TEXT.waitingFact}
                  count={props.waiting}
                  href={waitingHref}
                  selecting={selectable && selecting}
                  // «Seleziona tutte (N)» vale per «Da fare», che non comprende le bloccate: «In attesa» si sceglie a parte.
                  picked={groupPicked(current, WAITING_GROUP)}
                  busy={loading.has(WAITING_GROUP)}
                  onPick={(on) => void pickGroup(WAITING_GROUP, { vista: "bloccate" }, on)}
                />
              </ul>
            )}
            {filter.vista === "bloccate" && rows.length > 0 && (
              <h2 className="text-base font-semibold">
                {DOMANDE_TEXT.waiting} <span className="font-normal text-muted-foreground tabular-nums">· {formatCountIt(total)}</span>
              </h2>
            )}
            {props.collapsed ? (
              props.topics.length > 0 && (
                <ul className={FRAME} aria-label={DOMANDE_TEXT.topics}>
                  {props.topics.map((t) => (
                    <GroupRow
                      key={t.key}
                      title={t.title}
                      fact={t.role}
                      count={t.count}
                      href={`${basePath}${questionQuery(filter, defaults, topicPatch(t.key))}`}
                      selecting={selectable && selecting}
                      picked={groupPicked(current, t.key)}
                      busy={loading.has(t.key)}
                      onPick={(on) => void pickGroup(t.key, topicPatch(t.key), on)}
                    />
                  ))}
                </ul>
              )
            ) : (
              groups.map((g) => (
                <section key={g.key || "senza"} aria-label={g.title} className="min-w-0 space-y-2">
                  <h2 className="flex min-w-0 flex-wrap items-baseline gap-x-2 text-base font-semibold">
                    <span className="min-w-0 break-words">{g.title}</span>
                    {g.role && <span className="min-w-0 text-sm font-normal text-muted-foreground">{g.role}</span>}
                    {g.count > 0 && <span className="text-sm font-normal text-muted-foreground tabular-nums">· {formatCountIt(g.count)}</span>}
                  </h2>
                  <ul className={FRAME}>{g.rowIds.map((id) => renderRow(byId.get(id)!))}</ul>
                </section>
              ))
            )}
          </>
        )}
      </div>

      {!props.collapsed && pages > 1 && (
        <nav aria-label={DOMANDE_TEXT.pages.label} className="flex min-w-0 flex-wrap items-center justify-between gap-2 text-sm">
          <span className="text-muted-foreground tabular-nums">{DOMANDE_TEXT.pages.range(first, last, total)}</span>
          <span className="flex gap-1">
            {filter.pagina > 1 && (
              <Button variant="ghost" className="min-h-11 sm:min-h-8" onClick={() => navigate(`${basePath}${questionQuery(filter, defaults, { pagina: filter.pagina - 1 })}`)}>
                <ChevronLeft aria-hidden />
                {DOMANDE_TEXT.pages.previous}
              </Button>
            )}
            {filter.pagina < pages && (
              <Button variant="ghost" className="min-h-11 sm:min-h-8" onClick={() => navigate(`${basePath}${questionQuery(filter, defaults, { pagina: filter.pagina + 1 })}`)}>
                {DOMANDE_TEXT.pages.next}
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
          total={loading.has(ALL_KEY) ? selection.count : total}
          permissions={props.permissions}
          contacts={props.contacts}
          onCancel={clear}
          onSelectAll={() => void pickAll()}
          onDone={clear}
        />
      )}
    </div>
  );
}

function ListEmpty({ filter, audience, clearHref }: { filter: QuestionFilter; audience: QuestionAudience; clearHref: string }) {
  const t = DOMANDE_TEXT.empty;
  if (filter.q) return <EmptyState text={t.search(filter.q)} action={{ label: t.clear, href: clearHref }} />;
  if (hasActiveQuestionFilter(filter)) return <EmptyState text={t.filters} action={{ label: t.clear, href: clearHref }} />;
  return <EmptyState text={(audience === "ls" ? t.ls : t.cliente)[filter.vista]} />;
}

/** Un argomento chiuso, o il gruppo «In attesa»: il titolo, una cosa in grigio, il conteggio e la freccia. */
function GroupRow({
  title,
  fact,
  count,
  href,
  selecting,
  picked,
  busy,
  onPick,
}: {
  title: string;
  fact: string | null;
  count: number;
  href: string;
  selecting: boolean;
  picked: boolean;
  busy: boolean;
  onPick: (on: boolean) => void;
}) {
  return (
    <li className={cn(ROW, "items-center", picked && "bg-muted/60")} data-slot="question-group">
      {selecting && (
        <label className="relative z-10 -my-1.5 -ml-1.5 flex size-11 shrink-0 cursor-pointer items-center justify-center sm:size-8">
          <input type="checkbox" className={CHECKBOX_CLASS} checked={picked} disabled={busy} onChange={(e) => onPick(e.target.checked)} aria-label={DOMANDE_TEXT.row.selectTopic(title)} />
        </label>
      )}
      <Link href={href} className={cn(LINK, "items-center")}>
        <span className="flex min-w-0 flex-1 flex-col gap-0.5 sm:flex-row sm:items-baseline sm:justify-between sm:gap-6">
          <span className="min-w-0 text-sm font-medium break-words">{title}</span>
          {fact && <span className="min-w-0 text-sm text-muted-foreground sm:text-right">{fact}</span>}
        </span>
        <span className="shrink-0 text-sm text-muted-foreground tabular-nums">{formatCountIt(count)}</span>
        <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
      </Link>
    </li>
  );
}

function QuestionRow({
  row: r,
  href,
  open,
  onOpen,
  selecting,
  picked,
  onPick,
}: {
  row: QuestionRowView;
  href: string;
  open: boolean;
  onOpen: (e: React.MouseEvent<HTMLAnchorElement>, id: string) => void;
  selecting: boolean;
  picked: boolean;
  onPick: (row: QuestionRowView, on: boolean) => void;
}) {
  return (
    <li className={cn(ROW, (picked || open) && "bg-muted/60")} data-state={picked ? "selected" : undefined} data-slot="question-row">
      {selecting && (
        <label className="relative z-10 -my-1.5 -ml-1.5 flex size-11 shrink-0 cursor-pointer items-center justify-center sm:size-8">
          <input type="checkbox" className={CHECKBOX_CLASS} checked={picked} onChange={(e) => onPick(r, e.target.checked)} aria-label={DOMANDE_TEXT.row.select(r.title)} />
        </label>
      )}
      <a href={href} onClick={(e) => onOpen(e, r.id)} aria-current={open ? "true" : undefined} className={LINK}>
        <span className="mt-1.5 shrink-0">
          <StatusDot tone={r.tone} label={r.label} hideLabel />
        </span>
        <span className="min-w-0 flex-1">
          <span className="line-clamp-2 block text-sm font-medium break-words">{r.title}</span>
          {r.value ? (
            <ValueText value={r.value} className="mt-0.5 line-clamp-2 block text-sm" />
          ) : (
            <span className="mt-0.5 block truncate text-sm text-muted-foreground">
              <span className={cn(r.missing && "text-uc-giallo")}>{r.line}</span>
              {r.overdue && (
                <>
                  <span aria-hidden> · </span>
                  <span className="text-uc-rosso">{r.overdue}</span>
                </>
              )}
            </span>
          )}
        </span>
        {r.personal && (
          <span title={WORDS.datoPersonale} className="mt-1 shrink-0 text-uc-lucchetto">
            <Lock className="size-3.5" aria-hidden />
            <span className="sr-only">{WORDS.datoPersonale}</span>
          </span>
        )}
        <ChevronRight className="mt-1 size-4 shrink-0 text-muted-foreground" aria-hidden />
      </a>
    </li>
  );
}
