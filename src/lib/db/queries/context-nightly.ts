import "server-only";
/**
 * Il giro della notte di «Contesto» (rilascio 9a, docs/contesto/RILASCIO-9a-COSTRUZIONE.md §3.4.10, §8.8): legge gli
 * appunti in attesa nei workspace con l'ok, riscrive «In breve» dove i fatti sono cambiati, cancella il testo degli
 * appunti più vecchi di 12 mesi. (9b, RILASCIO-9b-COSTRUZIONE.md §2.10, §3.2) Poi, senza budget del modello: segna «da
 * verificare» i fatti non riconfermati da 6 mesi e cancella i legami con «Cosa serve» di proposte non più aperte. Lo
 * chiama il cron `/api/cron/contesto`, dopo il giro di Granola. Restituisce solo conteggi: mai un testo, mai un nome.
 */
import { refreshStaleBriefs } from "./context-brief";
import { markStaleFacts } from "./context-freshness";
import { purgeOrphanNeedLinks } from "./context-needs";
import { readPendingSources } from "./context-read";
import { purgeExpiredNoteText } from "./context-sources";

/**
 * Nell'ordine: `readPendingSources`, `refreshStaleBriefs`, `purgeExpiredNoteText`, `markStaleFacts` (`toCheck`: i fatti
 * appena segnati), `purgeOrphanNeedLinks` (`links`: i legami tolti). Solo conteggi; gli ultimi due non lanciano.
 */
export async function runContextNightly(o: {
  budgetMs: number;
  now?: Date;
}): Promise<{ read: number; failed: number; left: number; briefs: number; purged: number; toCheck: number; links: number }> {
  const started = Date.now();
  const reads = await readPendingSources({ budgetMs: o.budgetMs, now: o.now });
  const briefs = await refreshStaleBriefs({ budgetMs: Math.max(0, o.budgetMs - (Date.now() - started)) });
  const purged = await purgeExpiredNoteText(o.now);
  const toCheck = await markStaleFacts(o.now);
  const links = await purgeOrphanNeedLinks();
  return { ...reads, briefs, purged, toCheck, links };
}
