"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { retryDossierTransition } from "@/components/uc/shell/transition-retry";
import type { UcActionResult } from "@/lib/actions/uc-action-context";

/**
 * Esegue una server action dei casi d'uso e dice com'è andata (toast in
 * italiano). Dopo un comando riuscito l'azione invalida da sé la pagina del caso
 * (`revalidatePath` del layout), quindi qui non serve ricaricare; il guscio del
 * dossier conclude l'aggiornamento anche quando React lo lascerebbe sospeso
 * (`retryDossierTransition`).
 */
export function useUcAction() {
  const [pending, startTransition] = useTransition();
  function run<T>(action: () => Promise<UcActionResult<T>>, opts: { success?: string; onSuccess?: (data: T) => void; onError?: (message: string) => void } = {}) {
    startTransition(async () => {
      try {
        const result = await action();
        retryDossierTransition();
        if (result.ok) {
          toast.success(result.message ?? opts.success ?? "Fatto.");
          opts.onSuccess?.(result.data);
        } else {
          toast.error(result.message);
          opts.onError?.(result.message);
        }
      } catch {
        const message = "Operazione non riuscita. Riprova tra poco.";
        toast.error(message);
        opts.onError?.(message);
      }
    });
  }
  return { pending, run };
}
