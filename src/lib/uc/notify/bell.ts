/**
 * Campanella di Lateral Space per i dossier (DESIGN §3.13.4; PIANO §7.1, D37).
 *
 * Le righe `uc_notifications` con `channel = 'in_app'` hanno come destinatari
 * solo i membri `ls_*` di un caso: ai membri del cliente non arrivano mai, e
 * niente finisce in `weekly_signals` (che va nel prompt AI dell'analisi
 * competitiva e si segna letto per tutto il workspace).
 *
 * Qui ci sono i testi e il collegamento di ogni riga:
 * - prima riga: codice e titolo dello use case («XX-0012 · Smistamento
 *   richieste»), letti con un join al momento (dossier, poi scheda madre); senza
 *   scheda madre quelli del dossier. Mai «Casi d'uso», «caso d'uso» o
 *   «Opportunità»;
 * - titolo e descrizione in italiano semplice, senza chiavi delle voci, codici
 *   del via o date ISO; la descrizione non ripete il codice;
 * - data relativa in `it-IT` («3 ore fa», «ieri», «23 ott»);
 * - più «risposta_ricevuta» dello stesso dossier e dello stesso giorno sono una
 *   riga con il conteggio delle risposte.
 *
 * Dal `payload` della coda si leggono solo conteggi e id. Mai valori delle
 * risposte, nomi, email o token.
 *
 * Il componente della campanella (`components/portfolio/notifications-bell.tsx`)
 * è dell'hub (H4i, `docs/use-case/PIANO-LAVORI.md` §4): qui non si tocca. Oggi
 * mostra solo `title` e `description`, ancora con l'etichetta «Casi d'uso» e
 * `toLocaleString()`, quindi una riga non dice di quale dossier parla.
 * Consegna a H4i (regola 1 di §8.1): `context` al posto dell'etichetta «Casi
 * d'uso» (`text-xs text-muted-foreground`, troncata), `when` al posto di
 * `toLocaleString()`, «Segna come lette» come azione in testata. Finché non
 * arriva, l'accettazione della campanella (§3.13.4) resta aperta.
 *
 * Modulo puro.
 */
import type { Json } from "../types.ts";
import { formatCountIt, formatRelativeIt } from "../views/format.ts";
import { dossierIdentity, codeAndTitle } from "../views/realization.ts";
import { UUID } from "../ids.ts";

/** Una riga della campanella pronta per l'interfaccia (dati serializzabili). */
export interface UcBellItem {
  /** La notifica più recente della riga: segnarla letta segna lette anche le altre della riga. */
  id: string;
  /** Tutte le notifiche della riga (più di una solo per le risposte raggruppate). */
  ids: string[];
  workspaceId: string;
  caseId: string | null;
  templateKey: string;
  createdAt: string;
  /** «adesso», «3 ore fa», «ieri», «23 ott». */
  when: string;
  /** Prima riga: «XX-0012 · Smistamento richieste». Null senza dossier (riepilogo). */
  context: string | null;
  title: string;
  description: string | null;
  /** Pagina interna a cui porta la notifica, oppure null. */
  href: string | null;
}

/** Una riga della coda con i fatti letti al momento (non nel payload). */
export interface UcBellRow {
  id: string;
  workspaceId: string;
  caseId: string | null;
  templateKey: string;
  payload: Record<string, Json>;
  createdAt: Date;
  caseCode?: string | null;
  caseTitle?: string | null;
  useCaseCode?: string | null;
  useCaseTitle?: string | null;
  /** Solo `risposta_ricevuta`: risposte dei referenti arrivate quel giorno nel dossier. */
  answers?: number | null;
}

const CASE_CODE = /^[A-Z0-9][A-Z0-9-]{1,39}$/;
const WEEK = /^\d{4}-W(\d{2})$/;
const ROME_DAY = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Rome", year: "numeric", month: "2-digit", day: "2-digit" });

function count(payload: Record<string, Json>, field: string): number | null {
  const v = payload[field];
  return typeof v === "number" && Number.isInteger(v) && v >= 0 ? v : null;
}

function str(payload: Record<string, Json>, field: string, pattern: RegExp): string | null {
  const v = payload[field];
  return typeof v === "string" && pattern.test(v) ? v : null;
}

/** «1 domanda», «8 domande». */
function questions(n: number): string {
  return n === 1 ? "1 domanda" : `${formatCountIt(n)} domande`;
}

/**
 * Titolo e dettaglio in italiano semplice (DESIGN §3.13.4). `answers`: le
 * risposte della riga di `risposta_ricevuta`. Un modello sconosciuto ha un
 * testo generico.
 */
