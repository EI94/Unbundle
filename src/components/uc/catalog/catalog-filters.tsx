"use client";

import { useEffect, useRef, useState } from "react";
import { Search, X } from "lucide-react";
import { SegmentedNav } from "@/components/dashboard/segmented-nav";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { FilterPopover, type FilterField } from "@/components/uc/ui/filter-popover";
import { STATUS_LABEL } from "@/lib/uc/semaforo";
import {
  NONE,
  followUrlSearch,
  questionQuery,
  searchSent,
  withoutQuestionFilters,
  type QuestionAudience,
  type QuestionDefaults,
  type QuestionFilter,
  type SearchBoxSync,
} from "@/lib/uc/views/catalog-filter";
import { formatCountIt } from "@/lib/uc/views/format";
import { KIND_LABEL, KIND_ORDER, PRIVACY_LABEL, WORDS } from "@/lib/uc/views/labels";
import type { QuestionSegmentItem } from "@/lib/uc/views/rows";
import { ITEM_STATUSES, PRIVACY_CLASSES } from "@/lib/uc/vocab";

/** Classe delle `select` native che restano (moduli dei pannelli): la usano anche altre sezioni del caso. */
export const SELECT_CLASS =
  "h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30 [&>option]:bg-popover [&>option]:text-popover-foreground";

// ── Domande (DESIGN §3.6.2, §3.6.8) ───────────────────────────────────

/** Le opzioni del pannello «Filtri» di Domande. */
export interface QuestionFilterOptions {
  contacts: { id: string; name: string }[];
  modules: { key: string; title: string }[];
  roles: { key: string; label: string }[];
  /** Ci sono domande «Fuori contratto» (o il filtro è già attivo): solo allora «Contratto». */
  contract: boolean;
  /** Voci di ogni tipo, per «Tutto il catalogo (2.812)»: solo Lateral Space. */
  catalogSize: number | null;
  /** Per tipo, con il catalogo intero. */
  kindCounts: Record<string, number> | null;
}

export interface QuestionToolbarProps {
  basePath: string;
  audience: QuestionAudience;
  filter: QuestionFilter;
  defaults: QuestionDefaults;
  segments: QuestionSegmentItem[];
  documentsHref: string;
  options: QuestionFilterOptions;
  /** Navigazione dentro la transizione della lista: intanto la lista si attenua. */
  navigate: (href: string, opts?: { replace?: boolean }) => void;
  selection: { available: boolean; active: boolean; onToggle: () => void };
}

const SEARCH_DELAY_MS = 300;

/**
 * Barra degli strumenti di Domande (§3.6.2): segmenti, ricerca dal vivo,
 * «Filtri», l'interruttore delle indispensabili e «Seleziona». Sotto, i filtri
 * attivi con la ✕. Tutto vive nell'URL: si condivide e si ricarica uguale.
 */
