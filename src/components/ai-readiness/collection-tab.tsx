"use client";

import { useCallback, useState } from "react";
import { UserPlus } from "lucide-react";
import { READINESS_TEXT } from "@/lib/ai-readiness/dashboard-text";
import { INVITE_PANEL, READINESS_ANCHORS } from "@/lib/ai-readiness/dashboard-view";
import type { SemaforoColor } from "@/lib/uc/vocab";
import { StatusDot } from "@/components/uc/ui/status-dot";
import { Row } from "@/components/ui-10/row";
import { SideSheet, useSheetParam } from "@/components/ui-10/side-sheet";
import { Button } from "@/components/ui/button";
import { OpenLinkForm } from "./open-link-form";
import { RespondentInviteForm } from "./respondent-invite-form";
import { ShowAll } from "./show-all";
import { UseCasePromoteButton } from "./use-case-promote-button";

const C = READINESS_TEXT.collection;
const V = READINESS_TEXT.invite;
const INVITE_FORM = "air-invito";
const acceptPanel = (raw: string | null) => (raw === INVITE_PANEL ? INVITE_PANEL : null);

export interface CollectionTabProps {
  workspaceId: string;
  assessmentId: string;
  /** Chi gestisce la rilevazione: il link per tutti, gli inviti, le persone, «Aggiungi agli use case». */
  manages: boolean;
  status: string;
  /** Il pannello aperto all'arrivo (`?apri=invita`). */
  initialPanel: string | null;
  link: { active: boolean; scopeIds: readonly string[] | null; version: string | null };
  everyoneSections: ReadonlyArray<{ id: string; title: string; area: string }>;
  sections: ReadonlyArray<{ id: string; title: string; audience?: "everyone" | "internal"; area: string }>;
  useCaseBlocks: ReadonlyArray<{ id: string; title: string; subtitle: string }>;
  people: ReadonlyArray<{ id: string; title: string; fact: string; status: { label: string; tone: SemaforoColor } }>;
  proposals: ReadonlyArray<{ id: string; title: string; fact: string | null; linkedUseCaseId: string | null }>;
  /** Dove si apre uno use case del workspace, senza l'id. */
  useCaseBase: string;
}

/**
 * «Raccolta» (rilascio 10, ondata 7b, §3.9; audit «Fuori» AD-10, AD-11, §8.4): il link per tutti, «Invita una persona»
 * in un pannello (`?apri=invita`), «Persone (N)» e «Use case proposti (N)» con «Mostra tutti»: nessuna riga tagliata,
 * dal nono use case in poi si aggiunge agli use case come i primi. Chi non gestisce la rilevazione vede solo gli use
 * case proposti, senza azioni. Lo zero non si vede: una lista vuota non c'è.
 */
export function CollectionTab(p: CollectionTabProps) {
  const [panel, setPanel] = useSheetParam({ initial: p.initialPanel, accept: acceptPanel });
  const [inviting, setInviting] = useState(false);
  const onPending = useCallback((pending: boolean) => setInviting(pending), []);

  return (
    <div className="space-y-8" data-slot="readiness-collection">
      {p.manages ? (
        <OpenLinkForm workspaceId={p.workspaceId} assessmentId={p.assessmentId} active={p.link.active} status={p.status} sections={p.everyoneSections} scopeIds={p.link.scopeIds} linkVersion={p.link.version} />
      ) : null}

      {p.manages ? (
        <div>
          <Button type="button" variant="outline" className="min-h-11 sm:min-h-9" aria-haspopup="dialog" onClick={() => setPanel(INVITE_PANEL)} data-testid="invite-respondents-cta">
            <UserPlus aria-hidden data-icon="inline-start" />
            {C.invite}
          </Button>
        </div>
      ) : null}

      {p.manages && p.people.length ? (
        <section id={READINESS_ANCHORS.people} aria-labelledby="persone-titolo" className="scroll-mt-20 space-y-2">
          <h2 id="persone-titolo" className="text-base font-semibold">
            {C.people(p.people.length)}
          </h2>
          <div className="divide-y overflow-hidden rounded-xl border bg-card">
            <ShowAll items={p.people} visible={3} inList>
              {(person) => (
                <Row key={person.id} data-row="persona" title={person.title} fact={person.fact} trailing={<StatusDot tone={person.status.tone} label={person.status.label} />} />
              )}
            </ShowAll>
          </div>
        </section>
      ) : null}

      {p.proposals.length ? (
        <section id={READINESS_ANCHORS.proposals} aria-labelledby="proposti-titolo" className="scroll-mt-20 space-y-2">
          <h2 id="proposti-titolo" className="text-base font-semibold">
            {C.proposals(p.proposals.length)}
          </h2>
          <div className="divide-y overflow-hidden rounded-xl border bg-card">
            <ShowAll items={p.proposals} visible={3} inList>
              {(item) => (
                <div key={item.id} data-row="use-case-proposto" className="flex min-h-11 flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-2 text-sm sm:min-h-12">
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="font-medium break-words">{item.title}</span>
                    {item.fact ? <span className="text-muted-foreground">{item.fact}</span> : null}
                  </span>
                  {p.manages ? (
                    <UseCasePromoteButton workspaceId={p.workspaceId} assessmentId={p.assessmentId} submissionId={item.id} linkedUseCaseId={item.linkedUseCaseId} useCaseBase={p.useCaseBase} />
                  ) : (
                    <StatusDot tone={item.linkedUseCaseId ? "verde" : "grigio"} label={item.linkedUseCaseId ? C.linked : C.toReview} />
                  )}
                </div>
              )}
            </ShowAll>
          </div>
        </section>
      ) : null}

      {p.manages ? (
        <SideSheet
          open={panel === INVITE_PANEL}
          onClose={() => setPanel(null)}
          title={V.title}
          footer={
            <Button type="submit" form={INVITE_FORM} className="min-h-11 sm:min-h-9" disabled={inviting}>
              {inviting ? V.pending : V.submit}
            </Button>
          }
        >
          <RespondentInviteForm formId={INVITE_FORM} workspaceId={p.workspaceId} assessmentId={p.assessmentId} sections={p.sections} useCaseBlocks={p.useCaseBlocks} onPendingChange={onPending} />
        </SideSheet>
      ) : null}
    </div>
  );
}
