"use client";

import { useId, useState, type ReactNode } from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { EmptyState } from "@/components/ui-10/empty-state";
import { Fold } from "@/components/ui-10/fold";
import { useSheetParam } from "@/components/ui-10/side-sheet";
import { dayLabel } from "@/lib/context/labels";
import { CONTEXT_TEXT } from "@/lib/context/text";
import type { AiConsentNoticeData } from "@/lib/db/queries/context-consent";
import type { MemoryView as MemoryData } from "@/lib/db/queries/context-memory";
import { AiConsentNotice } from "./ai-consent-notice";
import { AskBox } from "./ask-box";
import { FactRow, LiveRowItem } from "./fact-row";
import { FactSheet } from "./fact-sheet";
import { Mark, type UseCaseOption } from "./fields";
import { Commitments, OpenQuestions } from "./next-steps";
import { firstRows, isMemoryEmpty, liveRowHref, noveltyRows, noveltySource, sectionLabel, sectionSummary, sheetIdParam, toCheckRow, visibleSections } from "./view-model";

const T = CONTEXT_TEXT;

/** Il fatto aperto (`?apri=<fatto>`): un id che sembra un uuid; altrimenti il pannello resta chiuso. Una funzione del modulo. */
const acceptFact = (raw: string | null) => sheetIdParam(raw);

export interface MemoryViewProps {
  workspaceId: string;
  /** Oggi a Roma, AAAA-MM-GG: per «14 nov» e per le scadenze. */
  today: string;
  /** Lateral Space: la riga di stato. */
  lateralSpace: boolean;
  /** Scrivere e modificare fatti, chiudere impegni e domande. */
  canEditMemory: boolean;
  memory: MemoryData;
  /** Gli use case del workspace, per collegarli a un fatto (solo Lateral Space). */
  useCaseOptions: readonly UseCaseOption[];
  /** L'avviso dell'ok ai fornitori: c'è solo se manca l'ok e c'è qualcosa da leggere o un «In breve» da scrivere. */
  consentNotice: AiConsentNoticeData | null;
  /** La riga di Granola (`<GranolaInbox compact />`), già resa sul server. */
  granola?: ReactNode;
  /** «Leggo gli appunti…»: gli appunti in attesa, letti uno alla volta (solo Lateral Space, con l'ok). */
  reader?: ReactNode;
  /** `?apri=<fatto>`: il pannello di quel fatto, aperto. */
  initialFact?: string | null;
}

/**
 * La vista «Memoria» (rilascio 9a, docs/contesto/RILASCIO-9a-COSTRUZIONE.md §7.2; rilascio 10, §3.7 e prototipo S6),
 * dall'alto:
 * - «Chiedi al contesto»;
 * - una sola riga di stato (solo Lateral Space, solo quando serve): la lettura degli appunti, oppure l'ok ai fornitori,
 *   oppure i fatti da verificare, oppure Granola. Restano tutte montate (la lettura e il giro di Granola partono da sé):
 *   si vede la prima che ha qualcosa da dire;
 * - «In breve»: tre righe e la data, il resto a richiesta;
 * - «Impegni» e «Novità»: al massimo tre righe ciascuna;
 * - le sezioni chiuse, con quante voci hanno (Azienda · Persone e ruoli · Come lavorano · Sistemi e dati · Obiettivi e
 *   priorità · Regole e vincoli · Parole del cliente · Domande aperte): si apre quella che serve. «Come lavorano» porta
 *   alle board, «Obiettivi» alla pagina degli obiettivi.
 * Il fatto si apre in un pannello con un indirizzo, `?apri=<fatto>`: «Indietro» lo chiude, e il fatto ha un link.
 * Un blocco senza contenuto non si vede.
 */
