/**
 * «Mappatura board»: gli use case nati da questa mappatura, una riga per caso (docs/mappatura/MAPPATURA-BOARD-PIANO.md
 * §1.4, §4.6; P42, P43, P28).
 *
 * Solo quelli che la pagina ha dato alla board (`withUseCaseLinks`, cioè quelli che chi guarda può vedere: le bozze
 * nascoste restano nascoste). Ogni riga è un link alla pagina dello use case, con il bordo sinistro nel colore dello
 * stream che hanno quasi tutti i suoi passi: il codice in mono, il titolo, il punto dello stream, «Apri». Senza use
 * case, «Ancora nessuno.» e il link all'area Use case.
 *
 * Senza stato: va bene anche in una vetrina statica.
 */
import Link from "next/link";
import type { JSX } from "react";
import type { BoardUseCaseLink } from "../../../lib/mappatura/board-model.ts";
import { formatCount, streamLabel } from "../../../lib/mappatura/text.ts";
import { Dot, RowLink, Section } from "../ui/atoms.tsx";
import { CLASSIFICATION_TEXT, caseRowLabel } from "./text.ts";

export function UseCaseRows(p: { cases: readonly BoardUseCaseLink[]; areaHref: string }): JSX.Element {
  const T = CLASSIFICATION_TEXT.cases;
  return (
    <Section title={T.title} hint={formatCount(p.cases.length)}>
      {p.cases.length === 0 ? (
        <p className="b-cls-none" data-b="cases-empty">
          {T.none} <Link href={p.areaHref}>{T.goTo}</Link>
        </p>
      ) : (
        <div className="b-cls-cases" data-b="cases">
          {p.cases.map((item) => (
            <RowLink key={item.id} href={item.href} accent={item.stream} label={caseRowLabel(item.code, item.title)}>
              <span className="b-cid">{item.code ?? ""}</span>
              <span className="b-cn">{item.title}</span>
              <span className="b-cls-stream">
                {item.stream ? (
                  <>
                    <Dot tone={item.stream} />
                    {streamLabel(item.stream)}
                  </>
                ) : null}
              </span>
              <span className="b-cls-open">{T.open}</span>
            </RowLink>
          ))}
        </div>
      )}
    </Section>
  );
}