export function bellText(templateKey: string, payload: Record<string, Json>, extra: { answers?: number | null } = {}): { title: string; description: string | null } {
  const items = count(payload, "items");
  switch (templateKey) {
    case "risposta_ricevuta": {
      const n = extra.answers ?? count(payload, "count");
      const title = n && n > 0 ? (n === 1 ? "1 nuova risposta da verificare" : `${formatCountIt(n)} nuove risposte da verificare`) : "Nuove risposte da verificare";
      return { title, description: "Da verificare prima del via allo sviluppo." };
    }
    case "dato_scaduto":
      return { title: "Un dato è scaduto", description: "Va verificato di nuovo." };
    case "blocco_sciolto":
      return {
        title: items !== null && items > 0 ? (items === 1 ? "Sbloccata 1 domanda" : `Sbloccate ${formatCountIt(items)} domande`) : "Domande sbloccate",
        description: "Controllale prima di inviarle.",
      };
    case "gate_pronto":
      return { title: "Via allo sviluppo proposto", description: "Manca la firma del cliente." };
    case "gate_approvato":
      return { title: "Via allo sviluppo approvato", description: "Il catalogo è pronto per lo sviluppo." };
    case "ls_lead_da_indicare":
      return { title: "Il dossier non ha un responsabile", description: "Indicane uno in Impostazioni." };
    case "owner_da_indicare":
      return { title: "Manca il responsabile del cliente", description: "Una richiesta è ferma dopo due promemoria." };
    case "delega":
      return {
        title: "Domande girate a un collega",
        description: items !== null && items > 0 ? `${questions(items)}: approva la delega in Persone.` : "Approva la delega in Persone.",
      };
    case "riepilogo_settimanale": {
      const week = WEEK.exec(str(payload, "week", WEEK) ?? "");
      return { title: "Il riepilogo della settimana", description: week ? `Settimana ${Number(week[1])}` : null };
    }
    default:
      return { title: "Novità sul dossier", description: null };
  }
}

/**
 * Pagina interna della notifica (DESIGN §3.13.4): dentro il dossier, con le
 * rotte nuove; il riepilogo, che non ha un dossier, porta alla Panoramica.
 */
export function bellHref(i: { workspaceId: string; caseId: string | null; templateKey: string; payload: Record<string, Json> }): string | null {
  if (!UUID.test(i.workspaceId)) return null;
  const ws = `/dashboard/${i.workspaceId.toLowerCase()}`;
  if (!i.caseId) return `${ws}/use-cases?vista=panoramica`;
  if (!UUID.test(i.caseId)) return null;
  const base = `${ws}/casi-duso/${i.caseId.toLowerCase()}`;
  switch (i.templateKey) {
    case "risposta_ricevuta":
      return `${base}/domande?vista=da-verificare`;
    case "dato_scaduto": {
      const itemId = str(i.payload, "item_id", UUID);
      return itemId ? `${base}/domande/${itemId.toLowerCase()}` : `${base}/domande?vista=da-verificare`;
    }
    case "gate_pronto":
    case "gate_approvato":
      return `${base}/via`;
    case "ls_lead_da_indicare":
      return `${base}/impostazioni`;
    case "blocco_sciolto":
    case "owner_da_indicare":
    case "delega":
      return `${base}/persone`;
    default:
      return base;
  }
}

/** Prima riga: codice e titolo dello use case, oppure del dossier senza scheda madre. */
export function bellContext(row: Pick<UcBellRow, "caseId" | "payload" | "caseCode" | "caseTitle" | "useCaseCode" | "useCaseTitle">): string | null {
  if (!row.caseId) return null;
  const caseCode = row.caseCode?.trim() || str(row.payload, "case_code", CASE_CODE) || "";
  const caseTitle = row.caseTitle?.trim() ?? "";
  const useCase = row.useCaseTitle?.trim() ? { code: row.useCaseCode ?? null, title: row.useCaseTitle } : null;
  const { code, title } = dossierIdentity({ caseCode, caseTitle, useCase });
  if (!code && !title) return null;
  return title ? codeAndTitle(code, title) : code;
}

/** Una riga della campanella da una riga della coda. */
export function toBellItem(row: UcBellRow, now: Date = new Date()): UcBellItem {
  const text = bellText(row.templateKey, row.payload, { answers: row.answers ?? null });
  return {
    id: row.id,
    ids: [row.id],
    workspaceId: row.workspaceId,
    caseId: row.caseId,
    templateKey: row.templateKey,
    createdAt: row.createdAt.toISOString(),
    when: formatRelativeIt(row.createdAt, now) ?? "",
    context: bellContext(row),
    title: text.title,
    description: text.description,
    href: bellHref(row),
  };
}

/** Chiave di gruppo: le risposte dello stesso dossier e dello stesso giorno a Roma. */
function groupKey(row: UcBellRow): string | null {
  if (row.templateKey !== "risposta_ricevuta" || !row.caseId) return null;
  return `${row.caseId.toLowerCase()}:${ROME_DAY.format(row.createdAt)}`;
}

/**
 * Le righe della campanella, nell'ordine della coda (le più recenti prima). Le
 * «risposta_ricevuta» dello stesso dossier e dello stesso giorno diventano una
 * riga: la più recente, con tutte le notifiche e il conteggio delle risposte.
 */
export function toBellItems(rows: readonly UcBellRow[], now: Date = new Date()): UcBellItem[] {
  const groups = new Map<string, UcBellRow[]>();
  const order: (UcBellRow | string)[] = [];
  for (const row of rows) {
    const key = groupKey(row);
    if (!key) {
      order.push(row);
      continue;
    }
    const group = groups.get(key);
    if (group) group.push(row);
    else {
      groups.set(key, [row]);
      order.push(key);
    }
  }
  return order.map((entry) => {
    if (typeof entry !== "string") return toBellItem(entry, now);
    const group = groups.get(entry)!;
    const newest = group.reduce((a, b) => (b.createdAt > a.createdAt ? b : a));
    const counted = group.map((r) => r.answers ?? 0).reduce((a, b) => Math.max(a, b), 0);
    const answers = counted > 0 ? counted : group.length > 1 ? group.length : null;
    const item = toBellItem({ ...newest, answers }, now);
    return { ...item, ids: [newest.id, ...group.filter((r) => r !== newest).map((r) => r.id)] };
  });
}