export function QuestionToolbar({ basePath, audience, filter, defaults, segments, documentsHref, options, navigate, selection }: QuestionToolbarProps) {
  const urlQ = filter.q ?? "";
  const [q, setQ] = useState(urlQ);
  // L'URL cambia anche senza la casella («Togli i filtri», indietro): allora la casella lo segue.
  const [sync, setSync] = useState<SearchBoxSync>({ urlQ, sent: [] });
  if (sync.urlQ !== urlQ) {
    const next = followUrlSearch(sync, urlQ);
    setSync(next.sync);
    if (next.box !== null) setQ(next.box);
  }
  const typed = q.trim();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const href = (patch: Partial<QuestionFilter>) => `${basePath}${questionQuery({ ...filter, q: typed || null }, defaults, patch)}`;
  /** Ogni navigazione della barra porta il testo scritto e ferma la ricerca in attesa: un clic subito dopo un tasto non si perde. */
  const stopSearch = (sent: string) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    if (sent !== urlQ) setSync((s) => searchSent(s, sent));
  };
  const go = (patch: Partial<QuestionFilter>, opts?: { replace?: boolean }) => {
    stopSearch("q" in patch ? (patch.q ?? "") : typed);
    navigate(href(patch), opts);
  };
  useEffect(() => {
    if (typed === urlQ) return;
    const t = setTimeout(() => go({ q: typed || null }, { replace: true }), SEARCH_DELAY_MS);
    timer.current = t;
    return () => clearTimeout(t);
    // `go` cambia a ogni disegno; i filtri cambiati dalla barra fermano il timer (`stopSearch`): conta il testo rispetto all'URL.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [typed, urlQ]);

  const ls = audience === "ls";
  const dev = audience === "sviluppatore";
  const fields: FilterField[] = [];
  const contactName = new Map(options.contacts.map((c) => [c.id, c.name]));
  if (!dev) {
    // Il cliente sceglie solo «Senza referente»: mai un collega (art. 15.4).
    fields.push({ key: "referente", label: "Referente", placeholder: "Tutti", options: [{ value: NONE, label: "Senza referente" }, ...(ls ? options.contacts.map((c) => ({ value: c.id, label: c.name })) : [])] });
  }
  if (options.modules.length > 0) fields.push({ key: "argomento", label: "Argomento", placeholder: "Tutti", options: options.modules.map((m) => ({ value: m.key, label: m.title })) });
  if (!dev && options.roles.length > 0) fields.push({ key: "ruolo", label: WORDS.chiRisponde, placeholder: "Tutti", options: options.roles.map((r) => ({ value: r.key, label: r.label })) });
  if (ls) {
    fields.push({ key: "stato", label: "Stato dettagliato", placeholder: "Tutti", options: ITEM_STATUSES.map((s) => ({ value: s, label: STATUS_LABEL[s] })) });
    fields.push({ key: "riservatezza", label: "Riservatezza", placeholder: "Tutte", options: PRIVACY_CLASSES.map((p) => ({ value: p, label: PRIVACY_LABEL[p] })) });
  }
  if (!dev && (options.contract || filter.perimetro)) {
    fields.push({
      key: "perimetro",
      label: "Contratto",
      placeholder: "Tutte",
      options: [
        { value: "nel", label: WORDS.nelContratto },
        { value: "fuori", label: WORDS.fuoriContratto },
      ],
    });
  }
  if (ls) {
    const size = options.catalogSize;
    fields.push({ key: "mostra", label: "Mostra", placeholder: "Domande", options: [{ value: "catalogo", label: size !== null ? `Tutto il catalogo (${formatCountIt(size)})` : "Tutto il catalogo" }] });
    if (filter.catalogo) {
      const counts = options.kindCounts ?? {};
      fields.push({
        key: "tipo",
        label: "Tipo",
        placeholder: "Tutti i tipi",
        options: KIND_ORDER.filter((k) => (counts[k] ?? 0) > 0 || filter.tipo === k).map((k) => ({ value: k, label: `${KIND_LABEL[k].many} (${formatCountIt(counts[k] ?? 0)})` })),
      });
    }
  }
  const values: Record<string, string | null> = {
    referente: filter.referente,
    argomento: filter.argomento,
    ruolo: filter.ruolo,
    stato: filter.stato,
    riservatezza: filter.riservatezza,
    perimetro: filter.perimetro,
    mostra: filter.catalogo ? "catalogo" : null,
    tipo: filter.tipo,
  };
  const change = (key: string, value: string | null) => {
    if (key === "mostra") return go({ catalogo: value === "catalogo", tipo: null });
    go({ [key]: value } as Partial<QuestionFilter>);
  };

  // Filtri attivi, ognuno con la sua ✕ (solo quando ce ne sono).
  const chips: { key: string; text: string; patch: Partial<QuestionFilter> }[] = [];
  if (filter.referente) chips.push({ key: "referente", text: `Referente: ${filter.referente === NONE ? "senza referente" : (contactName.get(filter.referente) ?? "Referente")}`, patch: { referente: null } });
  if (filter.argomento) chips.push({ key: "argomento", text: `Argomento: ${options.modules.find((m) => m.key === filter.argomento)?.title ?? filter.argomento}`, patch: { argomento: null } });
  if (filter.ruolo) chips.push({ key: "ruolo", text: `${WORDS.chiRisponde}: ${options.roles.find((r) => r.key === filter.ruolo)?.label ?? filter.ruolo}`, patch: { ruolo: null } });
  if (filter.stato) chips.push({ key: "stato", text: `Stato: ${STATUS_LABEL[filter.stato]}`, patch: { stato: null } });
  if (filter.riservatezza) chips.push({ key: "riservatezza", text: `Riservatezza: ${PRIVACY_LABEL[filter.riservatezza]}`, patch: { riservatezza: null } });
  if (filter.perimetro) chips.push({ key: "perimetro", text: filter.perimetro === "fuori" ? WORDS.fuoriContratto : WORDS.nelContratto, patch: { perimetro: null } });
  if (filter.catalogo) chips.push({ key: "catalogo", text: filter.tipo ? `Mostra: ${KIND_LABEL[filter.tipo].many}` : "Mostra: tutto il catalogo", patch: { catalogo: false, tipo: null } });

  const switchOn = audience === "cliente" ? !filter.soloIndispensabili : filter.soloIndispensabili;
  const switchLabel = audience === "cliente" ? "Mostra anche le facoltative" : "Solo indispensabili";

  return (
    <div className="min-w-0 space-y-3">
      {segments.length > 0 && (
        // I segmenti sono link: il clic ferma la ricerca in attesa, e il link porta già il testo scritto.
        <div onClickCapture={() => stopSearch(typed)} className="min-w-0">
          <SegmentedNav
            ariaLabel="Domande per stato"
            active={filter.vista}
            items={segments.map((s) => ({ key: s.key, label: s.label, count: s.count, href: s.key === "documenti" ? documentsHref : href({ vista: s.key }) }))}
          />
        </div>
      )}
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <label className="relative min-w-0 flex-1 basis-56">
          <span className="sr-only">Cerca una domanda</span>
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cerca una domanda" className="min-h-11 pl-8 sm:min-h-8" maxLength={100} />
        </label>
        {fields.length > 0 && <FilterPopover fields={fields} values={values} onChange={change} onClear={() => go({ ...withoutQuestionFilters(filter), q: typed || null })} />}
        {!dev && (
          <label className="flex min-h-11 cursor-pointer items-center gap-2 px-1 text-sm sm:min-h-8">
            <Switch checked={switchOn} onCheckedChange={(on) => go({ soloIndispensabili: audience === "cliente" ? !on : on })} />
            {switchLabel}
          </label>
        )}
        {selection.available && (
          <Button type="button" variant="outline" className="min-h-11 sm:min-h-8" aria-pressed={selection.active} onClick={selection.onToggle}>
            {selection.active ? "Fine" : "Seleziona"}
          </Button>
        )}
      </div>
      {chips.length > 0 && (
        <ul className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-sm" aria-label="Filtri attivi">
          {chips.map((c) => (
            <li key={c.key} className="inline-flex min-w-0 items-center gap-1">
              <span className="min-w-0 truncate">{c.text}</span>
              <button
                type="button"
                onClick={() => go(c.patch)}
                className="inline-flex size-11 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none sm:size-6"
              >
                <X className="size-3.5" aria-hidden />
                <span className="sr-only">Togli il filtro {c.text}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
