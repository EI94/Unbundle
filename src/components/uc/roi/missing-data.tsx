import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { itemPath } from "@/components/uc/catalog/paths";
import { StatusDot } from "@/components/uc/ui/status-dot";
import { formatCountIt } from "@/lib/uc/views/format";
import { canOpenItem } from "@/lib/uc/views/page-access";
import type { MissingView } from "@/lib/uc/views/roi";
import { statusView, type Audience } from "@/lib/uc/views/status-groups";
import type { CaseRole } from "@/lib/uc/vocab";

const LINK = "-mx-2 flex min-h-11 min-w-0 items-center gap-2 rounded-md px-2 py-1.5 hover:bg-muted/60 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none sm:min-h-9";

function Group({ title, count, children }: { title: string; count?: number; children: React.ReactNode }) {
  return (
    <section className="min-w-0 space-y-1">
      <h3 className="text-xs text-muted-foreground">
        {title}
        {count ? ` · ${formatCountIt(count)}` : ""}
      </h3>
      {children}
    </section>
  );
}

/**
 * Contenuto del pannello «Dati che mancano» (DESIGN §3.8): le domande che
 * servono al conto e non sono a posto, con il titolo che porta alla domanda
 * (solo il numero per chi non apre Domande: AI Board e Osservatore, §2.3);
 * le righe del conto a cui manca il tipo o il valore, che portano al loro
 * pannello; quello che lo schema di partenza dice che serve.
 */
export function MissingData({
  missing,
  workspaceId,
  caseId,
  roles,
  audience,
  panelHref,
  questionsHref,
}: {
  missing: MissingView;
  workspaceId: string;
  caseId: string;
  roles: readonly CaseRole[];
  audience: Audience;
  panelHref: (id: string) => string;
  questionsHref: string | null;
}) {
  const more = missing.questionTotal - missing.questions.length;
  return (
    <>
      {missing.questions.length > 0 && (
        <Group title="Domande da completare" count={missing.questionTotal}>
          <ul>
            {missing.questions.map((q) => {
              const s = statusView(q.status, audience);
              const body = (
                <>
                  <span className="min-w-0 flex-1 text-sm break-words">{q.title}</span>
                  <StatusDot tone={s.tone} label={s.label} className="shrink-0" />
                </>
              );
              return (
                <li key={q.id}>
                  {canOpenItem(roles, q.status) ? (
                    <Link href={itemPath(workspaceId, caseId, q.id)} className={LINK}>
                      {body}
                    </Link>
                  ) : (
                    <div className="flex min-h-9 min-w-0 items-center gap-2 py-1.5">{body}</div>
                  )}
                </li>
              );
            })}
          </ul>
          {more > 0 && <p className="text-sm text-muted-foreground">E altre {formatCountIt(more)}.</p>}
        </Group>
      )}
      {missing.questions.length === 0 && missing.questionTotal > 0 && (
        <Group title="Domande da completare" count={missing.questionTotal}>
          <p className="text-sm text-muted-foreground">Le sta raccogliendo Lateral Space con le persone del cliente.</p>
        </Group>
      )}
      {missing.lines.length > 0 && (
        <Group title="Righe del conto da completare" count={missing.lines.length}>
          <ul>
            {missing.lines.map((l, i) => (
              <li key={`${l.id ?? l.label}-${i}`}>
                {l.id ? (
                  <Link href={panelHref(l.id)} scroll={false} className={LINK}>
                    <span className="min-w-0 flex-1 text-sm break-words">{l.label}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">{l.reason}</span>
                    <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                  </Link>
                ) : (
                  <p className="py-1.5 text-sm">{l.label}</p>
                )}
              </li>
            ))}
          </ul>
        </Group>
      )}
      {missing.needs.length > 0 && (
        <Group title="Serve anche">
          <ul className="list-disc space-y-1 pl-5 text-sm">
            {missing.needs.map((n) => (
              <li key={n} className="break-words">
                {n}
              </li>
            ))}
          </ul>
        </Group>
      )}
      {questionsHref && missing.questions.length > 0 && (
        <Link href={questionsHref} className="inline-flex min-h-11 items-center gap-0.5 text-sm text-muted-foreground hover:text-foreground sm:min-h-0">
          Apri Domande
          <ChevronRight className="size-3.5" aria-hidden />
        </Link>
      )}
    </>
  );
}
