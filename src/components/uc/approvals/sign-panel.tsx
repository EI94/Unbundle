"use client";

import { useEffect, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { SideSheet } from "@/components/ui-10/side-sheet";
import { loadApprovalsAction } from "@/lib/actions/uc-approvals";
import type { ApprovalStep } from "@/lib/uc/views/approvals";
import { canOpenShellPage } from "@/lib/uc/views/case-shell";
import type { CaseRole, CaseStatus } from "@/lib/uc/vocab";
import { SIGN_PANEL_PARAM, SIGN_PANEL_TEXT, signPanelState } from "./approval-texts";
import { CaseApprovals } from "./case-approvals";

type Loaded = { approvals: ApprovalStep[] } | "errore" | null;

/**
 * Il pannello delle firme della realizzazione (rilascio 10, §3.5 e §3.18): si apre da `?firma=1` su ogni pagina del
 * guscio, dal pulsante pieno «Firma …» della testata, e `/firme` porta qui (`signaturesPanelHref`). Dentro c'è lo
 * stesso `ApprovalRunner` di prima, con le stesse impronte (`CaseApprovals`): l'elenco, una decisione alla volta,
 * «Ho letto e approvo» o «Non approvo» con il motivo, i dettagli e, per Lateral Space, «Dettagli tecnici». Le firme si
 * leggono all'apertura (`loadApprovalsAction`, gli stessi ruoli e la stessa lettura della pagina di prima); in pausa
 * il pannello lo dice, a realizzazione chiusa o in sola lettura non c'è nulla da firmare. Chi non firma non lo apre.
 * Chiudere toglie il parametro. Va montato una volta, nel guscio (`layout.tsx`).
 */
export function CaseSignaturesPanel({
  workspaceId,
  caseId,
  roles,
  status,
  readOnly,
}: {
  workspaceId: string;
  caseId: string;
  roles: readonly CaseRole[];
  status: CaseStatus;
  readOnly: boolean;
}) {
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const open = searchParams.get(SIGN_PANEL_PARAM) === "1" && canOpenShellPage("firme", roles);
  const state = signPanelState({ status, readOnly });
  const [loaded, setLoaded] = useState<Loaded>(null);
  const [pending, startTransition] = useTransition();

  function load() {
    startTransition(async () => {
      try {
        const r = await loadApprovalsAction(workspaceId, caseId);
        setLoaded(r.ok ? { approvals: r.data } : "errore");
      } catch {
        setLoaded("errore");
      }
    });
  }

  // Le firme si leggono a ogni apertura: una decisione presa altrove non resta nell'elenco.
  useEffect(() => {
    if (open && state === "firma") load();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- solo all'apertura del pannello
  }, [open, state]);

  function close() {
    const next = new URLSearchParams(searchParams.toString());
    next.delete(SIGN_PANEL_PARAM);
    const q = next.toString();
    setLoaded(null);
    router.replace(q ? `${pathname}?${q}` : pathname, { scroll: false });
  }

  let body: React.ReactNode;
  if (state === "pausa") body = <p className="text-sm text-muted-foreground">{SIGN_PANEL_TEXT.paused}</p>;
  else if (state === "nulla") body = <CaseApprovals workspaceId={workspaceId} caseId={caseId} approvals={[]} roles={roles} />;
  else if (loaded === "errore")
    body = (
      <div role="alert" className="space-y-3 text-sm">
        <p>{SIGN_PANEL_TEXT.failed}</p>
        <Button type="button" variant="outline" className="min-h-11 sm:min-h-9" disabled={pending} onClick={load}>
          {SIGN_PANEL_TEXT.retry}
        </Button>
      </div>
    );
  else if (loaded === null)
    body = (
      <p role="status" className="text-sm text-muted-foreground">
        {SIGN_PANEL_TEXT.loading}
      </p>
    );
  else body = <CaseApprovals workspaceId={workspaceId} caseId={caseId} approvals={loaded.approvals} roles={roles} />;

  return (
    <SideSheet open={open} onClose={close} title={SIGN_PANEL_TEXT.title}>
      <div data-slot="sign-panel">{body}</div>
    </SideSheet>
  );
}
