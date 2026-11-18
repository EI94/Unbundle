"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { setBellEmailAlertsAction } from "@/lib/actions/notifications";
import { createTeamMcpTokenAction, revokeTeamMcpTokenAction } from "@/lib/actions/team-mcp-tokens";
import { revokeOwnCliTokenAction } from "@/lib/actions/cli-tokens";
import { disconnectGranolaAction, startGranolaConnectAction } from "@/lib/actions/context-granola";
import { ACCOUNT_PARAM, accountApiPath, accountPartOf, accountSectionId, type AccountSheetResponse } from "@/lib/shell/account";
import { SHELL_TEXT } from "@/lib/shell/text";
import { AccountSheetBody, type AccountActions, type AccountSheetState } from "./account-sheet-body";
import { closeAccountSheet } from "./account-url";

const T = SHELL_TEXT.account;

async function readAccount(workspaceId: string): Promise<AccountSheetState> {
  try {
    const response = await fetch(accountApiPath(workspaceId), { cache: "no-store", credentials: "same-origin" });
    const json = (await response.json().catch(() => null)) as AccountSheetResponse | null;
    return json?.ok === true ? { status: "ready", account: json.account } : { status: "error" };
  } catch {
    return { status: "error" };
  }
}

/**
 * Il foglio «Il tuo account» (rilascio 10, ondata 2a, PROPOSTA-10 §2.3, §3.10): si apre con `?account=` (dal menu
 * sotto il nome, o da un link che lo porta, anche su una parte: `?account=claude`), a destra su desktop e a tutto
 * schermo al telefono; «Indietro» e ✕ lo chiudono. Quando si apre legge preferenze e accessi di chi guarda dalla rotta
 * del workspace, e li rilegge dopo ogni sua azione.
 */
export function AccountSheet({
  workspaceId,
  user,
  loadData = true,
}: {
  workspaceId: string;
  user: { name?: string | null; email?: string | null; image?: string | null };
  /** No per chi segue solo un corso: niente da leggere, il foglio ha il solo tema. */
  loadData?: boolean;
}) {
  const params = useSearchParams();
  const part = accountPartOf(params?.get(ACCOUNT_PARAM) ?? null);
  const open = part !== null;
  const [state, setState] = useState<AccountSheetState>(loadData ? { status: "loading" } : { status: "none" });
  const seq = useRef(0);

  const load = useCallback(() => {
    if (!loadData) return;
    const mine = ++seq.current;
    void readAccount(workspaceId).then((next) => {
      // Solo l'ultima lettura: una più vecchia, arrivata dopo, non la sostituisce.
      if (mine === seq.current) setState(next);
    });
  }, [loadData, workspaceId]);

  // A ogni apertura i dati di adesso; chiuso, la prossima apertura ricomincia da «Caricamento…».
  const [wasOpen, setWasOpen] = useState(false);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open && loadData) setState({ status: "loading" });
  }
  useEffect(() => {
    if (open) load();
  }, [open, load]);

  // Aperto su una parte: il fuoco va al suo titolo, quando la parte c'è.
  useEffect(() => {
    if (!open || part === "tutto" || state.status !== "ready") return;
    const section = document.getElementById(accountSectionId(part));
    if (section) {
      section.scrollIntoView({ block: "start" });
      section.focus({ preventScroll: true });
    }
  }, [open, part, state.status]);

  const actions = useMemo<AccountActions>(
    () => ({
      async setEmailAlerts(on) {
        const result = await setBellEmailAlertsAction(workspaceId, on);
        return result.ok ? { ok: true, on: result.payload.emailAlerts.on } : { ok: false, message: result.message };
      },
      createClaudeAccess: (form) => createTeamMcpTokenAction(workspaceId, form),
      async revokeClaudeAccess(tokenId) {
        const form = new FormData();
        form.set("tokenId", tokenId);
        const result = await revokeTeamMcpTokenAction(workspaceId, form);
        return { ok: result.ok, message: result.message ?? "" };
      },
      revokeTerminalLink: (tokenId) => revokeOwnCliTokenAction(workspaceId, tokenId),
      async connectGranola() {
        const result = await startGranolaConnectAction(workspaceId);
        return result.ok ? { ok: true, url: result.value.url } : { ok: false, message: result.message };
      },
      async disconnectGranola() {
        const result = await disconnectGranolaAction(workspaceId);
        return result.ok ? { ok: true, message: "" } : { ok: false, message: result.message };
      },
    }),
    [workspaceId],
  );

  return (
    <Sheet open={open} onOpenChange={(next) => (next ? undefined : closeAccountSheet())}>
      <SheetContent
        side="right"
        showCloseButton={false}
        data-slot="account-sheet"
        className="gap-0 overflow-y-auto data-[side=right]:w-full data-[side=right]:sm:max-w-md"
      >
        <SheetHeader className="flex-row items-center justify-between gap-3 border-b px-4 py-2">
          <div className="min-w-0">
            <SheetTitle className="text-base font-semibold">{T.title}</SheetTitle>
            <SheetDescription className="sr-only">{T.description}</SheetDescription>
          </div>
          <SheetClose render={<Button variant="ghost" size="icon" className="size-11 shrink-0 sm:size-9" aria-label={T.close} />}>
            <X aria-hidden />
          </SheetClose>
        </SheetHeader>
        <AccountSheetBody user={user} state={state} actions={actions} onRetry={load} onChanged={load} />
      </SheetContent>
    </Sheet>
  );
}
