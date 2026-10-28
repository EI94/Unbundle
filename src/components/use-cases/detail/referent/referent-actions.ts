"use client";

/**
 * Il modo unico di mandare un'azione di «Chiedi al referente» dal capitolo «Cosa serve» (SPEC
 * §5.1), come `send` di `section-needs.tsx`: il toast dell'esito, la rilettura della pagina quando
 * qualcuno ha appena cambiato la richiesta o la scheda, l'errore nella finestra quando c'è una
 * finestra aperta. Le action rileggono già la pagina dopo una scrittura (`revalidatePath`); i file,
 * che passano da una rotta e non da un'action, la rileggono con `router.refresh()`.
 */
import { useCallback, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type { ReferentActionResult } from "@/lib/use-cases/referent/contract";
import { REFERENT_ERROR_MESSAGES } from "@/lib/use-cases/referent/labels";
import { referentOutcome, type ReferentOutcome } from "./referent-outcome";

const FAILED: ReferentActionResult<never> = { ok: false, code: "riprova", message: REFERENT_ERROR_MESSAGES.riprova };

/**
 * `run(call, { inDialog })`: manda l'azione dentro una transizione, mostra il toast e rilegge la
 * pagina quando serve. Restituisce il risultato e l'esito, così la finestra decide se chiudersi e
 * dove mostrare gli errori dei campi.
 */
export function useReferentRunner() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const run = useCallback(
    <T>(
      call: () => Promise<ReferentActionResult<T>>,
      opts: {
        inDialog: boolean;
        refreshOnSuccess?: boolean;
        // false: l'esito lo scrive la finestra, niente toast.
        successToast?: boolean;
      },
    ) =>
      new Promise<{ result: ReferentActionResult<T>; outcome: ReferentOutcome }>((resolve) => {
        startTransition(async () => {
          let result: ReferentActionResult<T>;
          try {
            result = await call();
          } catch {
            result = FAILED;
          }
          const outcome = referentOutcome(result, opts);
          if (outcome.toast?.kind === "success") {
            if (opts.successToast !== false) toast.success(outcome.toast.text);
          } else if (outcome.toast) toast.error(outcome.toast.text);
          if (outcome.refresh || (outcome.ok && opts.refreshOnSuccess)) router.refresh();
          resolve({ result, outcome });
        });
      }),
    [router],
  );
  return { pending, run };
}
