"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Fold } from "@/components/ui-10/fold";
import { Checkbox } from "@/components/ui/checkbox";
import { confirmProposalsAction } from "@/lib/actions/context";
import { CONTEXT_TEXT } from "@/lib/context/text";
import type { OpenProposals } from "@/lib/db/queries/context-proposals";
import { confirmHeading, workSourceLabel } from "./confirm-sources";
import { Mark, type UseCaseOption } from "./fields";
import { ProposalRow } from "./proposal-row";
import {
  afterConfirm,
  chunkItems,
  confirmGroups,
  confirmSubtitle,
  notReportedLines,
  NO_CHOICES,
  proposalSource,
  reconfirmations,
  rowErrors,
  selectedItems,
  selectionFrom,
  type ConfirmChoices,
  type Resolution,
} from "./view-model";

const T = CONTEXT_TEXT;

/**
 * «Da confermare» (rilascio 9a, docs/contesto/RILASCIO-9a-COSTRUZIONE.md §7.4; rilascio 10, §3.7): una pagina sua, con
 * un solo pulsante pieno, «Conferma (n)», fisso in fondo. I gruppi nell'ordine: Nuovi, Cambiati, In conflitto, Impegni,
 * Domande; poi un solo blocco di riconferme (chiuso, una casella per fatto) e i passaggi non riportati. «Dedotto» e conflitti non sono mai spuntati da soli; un conflitto
 * entra solo con la scelta della persona. Le proposte arrivano sempre dal server: le scelte della persona restano
 * sopra (una correzione, uno scarto o un aggiornamento non le cancellano).
 * (9b) Con una fonte sola nata dal lavoro la testata dice da dove vengono («Dalle risposte del referente per …», «Da chi
 * costruisce …»), e la fonte di «Ora: …» non la scambia per una call (`confirm-sources.ts`).
 */
