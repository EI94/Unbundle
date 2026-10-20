"use client";

import { useState } from "react";
import { ChevronRight, KeyRound, ShieldCheck, UserMinus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useUcAction } from "@/components/uc/catalog/use-uc-action";
import { DetailSheetFrame } from "@/components/uc/ui/detail-sheet";
import { proposePersonalZoneAccessAction, revokePersonalZoneAccessAction, signPersonalZoneAccessAction } from "@/lib/actions/uc-cases";
import { personalZoneActions, type ZoneMemberRow, type ZoneViewer } from "@/lib/uc/views/privacy";
import type { PersonalZoneMemberState } from "@/lib/uc/views/people";

const STATE_TEXT: Readonly<Record<PersonalZoneMemberState, string>> = {
  attiva: "Ha accesso",
  in_attesa: "Accesso proposto, aspetta la firma dell'approvatore privacy",
  no: "",
};

/**
 * Persone di Lateral Space e accesso alla zona dei dati personali (DESIGN
 * §3.10, PIANO §3.3, §6.6): l'accesso lo propone il responsabile Lateral Space
 * (mai per sé) e lo attiva la firma dell'approvatore privacy; la revoca è
 * immediata e senza firma. Il server ricontrolla tutto.
 */
export function PersonalZonePanel({ workspaceId, caseId, members, viewer }: { workspaceId: string; caseId: string; members: readonly ZoneMemberRow[]; viewer: ZoneViewer }) {
  const { pending, run } = useUcAction();
  return (
    <ul className="divide-y">
      {members.map((m) => {
        const a = personalZoneActions(m, viewer);
        return (
          <li key={m.userId} className="flex min-w-0 flex-wrap items-center justify-between gap-2 py-3 text-sm">
            <div className="min-w-0">
              <p className="font-medium break-words">{m.name}</p>
              <p className="text-xs text-muted-foreground">{m.state === "no" ? (m.inA8List ? "Indicato nella scheda privacy, senza accesso" : "Non indicato nella scheda privacy") : STATE_TEXT[m.state]}</p>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {a.propose && (
                <Button
                  size="sm"
                  variant="outline"
                  className="min-h-11 sm:min-h-8"
                  disabled={pending}
                  onClick={() => run(() => proposePersonalZoneAccessAction(workspaceId, caseId, { userId: m.userId }), { success: "Accesso proposto: ora serve la firma dell'approvatore privacy." })}
                >
                  <KeyRound aria-hidden />
                  Proponi l&apos;accesso
                </Button>
              )}
              {a.sign && (
                <Button
                  size="sm"
                  variant="outline"
                  className="min-h-11 sm:min-h-8"
                  disabled={pending}
                  onClick={() => run(() => signPersonalZoneAccessAction(workspaceId, caseId, { userId: m.userId }), { success: "Firma registrata." })}
                >
                  <ShieldCheck aria-hidden />
                  Firma
                </Button>
              )}
              {a.revoke && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="min-h-11 sm:min-h-8"
                  disabled={pending}
                  onClick={() => {
                    if (!window.confirm(a.self ? "Togliere il tuo accesso ai dati personali?" : `Togliere a ${m.name} l'accesso ai dati personali?`)) return;
                    run(() => revokePersonalZoneAccessAction(workspaceId, caseId, { userId: m.userId }), { success: "Accesso tolto." });
                  }}
                >
                  <UserMinus aria-hidden />
                  Togli
                </Button>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * «Gestisci ›» della riga «Zona dei dati personali»: apre il pannello con le
 * persone di Lateral Space, «Proponi l'accesso», «Firma» e «Togli». Compare
 * solo a chi ha qualcosa da fare.
 */
export function PersonalZoneSheet({
  workspaceId,
  caseId,
  zoneText,
  members,
  viewer,
}: {
  workspaceId: string;
  caseId: string;
  zoneText: string;
  members: readonly ZoneMemberRow[];
  viewer: ZoneViewer;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="ghost" size="sm" className="min-h-11 gap-0.5 px-2 text-muted-foreground hover:text-foreground sm:min-h-8" onClick={() => setOpen(true)}>
        Gestisci
        <ChevronRight className="size-3.5" aria-hidden />
      </Button>
      <DetailSheetFrame
        open={open}
        onOpenChange={setOpen}
        title="Zona dei dati personali"
        description={`${zoneText}. L'accesso lo propone il responsabile Lateral Space e lo attiva la firma dell'approvatore privacy.`.replace(/\.\./g, ".")}
      >
        <PersonalZonePanel workspaceId={workspaceId} caseId={caseId} members={members} viewer={viewer} />
      </DetailSheetFrame>
    </>
  );
}
