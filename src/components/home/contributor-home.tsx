import Link from "next/link";
import { Plus } from "lucide-react";
import { PageContainer } from "@/components/dashboard/page-container";
import { EmptyState } from "@/components/ui-10/empty-state";
import { Fold } from "@/components/ui-10/fold";
import { Row, RowList } from "@/components/ui-10/row";
import { Button } from "@/components/ui/button";
import { PhasePill } from "@/components/use-cases/phase-pill";
import type { ContributorHomeData } from "@/lib/db/queries/use-case-home";
import { HOME_TEXT } from "@/lib/home/text";
import { CONTRIBUTOR_ROWS_SHOWN, type ContributorRow } from "@/lib/home/view";
import { ParticipationList } from "./participation-list";

/** L'id della piega «Chi propone, per area»: un link a `#chi-propone` la apre. */
export const PARTICIPATION_FOLD_ID = "chi-propone";

function UseCaseRow({ row }: { row: ContributorRow }) {
  return (
    <Row
      href={row.href}
      title={
        <>
          {row.code ? (
            <>
              <span className="text-xs font-normal whitespace-nowrap text-muted-foreground">{row.code}</span>
              <span aria-hidden className="text-muted-foreground">
                {" · "}
              </span>
            </>
          ) : null}
          {row.title}
        </>
      }
      trailing={<PhasePill label={row.phaseLabel} phase={row.phase} subState={row.subState} />}
    />
  );
}

/**
 * La Home dei contributori (rilascio 10, prototipo S1c): H1 «Home»; il pulsante pieno «Proponi un use case»; «I tuoi
 * use case (N)», con codice, titolo e fase, tre in vista e gli altri sotto «Vedi tutti (N)»; la piega chiusa «Chi
 * propone, per area»; la card del corso, se ne segue uno. Senza use case propri, un vuoto con la frase e lo stesso
 * pulsante, così il pieno resta uno. Senza stato: si rende sul server.
 */
export function ContributorHome({ data }: { data: ContributorHomeData }) {
  const t = HOME_TEXT.contributor;
  const shown = data.useCases.slice(0, CONTRIBUTOR_ROWS_SHOWN);
  const rest = data.useCases.slice(CONTRIBUTOR_ROWS_SHOWN);
  const participation = data.participation && data.participation.rows.length > 0 ? data.participation : null;
  return (
    <PageContainer size="narrow">
      <div data-slot="home" data-home="contributore" className="space-y-8">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">{HOME_TEXT.title}</h1>
        {data.description ? <p className="line-clamp-2 text-sm text-muted-foreground">{data.description}</p> : null}
      </header>
      {data.useCases.length ? (
        <>
          <Button render={<Link href={data.proposeHref} />} nativeButton={false} className="min-h-11 w-full sm:min-h-9 sm:w-auto" data-action="next-step">
            <Plus aria-hidden data-icon="inline-start" />
            {t.propose}
          </Button>
          <section aria-labelledby="i-tuoi-use-case" className="space-y-3">
            <h2 id="i-tuoi-use-case" className="text-base font-semibold">
              {t.mine(data.useCases.length)}
            </h2>
            <RowList>
              {shown.map((row) => (
                <li key={row.id}>
                  <UseCaseRow row={row} />
                </li>
              ))}
            </RowList>
            {rest.length ? (
              <details data-slot="show-all" className="group">
                <summary className="inline-flex min-h-11 cursor-pointer list-none items-center rounded-md text-sm font-medium underline decoration-foreground/40 underline-offset-4 outline-none hover:decoration-foreground focus-visible:ring-3 focus-visible:ring-ring/50 sm:min-h-8 [&::-webkit-details-marker]:hidden">
                  {HOME_TEXT.showAll(data.useCases.length)}
                </summary>
                <RowList className="mt-3">
                  {rest.map((row) => (
                    <li key={row.id}>
                      <UseCaseRow row={row} />
                    </li>
                  ))}
                </RowList>
              </details>
            ) : null}
          </section>
        </>
      ) : (
        <EmptyState text={t.empty} action={{ label: t.propose, href: data.proposeHref, icon: Plus, nextStep: true }} />
      )}
      {participation ? (
        <div>
          <Fold id={PARTICIPATION_FOLD_ID} title={t.byArea}>
            <ParticipationList participation={participation} />
          </Fold>
        </div>
      ) : null}
      {data.courses.length ? (
        <RowList label={t.course}>
          {data.courses.map((course) => (
            <li key={course.id}>
              <Row title={course.title} fact={t.course} href={course.href} />
            </li>
          ))}
        </RowList>
      ) : null}
      </div>
    </PageContainer>
  );
}
