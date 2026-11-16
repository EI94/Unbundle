import "server-only";
/**
 * Il giro della notte di «Contesto» (rilascio 9a, docs/contesto/RILASCIO-9a-COSTRUZIONE.md §3.4.10, §8.8): legge gli
 * appunti in attesa nei workspace con l'ok, riscrive «In breve» dove i fatti sono cambiati, cancella il testo degli
 * appunti più vecchi di 12 mesi. Lo chiama il cron `/api/cron/contesto`, dopo il giro di Granola. Restituisce solo
 * conteggi: mai un testo, mai un nome.
 */
import { refreshStaleBriefs } from "./context-brief";
import { readPendingSources } from "./context-read";
import { purgeExpiredNoteText } from "./context-sources";

/** Nell'ordine: `readPendingSources`, `refreshStaleBriefs`, `purgeExpiredNoteText`. Solo conteggi. */
export async function runContextNightly(o: { budgetMs: number; now?: Date }): Promise<{ read: number; failed: number; left: number; briefs: number; purged: number }> {
  const started = Date.now();
  const reads = await readPendingSources({ budgetMs: o.budgetMs, now: o.now });
  const briefs = await refreshStaleBriefs({ budgetMs: Math.max(0, o.budgetMs - (Date.now() - started)) });
  const purged = await purgeExpiredNoteText(o.now);
  return { ...reads, briefs, purged };
}
