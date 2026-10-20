"use client";

import Link from "next/link";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { FilterPopover } from "@/components/uc/ui/filter-popover";
import { StatusDot } from "@/components/uc/ui/status-dot";
import { PERIMETER_LABEL } from "@/lib/uc/views/labels";
import { PERIMETER_PARAM, RULE_STATUS_GROUPS } from "@/lib/uc/views/model";
import { STATUS_GROUP_LABEL, STATUS_GROUP_SLUG, type Audience } from "@/lib/uc/views/status-groups";
import type { SemaforoColor } from "@/lib/uc/vocab";
import { SolutionSearch, useUrlParams } from "./model-item-list";

/**
 * Soluzione › Regole (DESIGN §3.7.3):
 *
 *   [⌕ Cerca una regola]  [Filtri ▾]   ◯ Mostra anche i vincoli
 *   La conferma: Commerciale · 12 di 40 confermate                     ▾
 *    ● Il margine minimo per richiesta non scende sotto la soglia.     ›
 *
 * Ricerca, filtri e pagine sul server: al client arrivano solo le righe (stato
 * e testo su una riga), mai gli array dei collegamenti. Gruppi per «Chi la
 * conferma», chiusi tranne il primo (aperti tutti con una ricerca o un filtro).
 * Niente badge di area, tipo o priorità, niente chiave, niente «n di N».
 */

export function RulesToolbar({
  q,
  stato,
  perimetro,
  vincoli,
  hasConstraints,
  audience,
}: {
  q: string | null;
  stato: string | null;
  perimetro: string | null;
  vincoli: boolean;
  hasConstraints: boolean;
  audience: Audience;
}) {
  const { pending, set } = useUrlParams();
  const fields = [
    {
      key: "stato",
      label: "Stato",
      placeholder: "Tutti",
      options: RULE_STATUS_GROUPS.map((g) => ({ value: STATUS_GROUP_SLUG[g], label: STATUS_GROUP_LABEL[audience][g] })),
    },
    {
      key: "perimetro",
      label: "Contratto",
      placeholder: "Tutte",
      options: [
        { value: PERIMETER_PARAM.in_contratto, label: PERIMETER_LABEL.in_contratto },
        { value: PERIMETER_PARAM.evoluzione, label: PERIMETER_LABEL.evoluzione },
      ],
    },
  ];
  return (
    <div className="mb-5 flex min-w-0 flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center" aria-busy={pending}>
      <SolutionSearch value={q} label="Cerca una regola" className="sm:max-w-sm sm:flex-1" />
      <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2">
        <FilterPopover fields={fields} values={{ stato, perimetro }} onChange={(key, value) => set({ [key]: value })} onClear={() => set({ stato: null, perimetro: null })} />
        {hasConstraints && (
          <label className="inline-flex min-h-11 cursor-pointer items-center gap-2 text-sm select-none sm:min-h-8">
            <Switch checked={vincoli} onCheckedChange={(on) => set({ vincoli: on ? "1" : null })} />
            Mostra anche i vincoli
          </label>
        )}
      </div>
    </div>
  );
}

export interface RuleListRow {
  id: string;
  title: string;
  status: { tone: SemaforoColor; label: string };
  href: string;
}

export interface RuleListGroup {
  key: string;
  heading: string;
  rows: RuleListRow[];
}

/** I gruppi di regole della pagina: il primo aperto, gli altri chiusi (tutti aperti con ricerca o filtri). */
export function RulesList({ groups, allOpen }: { groups: RuleListGroup[]; allOpen: boolean }) {
  return (
    <div className="min-w-0 space-y-2">
      {groups.map((g, i) => (
        <details key={g.key} open={allOpen || i === 0} className="group/regole min-w-0">
          <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 py-2 text-sm font-medium select-none [&::-webkit-details-marker]:hidden">
            <span className="min-w-0 break-words">{g.heading}</span>
            <ChevronDown className="size-4 shrink-0 text-muted-foreground transition-transform group-open/regole:rotate-180" aria-hidden />
          </summary>
          <ul className="divide-y divide-border border-y border-border">
            {g.rows.map((r) => (
              <li key={r.id}>
                <Link
                  href={r.href}
                  scroll={false}
                  className="flex min-h-11 min-w-0 items-center gap-3 py-2 hover:bg-muted/40 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
                >
                  <StatusDot tone={r.status.tone} label={r.status.label} hideLabel className="shrink-0" />
                  <span className="min-w-0 flex-1 truncate text-sm" title={r.title}>
                    {r.title}
                  </span>
                  <span className="max-w-28 shrink-0 truncate text-xs text-muted-foreground" aria-hidden>
                    {r.status.label}
                  </span>
                  <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                </Link>
              </li>
            ))}
          </ul>
        </details>
      ))}
    </div>
  );
}
