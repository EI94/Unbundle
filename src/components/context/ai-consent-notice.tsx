"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { declareSubprocessorsAction } from "@/lib/actions/uc-subprocessors";
import { CONTEXT_TEXT } from "@/lib/context/text";
import type { AiConsentNoticeData } from "@/lib/db/queries/context-consent";
import { subprocessorsWaitingLine } from "@/lib/uc/legal/subprocessors";
import { cn } from "@/lib/utils";

/**
 * L'avviso dell'ok ai fornitori di AI (rilascio 9a, docs/contesto/RILASCIO-9a-COSTRUZIONE.md §6.3): calmo, con
 * un'azione sola. Colori neutri, nessuna icona di pericolo, nessuna finestra che si apre da sola.
 *
 * - Lateral Space con il ruolo giusto: una frase, «Registra l'ok di {cliente}» (un pulsante non pieno: quello pieno è
 *   della pagina) e «Che cosa registro», che apre il testo e i nomi dei fornitori.
 * - Il cliente con il ruolo giusto: una frase e «Vedi e autorizza», verso Impostazioni, dove ci sono l'elenco e la
 *   casella dei poteri.
 * - Gli altri: chi può dare l'ok, senza azione.
 * Chi può darlo, la versione dell'elenco e la conferma si ricontrollano sul server (`declareSubprocessors`).
 */
export function AiConsentNotice({ notice, variant = "card", onGranted }: { notice: AiConsentNoticeData; variant?: "card" | "inline"; onGranted?: () => void }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [failed, setFailed] = useState<string | null>(null);

  const grant = () => {
    setFailed(null);
    startTransition(async () => {
      try {
        const result = await declareSubprocessorsAction(notice.workspaceId, notice.listVersion, true);
        if (!result.ok) {
          setFailed(result.message || CONTEXT_TEXT.consent.failed);
          return;
        }
        toast.success(CONTEXT_TEXT.consent.granted);
        onGranted?.();
        router.refresh();
      } catch {
        setFailed(CONTEXT_TEXT.consent.failed);
      }
    });
  };

  return (
    <section
      aria-label={CONTEXT_TEXT.consent.title}
      data-testid="ai-consent-notice"
      data-declarer={notice.declarer ?? "nessuno"}
      className={cn("text-sm", variant === "card" ? "rounded-xl border bg-muted/30 p-4" : "rounded-lg border px-3 py-2.5")}
    >
      <p className="font-medium">{CONTEXT_TEXT.consent.title}</p>
      {notice.declarer === "lateral_space" ? (
        <>
          <p className="mt-1 text-muted-foreground">{CONTEXT_TEXT.consent.bodyLs(notice.companyName)}</p>
          <div className="mt-3">
            <Button type="button" variant="outline" size="lg" className="min-h-11 px-4" disabled={pending} onClick={grant}>
              {notice.buttonLabel}
            </Button>
          </div>
          <details className="mt-3 text-muted-foreground">
            <summary className="flex min-h-11 cursor-pointer items-center underline underline-offset-4">{CONTEXT_TEXT.consent.whatIRegister}</summary>
            <p className="mt-1 max-w-3xl leading-relaxed">{notice.statement}</p>
            <ul className="mt-2 list-disc pl-5">
              {notice.suppliers.map((name) => (
                <li key={name}>{name}</li>
              ))}
            </ul>
          </details>
        </>
      ) : notice.declarer === "cliente" ? (
        <>
          <p className="mt-1 text-muted-foreground">{CONTEXT_TEXT.consent.bodyClient}</p>
          <Link href={notice.settingsHref} className="mt-1 inline-flex min-h-11 items-center underline underline-offset-4">
            {CONTEXT_TEXT.consent.seeAndAuthorize}
          </Link>
        </>
      ) : (
        <p className="mt-1 text-muted-foreground">{subprocessorsWaitingLine(notice.companyName)}</p>
      )}
      {failed ? (
        <p role="alert" className="mt-2 text-muted-foreground">
          {failed}
        </p>
      ) : null}
    </section>
  );
}