export function MemoryView({ workspaceId, today, lateralSpace, canEditMemory, memory, useCaseOptions, consentNotice, granola, reader, initialFact = null }: MemoryViewProps) {
  const [openFact, showFact] = useSheetParam({ initial: initialFact, accept: acceptFact });
  const sections = visibleSections(memory.sections);
  const empty = isMemoryEmpty(memory);
  // (9b) «3 fatti da verificare»: i fatti che la notte ha segnato, fermi da più di 6 mesi.
  const toCheck = toCheckRow(memory.counts.toCheck, lateralSpace);
  const novelties = noveltyRows(memory.novelties);

  return (
    <div className="space-y-8">
      <AskBox workspaceId={workspaceId} today={today} lateralSpace={lateralSpace} />

      {lateralSpace ? (
        // Una sola riga di stato: si vede la prima che ha qualcosa da dire, le altre restano montate (§3.7).
        <div data-slot="status-row" className="empty:hidden [&>*:not(:first-child)]:hidden">
          {reader ?? null}
          {consentNotice ? <AiConsentNotice notice={consentNotice} variant="inline" /> : null}
          {toCheck ? <StatusLink label={toCheck} href={`/dashboard/${workspaceId}/contesto/verifica`} /> : null}
          {granola ?? null}
        </div>
      ) : null}

      {empty ? <EmptyState text={lateralSpace ? T.page.emptyBodyLs : T.page.emptyBodyClient} /> : null}

      {memory.brief && memory.brief.lines.length > 0 ? <Brief lines={memory.brief.lines} updated={T.brief.updated(dayLabel(memory.brief.updatedOn, today))} /> : null}

      <Commitments workspaceId={workspaceId} today={today} nostri={memory.nextSteps.nostri} cliente={memory.nextSteps.cliente} canEdit={canEditMemory} />

      {novelties.shown.length > 0 ? (
        <section aria-labelledby="contesto-novita" className="space-y-2">
          <h2 id="contesto-novita" className="text-base font-semibold">
            {T.novelties.title}
          </h2>
          <ul className="divide-y rounded-xl border">
            {novelties.shown.map((item) => (
              <li key={item.factId}>
                <button
                  type="button"
                  onClick={() => showFact(item.factId)}
                  aria-haspopup="dialog"
                  className="flex min-h-11 w-full flex-col gap-1 rounded-lg px-3 py-2.5 text-left text-sm outline-none transition-colors hover:bg-muted/50 focus-visible:ring-3 focus-visible:ring-ring/50 sm:flex-row sm:items-baseline sm:gap-2"
                >
                  <span className="flex min-w-0 items-baseline gap-2">
                    <Mark className="shrink-0">{item.tag === "cambiato" ? T.novelties.tagChanged : T.novelties.tagNew}</Mark>
                    <span className="min-w-0 break-words">{item.statement}</span>
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground sm:ml-auto">{noveltySource(item, memory.sections)}</span>
                </button>
              </li>
            ))}
          </ul>
          {novelties.more > 0 ? <p className="px-3 text-xs text-muted-foreground">{T.novelties.more(novelties.more)}</p> : null}
        </section>
      ) : null}

      {sections.length > 0 || memory.questions.length > 0 ? (
        <div data-slot="memory-sections">
          {sections.map((section) => (
            <Fold key={section.section} id={`contesto-${section.section}`} title={sectionLabel(section.section)} summary={sectionSummary(section)}>
              <ul className="divide-y rounded-xl border">
                {section.live.map((row) => (
                  <LiveRowItem key={row.key} row={row} href={liveRowHref(workspaceId, row)} />
                ))}
                {section.facts.map((fact) => (
                  <FactRow key={fact.id} fact={fact} onOpen={showFact} />
                ))}
              </ul>
              {section.section === "obiettivi" ? (
                <Link href={`/dashboard/${workspaceId}/strategy`} className="inline-flex min-h-11 items-center gap-0.5 rounded-md text-sm font-medium underline decoration-foreground/40 underline-offset-4 outline-none hover:decoration-foreground focus-visible:ring-3 focus-visible:ring-ring/50 sm:min-h-8">
                  {T.page.goals}
                  <ChevronRight aria-hidden className="size-4" />
                </Link>
              ) : null}
            </Fold>
          ))}
          {memory.questions.length > 0 ? (
            <Fold id="contesto-domande" title={T.sections.domande} summary={String(memory.questions.length)}>
              <OpenQuestions workspaceId={workspaceId} questions={memory.questions} canEdit={canEditMemory} />
            </Fold>
          ) : null}
        </div>
      ) : null}

      <FactSheet workspaceId={workspaceId} factId={openFact} today={today} canEdit={canEditMemory} useCaseOptions={useCaseOptions} onClose={() => showFact(null)} onReplaced={(next) => showFact(next)} />
    </div>
  );
}

/** «In breve»: tre righe e la data; le altre con «Mostra tutto». */
function Brief({ lines, updated }: { lines: readonly string[]; updated: string }) {
  const [all, setAll] = useState(false);
  const listId = useId();
  const { shown, rest } = firstRows(lines);
  return (
    <section aria-labelledby="contesto-in-breve" className="space-y-2">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        <h2 id="contesto-in-breve" className="text-base font-semibold">
          {T.brief.title}
        </h2>
        <span className="text-xs text-muted-foreground">{updated}</span>
      </div>
      <ul id={listId} className="space-y-1.5 text-sm leading-relaxed">
        {(all ? lines : shown).map((line, index) => (
          <li key={index}>{line}</li>
        ))}
      </ul>
      {rest > 0 ? (
        <button
          type="button"
          aria-expanded={all}
          aria-controls={listId}
          onClick={() => setAll(!all)}
          className="inline-flex min-h-11 items-center rounded-md text-sm font-medium underline decoration-foreground/40 underline-offset-4 outline-none hover:decoration-foreground focus-visible:ring-3 focus-visible:ring-ring/50 sm:min-h-8"
        >
          {all ? T.page.showLess : T.page.briefMore}
        </button>
      ) : null}
    </section>
  );
}

/** La riga di stato con la sua pagina: «3 fatti da verificare ›». */
function StatusLink({ label, href }: { label: string; href: string }) {
  return (
    <Link
      href={href}
      className="flex min-h-11 items-center justify-between gap-3 rounded-lg border px-3 py-1.5 text-sm outline-none transition-colors hover:bg-muted/40 focus-visible:ring-3 focus-visible:ring-ring/50"
    >
      <span>{label}</span>
      <ChevronRight aria-hidden className="size-4 shrink-0 text-muted-foreground" />
    </Link>
  );
}