export function ConfirmView({
  workspaceId,
  today,
  open: served,
  useCaseOptions,
  filteredBySource,
}: {
  workspaceId: string;
  today: string;
  open: OpenProposals;
  useCaseOptions: readonly UseCaseOption[];
  /** La pagina mostra le proposte di un solo appunto (`?fonte=`). */
  filteredBySource: boolean;
}) {
  const router = useRouter();
  const [choices, setChoices] = useState<ConfirmChoices>(NO_CHOICES);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [discarded, setDiscarded] = useState<ReadonlySet<string>>(() => new Set());
  const [pending, startTransition] = useTransition();
  // Le proposte scartate escono subito, anche dal conto, prima che arrivi la pagina aggiornata.
  const open: OpenProposals = discarded.size === 0 ? served : { ...served, proposals: served.proposals.filter((p) => !discarded.has(p.id)), reconfirmed: served.reconfirmed.filter((p) => !discarded.has(p.id)) };
  const sources = open.sources;
  const selection = selectionFrom(open, choices);
  const items = selectedItems(open, selection);
  const groups = confirmGroups(open.proposals);
  const again = reconfirmations(open);
  const notReported = notReportedLines(sources.map((source) => source.skipped));
  const subtitle = confirmHeading(sources, today, confirmSubtitle(sources, today));
  const memoryHref = `/dashboard/${workspaceId}/contesto`;
  const empty = open.proposals.length === 0 && open.reconfirmed.length === 0;

  const check = (id: string, checked: boolean) => setChoices((c) => ({ ...c, overrides: { ...c.overrides, [id]: checked } }));
  const resolve = (id: string, resolution: Resolution) => setChoices((c) => ({ ...c, resolutions: { ...c.resolutions, [id]: resolution } }));

  const confirm = () => {
    if (items.length === 0) return;
    setErrors({});
    startTransition(async () => {
      let confirmed = 0;
      let remaining = 0;
      for (const chunk of chunkItems(items)) {
        const result = await confirmProposalsAction(workspaceId, chunk);
        if (!result.ok) {
          if (confirmed > 0) toast.success(T.confirm.done(confirmed));
          if (result.error === "versione_superata") {
            toast(T.confirm.stale);
            router.refresh();
          } else {
            setErrors(rowErrors(result.fieldErrors, chunk.map((item) => item.id)));
            toast.error(result.message);
          }
          return;
        }
        confirmed += result.value.confirmed;
        remaining = result.value.remaining;
      }
      toast.success(T.confirm.done(confirmed));
      setChoices(NO_CHOICES);
      const leftHere = open.proposals.length + open.reconfirmed.length - items.length;
      const next = afterConfirm({ leftHere, remaining, filtered: filteredBySource });
      if (next === "memoria") router.push(memoryHref);
      else if (next === "tutte") router.push(`${memoryHref}/conferma`);
      else router.refresh();
    });
  };

  return (
    <div className="space-y-6 pb-2">
      <header className="space-y-2">
        <Link href={memoryHref} className="inline-flex min-h-11 items-center gap-1 text-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 sm:min-h-0">
          <ArrowLeft aria-hidden className="size-4" />
          {T.confirm.back}
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">{T.confirm.title}</h1>
        {subtitle ? <p className="text-sm text-muted-foreground">{subtitle}</p> : null}
      </header>

      {empty ? (
        <div className="space-y-3 py-8 text-center">
          <p className="text-sm text-muted-foreground">{T.confirm.empty}</p>
          <Link href={memoryHref} className="inline-flex min-h-11 items-center text-sm font-medium underline underline-offset-4">
            {T.confirm.backToMemory}
          </Link>
        </div>
      ) : null}

      {groups.map((group) => (
        <section key={group.key} aria-labelledby={`conferma-${group.key}`} className="space-y-2">
          <h2 id={`conferma-${group.key}`} className="text-base font-semibold">
            {group.label}
          </h2>
          <ul className="space-y-2">
            {group.items.map((proposal) => (
              <ProposalRow
                key={`${proposal.id}:${proposal.version}`}
                workspaceId={workspaceId}
                today={today}
                proposal={proposal}
                sourceLabel={workSourceLabel(proposal, sources, today) ?? proposalSource(proposal, sources, today)}
                checked={selection.checked[proposal.id] === true}
                resolution={selection.resolutions[proposal.id] ?? null}
                error={errors[proposal.id] ?? null}
                useCaseOptions={useCaseOptions}
                disabled={pending}
                onCheck={(checked) => check(proposal.id, checked)}
                onResolve={(resolution) => resolve(proposal.id, resolution)}
                onDiscarded={() => setDiscarded((ids) => new Set(ids).add(proposal.id))}
              />
            ))}
          </ul>
        </section>
      ))}

      {again.length > 0 ? (
        // (Rilascio 10, §3.7) Un solo blocco di riconferme, chiuso: una casella per fatto. Le «detto» partono spuntate.
        <Fold id="conferma-riconferme" title={T.confirm.reconfirmedTitle} summary={T.confirm.reconfirmedSummary(again.length)}>
          <ul className="space-y-1">
            {again.map((proposal) => (
              <li key={`${proposal.id}:${proposal.version}`}>
                <label className="flex min-h-11 cursor-pointer items-start gap-3 py-1 text-sm sm:min-h-0">
                  <span className="flex min-w-11 shrink-0 items-start justify-center pt-0.5 sm:min-w-0">
                    <Checkbox
                      checked={selection.checked[proposal.id] === true}
                      disabled={pending}
                      onCheckedChange={(next) => check(proposal.id, next === true)}
                      aria-labelledby={`riconferma-${proposal.id}`}
                    />
                  </span>
                  <span id={`riconferma-${proposal.id}`} className="min-w-0 flex-1 break-words">
                    {proposal.before?.statement ?? proposal.statement}
                    {proposal.basis === "dedotto" ? <Mark className="ml-2">{T.fact.inferred}</Mark> : null}
                  </span>
                </label>
              </li>
            ))}
          </ul>
        </Fold>
      ) : null}

      {notReported.length > 0 ? (
        <ul className="space-y-1 text-xs text-muted-foreground">
          {notReported.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      ) : null}

      {empty ? null : (
        <div className="sticky bottom-0 z-10 -mx-4 border-t bg-background/95 px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur sm:mx-0 sm:rounded-xl sm:border sm:px-3">
          <Button type="button" size="lg" className="min-h-11 w-full sm:w-auto sm:px-6" disabled={pending || items.length === 0} onClick={confirm}>
            {T.confirm.button(items.length)}
          </Button>
        </div>
      )}
    </div>
  );
}
