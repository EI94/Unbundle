import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { DetailSheet } from "@/components/uc/ui/detail-sheet";
import { EmptyState } from "@/components/uc/ui/empty-state";
import type { SolutionRulesData } from "@/lib/db/queries/uc-solution";
import { readableTitle } from "@/lib/uc/views/description";
import { KIND_LABEL } from "@/lib/uc/views/labels";
import { PERIMETER_PARAM, pageOffset, rulesFiltered, type RulesQuery } from "@/lib/uc/views/model";
import { clientPlainText } from "@/lib/uc/views/rows";
import { RULES_TEXT, RULE_PARAM, rulesPanelHref } from "@/lib/uc/views/solution";
import { STATUS_GROUP_SLUG, statusView, type Audience } from "@/lib/uc/views/status-groups";
import type { CaseRole } from "@/lib/uc/vocab";
import { ListPagination, RuleDetail } from "./model-sections";
import { RulesList, RulesToolbar } from "./rules-browser";

type SearchParams = Readonly<Record<string, string | string[] | undefined>>;

/**
 * (Rilascio 10, §3.5, F-090) Il pannello «Regole» della Soluzione (`?apri=regole`), dove è finita la pagina
 * `/soluzione/regole`: la ricerca, i filtri «Stato» e «Contratto», i gruppi per chi conferma (solo il nome del ruolo,
 * pulito per il cliente), le righe su due righe di testo, le pagine da 50 («1–50 di 245», come in Domande) e, dentro lo
 * stesso pannello, la regola aperta (`regola=<id>`) con «‹ Tutte le regole». «Mostra anche i vincoli» e «lo schema di
 * partenza» solo per Lateral Space. Cercare e filtrare tiene il pannello aperto (si azzerano la pagina e la regola).
 */
export function RulesPanel({
  workspaceId,
  caseId,
  base,
  sp,
  query,
  data,
  audience,
  roles,
}: {
  workspaceId: string;
  caseId: string;
  /** L'indirizzo della Soluzione. */
  base: string;
  sp: SearchParams;
  query: RulesQuery;
  data: SolutionRulesData;
  audience: Audience;
  roles: readonly CaseRole[];
}) {
  const ls = audience === "ls";
  const plain = (t: string) => (ls ? t : clientPlainText(t) || t);
  const href = (patch: Readonly<Record<string, string | null>>) => rulesPanelHref(base, sp, patch);
  if (data.open) {
    return (
      <DetailSheet title={readableTitle(data.open.title, audience, KIND_LABEL[data.open.kind].one)} status={statusView(data.open.status, audience)} closeHref={base}>
        <Link href={href({ [RULE_PARAM]: null })} scroll={false} className="inline-flex min-h-11 items-center gap-0.5 text-sm text-muted-foreground hover:text-foreground sm:min-h-0">
          <ChevronLeft className="size-4" aria-hidden />
          {RULES_TEXT.back}
        </Link>
        <RuleDetail workspaceId={workspaceId} caseId={caseId} rule={data.open} roles={roles} />
      </DetailSheet>
    );
  }
  const filtered = rulesFiltered(query);
  const groups = data.groups.map((g) => ({
    key: g.roleKey ?? "nessuno",
    heading: plain(g.label),
    rows: g.rows.map((r) => {
      const sv = statusView(r.status, audience);
      return { id: r.id, title: r.title, status: { tone: sv.tone, label: sv.label }, href: href({ [RULE_PARAM]: r.id }) };
    }),
  }));
  const first = pageOffset(data.page) + 1;
  const shown = groups.reduce((n, g) => n + g.rows.length, 0);
  const at = (p: number) => href({ pagina: p <= 1 ? null : String(p), [RULE_PARAM]: null });
  return (
    <DetailSheet title={RULES_TEXT.title} description={data.total > 0 ? RULES_TEXT.count(data.total) : undefined} closeHref={base} size="xl">
      {!data.hasRules && !(ls && data.hasConstraints) ? (
        <EmptyState title={RULES_TEXT.none(audience)} />
      ) : (
        <div className="min-w-0">
          <RulesToolbar
            q={query.q}
            stato={query.stato ? STATUS_GROUP_SLUG[query.stato] : null}
            perimetro={query.perimetro ? PERIMETER_PARAM[query.perimetro] : null}
            vincoli={query.vincoli}
            hasConstraints={ls && data.hasConstraints}
            audience={audience}
            inPanel
          />
          {data.total === 0 ? (
            <EmptyState
              title={filtered ? (query.q ? RULES_TEXT.noMatch(query.q) : RULES_TEXT.noFilterMatch) : RULES_TEXT.none(audience)}
              action={
                filtered ? (
                  <Link href={rulesPanelHref(base, {}, { vincoli: query.vincoli ? "1" : null })} scroll={false} className="inline-flex min-h-11 items-center text-sm font-medium underline-offset-4 hover:underline sm:min-h-8">
                    {RULES_TEXT.clear}
                  </Link>
                ) : undefined
              }
            />
          ) : groups.length === 0 ? (
            <EmptyState
              title={RULES_TEXT.emptyPage}
              action={
                <Link href={at(1)} scroll={false} className="inline-flex min-h-11 items-center text-sm font-medium underline-offset-4 hover:underline sm:min-h-8">
                  {RULES_TEXT.firstPage}
                </Link>
              }
            />
          ) : (
            <>
              <RulesList groups={groups} allOpen={filtered} />
              <ListPagination
                page={data.page}
                pages={data.pages}
                prevHref={data.page > 1 ? at(Math.min(data.page - 1, data.pages)) : null}
                nextHref={data.page < data.pages ? at(data.page + 1) : null}
                range={{ first, last: Math.min(first + Math.max(shown, 1) - 1, data.total), total: data.total }}
              />
            </>
          )}
        </div>
      )}
    </DetailSheet>
  );
}
