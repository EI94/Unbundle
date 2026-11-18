"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { dayLabel } from "@/lib/context/labels";
import { CONTEXT_TEXT } from "@/lib/context/text";
import type { AiConsentNoticeData } from "@/lib/db/queries/context-consent";
import type { MemoryView as MemoryData } from "@/lib/db/queries/context-memory";
import { AiConsentNotice } from "./ai-consent-notice";
import { AddNotesButton } from "./context-page";
import { FactRow, LiveRowItem } from "./fact-row";
import { FactSheet } from "./fact-sheet";
import { Mark, type UseCaseOption } from "./fields";
import { NextSteps, OpenQuestions } from "./next-steps";
import { isMemoryEmpty, sectionLabel, toCheckRow, visibleSections } from "./view-model";

const T = CONTEXT_TEXT;

export interface MemoryViewProps {
  workspaceId: string;
  /** Oggi a Roma, AAAA-MM-GG: per «14 nov» e per le scadenze. */
  today: string;
  /** Lateral Space: le righe di servizio. */
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
}

/**
 * La vista «Memoria» (rilascio 9a, docs/contesto/RILASCIO-9a-COSTRUZIONE.md §7.2), dall'alto: le righe di servizio
 * (solo Lateral Space, solo quando servono: le proposte da confermare, (9b) i fatti da verificare, la lettura, l'ok,
 * Granola), «In breve», «Novità per te», «Prossimi passi», le sette sezioni (prima i dati della Discovery, poi i fatti
 * dal più recente), «Domande aperte». Un blocco senza contenuto non si vede.
 */
export function MemoryView({ workspaceId, today, lateralSpace, canEditMemory, memory, useCaseOptions, consentNotice, granola, reader }: MemoryViewProps) {
  const [openFact, setOpenFact] = useState<string | null>(null);
  const sections = visibleSections(memory.sections);
  const empty = isMemoryEmpty(memory);
  // (9b) «3 fatti da verificare»: i fatti che la notte ha segnato, fermi da più di 6 mesi.
  const toCheck = toCheckRow(memory.counts.toCheck, lateralSpace);

  return (
    <div className="space-y-8">
      {lateralSpace ? (
        <ServiceRows>
          {/* (Rilascio 10, §3.7) Le proposte da confermare sono il pulsante pieno della testata: qui non si ripetono. */}
          {toCheck ? <ServiceLink label={toCheck} href={`/dashboard/${workspaceId}/contesto/verifica`} /> : null}
          {reader ?? null}
          {consentNotice ? <AiConsentNotice notice={consentNotice} variant="inline" /> : null}
          {granola ?? null}
        </ServiceRows>
      ) : null}

      {empty ? (
        <section className="mx-auto max-w-md space-y-3 py-10 text-center">
          <h2 className="text-lg font-medium">{T.page.emptyTitle}</h2>
          <p className="text-sm leading-relaxed text-muted-foreground">{lateralSpace ? T.page.emptyBodyLs : T.page.emptyBodyClient}</p>
          {lateralSpace ? <AddNotesButton className="w-full sm:w-auto" /> : null}
        </section>
      ) : null}

      {memory.brief ? (
        <section aria-labelledby="contesto-in-breve" className="space-y-2 rounded-xl border bg-muted/30 p-4">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3">
            <h2 id="contesto-in-breve" className="text-base font-semibold">
              {T.brief.title}
            </h2>
            <span className="text-xs text-muted-foreground">{T.brief.updated(dayLabel(memory.brief.updatedOn, today))}</span>
          </div>
          <ul className="space-y-1.5 text-sm leading-relaxed">
            {memory.brief.lines.map((line, index) => (
              <li key={index}>{line}</li>
            ))}
          </ul>
        </section>
      ) : null}

      {memory.novelties && memory.novelties.items.length > 0 ? (
        <section aria-labelledby="contesto-novita" className="space-y-2">
          <h2 id="contesto-novita" className="text-base font-semibold">
            {T.novelties.title}
          </h2>
          <ul className="space-y-0.5">
            {memory.novelties.items.map((item) => (
              <li key={item.factId}>
                <button
                  type="button"
                  onClick={() => setOpenFact(item.factId)}
                  className="flex min-h-11 w-full items-baseline gap-2 rounded-lg px-3 py-2 text-left text-sm outline-none hover:bg-muted/50 focus-visible:ring-3 focus-visible:ring-ring/50"
                >
                  <Mark className="shrink-0">{item.tag === "cambiato" ? T.novelties.tagChanged : T.novelties.tagNew}</Mark>
                  <span className="min-w-0 break-words">{item.statement}</span>
                  <span className="ml-auto hidden shrink-0 text-xs text-muted-foreground sm:inline">{sectionLabel(item.section)}</span>
                </button>
              </li>
            ))}
          </ul>
          {memory.novelties.more > 0 ? <p className="px-3 text-xs text-muted-foreground">{T.novelties.more(memory.novelties.more)}</p> : null}
        </section>
      ) : null}

      <NextSteps workspaceId={workspaceId} today={today} nostri={memory.nextSteps.nostri} cliente={memory.nextSteps.cliente} canEdit={canEditMemory} />

      {sections.map((section) => (
        <section key={section.section} aria-labelledby={`contesto-sezione-${section.section}`} className="space-y-2">
          <h2 id={`contesto-sezione-${section.section}`} className="text-base font-semibold">
            {sectionLabel(section.section)}
          </h2>
          <ul className="divide-y rounded-xl border">
            {section.live.map((row) => (
              <LiveRowItem key={row.key} row={row} />
            ))}
            {section.facts.map((fact) => (
              <FactRow key={fact.id} fact={fact} onOpen={setOpenFact} />
            ))}
          </ul>
        </section>
      ))}

      <OpenQuestions workspaceId={workspaceId} questions={memory.questions} canEdit={canEditMemory} />

      <FactSheet workspaceId={workspaceId} factId={openFact} today={today} canEdit={canEditMemory} useCaseOptions={useCaseOptions} onClose={() => setOpenFact(null)} />
    </div>
  );
}

/** Le righe di servizio: una riga l'una, solo quelle che servono. Senza nessuna, niente. */
function ServiceRows({ children }: { children: ReactNode }) {
  return <div className="space-y-2 empty:hidden">{children}</div>;
}

/** Una riga di servizio con la sua pagina: «12 proposte da confermare», «3 fatti da verificare», e «Apri». */
function ServiceLink({ label, href }: { label: string; href: string }) {
  return (
    <div className="flex min-h-11 items-center justify-between gap-3 rounded-lg border px-3 py-1.5 text-sm">
      <span>{label}</span>
      <Link href={href} className="inline-flex min-h-11 items-center gap-0.5 rounded-md px-1 font-medium outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50 sm:min-h-8">
        {T.page.open}
        <ChevronRight aria-hidden className="size-4" />
      </Link>
    </div>
  );
}
