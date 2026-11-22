"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { disconnectGranolaAction, startGranolaConnectAction } from "@/lib/actions/context-granola";
import { splitQuestion } from "@/lib/confirm-text";
import { type GranolaCardState, type Line } from "@/lib/context/granola/view";
import { CONTEXT_TEXT } from "@/lib/context/text";
import type { GranolaRulesView } from "@/lib/db/queries/context-granola";
import { GranolaRulesFields } from "./granola-rules";

const T = CONTEXT_TEXT.granola;
/** «Scollega» chiede nella finestra dell'app: la domanda del testo di sempre come titolo, il resto sotto. */
const DISCONNECT_ASK = splitQuestion(T.disconnectConfirm);
const LINE_TONE: Record<Line["tone"], string> = { ok: "text-uc-verde", info: "text-muted-foreground", error: "text-destructive" };

/**
 * Il corpo del blocco «Granola» in Impostazioni (componente client di `GranolaCard`): collegare e scollegare, e le
 * regole di questo workspace. I controlli veri stanno sul server (azioni di src/lib/actions/context-granola.ts).
 */
export function GranolaCardPanel({
  workspaceId,
  workspaceName,
  state,
  accountEmail,
  plan,
  rules,
  flash,
}: {
  workspaceId: string;
  workspaceName: string;
  state: GranolaCardState;
  accountEmail: string | null;
  plan: string | null;
  rules: GranolaRulesView | null;
  flash: Line | null;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [askingDisconnect, setAskingDisconnect] = useState(false);

  const connect = () =>
    start(async () => {
      const result = await startGranolaConnectAction(workspaceId);
      if (!result.ok) {
        toast.error(result.message);
        return;
      }
      window.location.assign(result.value.url);
    });

  const disconnect = () => {
    setAskingDisconnect(false);
    start(async () => {
      const result = await disconnectGranolaAction(workspaceId);
      if (!result.ok) {
        toast.error(result.message);
        return;
      }
      toast.success(T.disconnected);
      router.refresh();
    });
  };

  return (
    <div className="space-y-4 text-sm">
      {flash && (
        <p role={flash.tone === "error" ? "alert" : "status"} className={LINE_TONE[flash.tone]}>
          {flash.text}
        </p>
      )}
      {state === "non_disponibile" && <p className="text-muted-foreground">{T.unavailable}</p>}
      {state === "non_collegato" && (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="max-w-xl leading-relaxed text-muted-foreground">{T.readOnly}</p>
          <Button variant="outline" className="h-11 shrink-0 sm:h-8" disabled={pending} onClick={connect}>
            {T.connect}
          </Button>
        </div>
      )}
      {state === "da_ricollegare" && (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p>{T.expired}</p>
          <Button variant="outline" className="h-11 shrink-0 sm:h-8" disabled={pending} onClick={connect}>
            {T.reconnect}
          </Button>
        </div>
      )}
      {state === "collegato" && (
        <>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0 space-y-0.5">
              {accountEmail && <p className="truncate font-medium">{T.connectedAs(accountEmail)}</p>}
              {plan && <p className="text-xs text-muted-foreground">{T.plan(plan)}</p>}
              <p className="max-w-xl pt-1 text-xs leading-relaxed text-muted-foreground">{T.readOnly}</p>
            </div>
            <Button variant="ghost" className="h-11 shrink-0 sm:h-8" disabled={pending} onClick={() => setAskingDisconnect(true)}>
              {T.disconnect}
            </Button>
          </div>
          {rules && <GranolaRulesForm workspaceId={workspaceId} workspaceName={workspaceName} rules={rules} />}
          <ConfirmDialog
            open={askingDisconnect}
            onOpenChange={setAskingDisconnect}
            title={DISCONNECT_ASK.title}
            description={DISCONNECT_ASK.description}
            confirmLabel={T.disconnect}
            destructive
            onConfirm={disconnect}
          />
        </>
      )}
    </div>
  );
}

/** «Quali call sono di {cliente}» in Impostazioni: il titolo e le regole (`GranolaRulesFields`). */
function GranolaRulesForm({ workspaceId, workspaceName, rules }: { workspaceId: string; workspaceName: string; rules: GranolaRulesView }) {
  // `id`: l'ancora `GRANOLA_RULES_ANCHOR` (src/lib/context/granola/view.ts), dove porta «Regole delle call ›» del foglio
  // «Il tuo account».
  return (
    <div id="granola-regole" className="scroll-mt-28 space-y-5 border-t pt-4">
      <h3 className="text-sm font-semibold">{T.rulesTitle(workspaceName)}</h3>
      <GranolaRulesFields workspaceId={workspaceId} rules={rules} />
    </div>
  );
}
