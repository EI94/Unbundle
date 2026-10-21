/**
 * `use-case-admin origin` (docs/use-case/DESIGN.md §10.7): origine e «nascosta alla ricerca»
 * dei dati esistenti. Non classifica in silenzio: le righe incerte le conferma Pierpaolo.
 *
 * | Righe | Proposta | Serve conferma |
 * |---|---|---|
 * | `source` nullo (Activity mapping di oggi, `actions/use-cases.ts`) | `transformation`, nascosta alla ricerca | no |
 * | `web_proposed` con autore di Lateral Space | `transformation` | sì |
 * | `web_proposed` con autore non risolto | resta `adoption` | sì |
 * | tutte le altre | `adoption` | no |
 *
 * - Le righe da guardare sono quelle ancora `adoption` (il valore della 0020 per i dati di
 *   prima) senza una decisione sull'origine (`ORIGIN_UNDECIDED_SQL`: niente riga di Storia con
 *   `origine`, niente `intake.originConfirmed`). Una scheda già `transformation` l'ha decisa
 *   qualcuno: il comando non la riporta mai indietro.
 * - **Le schede del servizio dell'hub hanno già l'origine** (`defaultOrigin`, o quella che il
 *   chiamante passa): il comando non le guarda. Sono le fonti che scrive solo l'hub
 *   (`HUB_ONLY_SOURCES`: `manual`, `team_mcp`, `activity_mapping`; l'Activity mapping di oggi
 *   scrive `source` nullo) e le `web_proposed` nate dopo la 0020 (hanno la riga `creato`) in un
 *   workspace con l'area accesa (`USE_CASE_HUB_WORKSPACES` della shell): lì il modulo completo
 *   passa dal servizio, che sceglie `adoption` anche per chi è di Lateral Space senza ruolo da
 *   revisore. Senza la variabile queste ultime restano nella lista, da confermare: mai un
 *   cambio in silenzio.
 * - Chi è l'autore lo risolve `scripts/use-case-admin/origin.ts` (un'email, o un id utente
 *   letto da `users`, contro `UC_LS_EMAIL_DOMAINS`): qui arriva solo «sì», «no» o «non
 *   risolto». La lista stampa codice, titolo troncato a 60 caratteri, canale, autore di
 *   Lateral Space e proposta; mai email o nomi.
 * - Pierpaolo conferma con `--decisions origin.json` (`{ "<id>": "adoption" | "transformation" }`),
 *   poi `--apply`. Le righe `transformation` ricevono anche `intake.hiddenFromSearch = true`.
 * - Un cambio va con la sua riga di Storia, nello stesso statement: `modificato`, canale
 *   `script`, `sistema`, campi `origine` (e `visibilita` se la scheda si nasconde). Una
 *   conferma che lascia `adoption` non cambia niente di visibile, quindi niente Storia (§6.6
 *   mostrerebbe «Modificato: Origine» per una modifica mai avvenuta): scrive solo
 *   `intake.originConfirmed = true`, che nessuna lettura mostra, così la scheda risulta decisa
 *   per il comando, per `codes` e per `doctor`. `intake` è una colonna versionata: la
 *   conferma fa salire `version` una volta, come ogni scrittura di Pierpaolo prima
 *   dell'accensione.
 * - Va eseguito prima di `codes`: così nessuna scheda dall'alto diventa cercabile dal connettore.
 *
 * Modulo puro: solo import relativi `.ts`.
 */
import { CREATED_EVENT_CHANNEL } from "../../db/use-case-hub-ddl.ts";
import type { Origin } from "../types.ts";
import { isUuid } from "./cli.ts";

/** L'autore è di Lateral Space? */
export type LsAuthor = "si" | "no" | "non_risolto";

export interface OriginRow {
  id: string;
  workspaceId: string;
  code: string | null;
  title: string;
  source: string | null;
  /** `intake.hiddenFromSearch` è già vero. */
  hidden: boolean;
  author: LsAuthor;
}

export type OriginRule = "activity_mapping" | "web_lateral_space" | "web_non_risolto" | "altro";

export interface OriginProposal {
  origin: Origin;
  needsConfirmation: boolean;
  rule: OriginRule;
}

export type OriginAction = "cambia" | "registra" | "attende_conferma" | "invariata";

export interface OriginItem extends OriginRow {
  proposal: OriginProposal;
  decision: Origin | null;
  action: OriginAction;
  /** Cosa si scrive con `--apply`: `cambia` con la Storia, `registra` solo la conferma. */
  write: { origin: Origin; hide: boolean; fields: string[] } | null;
}

export interface OriginPlan {
  items: OriginItem[];
  counts: Record<OriginAction, number>;
}

/** Il campo della Storia che registra una decisione sull'origine. */
export const ORIGIN_EVENT_FIELD = "origine";

/** La chiave di `intake` che registra la conferma di una scheda che resta `adoption`. */
export const ORIGIN_CONFIRMED_KEY = "originConfirmed";

/**
 * La scheda `u` non ha ancora una decisione sull'origine: nessuna riga di Storia con `origine`
 * (un cambio dello script, o della pagina) e nessuna conferma in `intake`.
 */
export const ORIGIN_UNDECIDED_SQL = `NOT EXISTS (SELECT 1 FROM use_case_events e WHERE e.use_case_id = u.id AND '${ORIGIN_EVENT_FIELD}' = ANY(e.fields))
   AND NOT coalesce(u.intake -> '${ORIGIN_CONFIRMED_KEY}' = 'true'::jsonb, false)`;

/** Fonti che scrive solo il servizio dell'hub, sempre con l'origine scelta: fuori dalla lista. */
export const HUB_ONLY_SOURCES: readonly string[] = Object.freeze(["manual", "team_mcp", "activity_mapping"]);

/** Canale di una scheda dalla sua `source`, come la riga `creato` della Storia (§10.3). */
export function channelOfSource(source: string | null): string {
  if (source === null) return "activity_mapping";
  return (CREATED_EVENT_CHANNEL as Record<string, string>)[source] ?? "altro";
}

/**
 * La proposta per una scheda ancora `adoption` e senza decisione. Il cambio automatico vale
 * solo per `source` nullo (l'Activity mapping di oggi): `activity_mapping` lo scrive il servizio
 * dell'hub, che l'origine l'ha già scelta.
 */
export function proposeOrigin(row: Pick<OriginRow, "source" | "author">): OriginProposal {
  if (row.source === null) {
    return { origin: "transformation", needsConfirmation: false, rule: "activity_mapping" };
  }
  if (row.source === "web_proposed" && row.author === "si") {
    return { origin: "transformation", needsConfirmation: true, rule: "web_lateral_space" };
  }
  if (row.source === "web_proposed" && row.author === "non_risolto") {
    return { origin: "adoption", needsConfirmation: true, rule: "web_non_risolto" };
  }
  return { origin: "adoption", needsConfirmation: false, rule: "altro" };
}

/** Le schede che aspettano ancora `origin`: un cambio automatico o una conferma (`doctor`). */
export function pendingOriginCount(rows: readonly Pick<OriginRow, "source" | "author">[]): number {
  return rows.filter((row) => {
    const proposal = proposeOrigin(row);
    return proposal.needsConfirmation || proposal.origin === "transformation";
  }).length;
}

/** Il file `--decisions`: `{ "<id>": "adoption" | "transformation" }`. */
export function parseOriginDecisions(value: unknown): { ok: true; decisions: Map<string, Origin> } | { ok: false; message: string } {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, message: "--decisions: il file deve essere un oggetto { \"<id>\": \"adoption\" | \"transformation\" }." };
  }
  const decisions = new Map<string, Origin>();
  for (const [key, origin] of Object.entries(value as Record<string, unknown>)) {
    if (!isUuid(key)) return { ok: false, message: `--decisions: «${key.slice(0, 40)}» non è un id di use case.` };
    if (origin !== "adoption" && origin !== "transformation") {
      return { ok: false, message: `--decisions: per ${key} scrivi "adoption" oppure "transformation".` };
    }
    decisions.set(key.toLowerCase(), origin);
  }
  return { ok: true, decisions };
}

function writeFor(row: OriginRow, origin: Origin): { origin: Origin; hide: boolean; fields: string[] } {
  const hide = origin === "transformation" && !row.hidden;
  const fields = [ORIGIN_EVENT_FIELD];
  if (hide) fields.push("visibilita");
  return { origin, hide, fields };
}

/**
 * Il piano. Una decisione del file vale su ogni scheda della lista (conferma o correzione di
 * una proposta automatica); un id fuori dalla lista ferma il comando.
 */
export function planOrigin(
  rows: readonly OriginRow[],
  decisions: ReadonlyMap<string, Origin> = new Map(),
): { ok: true; plan: OriginPlan } | { ok: false; message: string } {
  const ids = new Set(rows.map((row) => row.id.toLowerCase()));
  const unknown = [...decisions.keys()].filter((id) => !ids.has(id));
  if (unknown.length > 0) {
    return {
      ok: false,
      message: `--decisions: ${unknown.length} id fuori dalla lista (non esistono, sono di un altro ambito o hanno già l'origine decisa): ${unknown.slice(0, 10).join(", ")}`,
    };
  }
  const counts: Record<OriginAction, number> = { cambia: 0, registra: 0, attende_conferma: 0, invariata: 0 };
  const items: OriginItem[] = rows.map((row) => {
    const proposal = proposeOrigin(row);
    const decision = decisions.get(row.id.toLowerCase()) ?? null;
    let action: OriginAction;
    let write: OriginItem["write"] = null;
    if (decision !== null) {
      write = writeFor(row, decision);
      action = decision === "transformation" ? "cambia" : "registra";
    } else if (proposal.needsConfirmation) {
      action = "attende_conferma";
    } else if (proposal.origin === "transformation") {
      write = writeFor(row, "transformation");
      action = "cambia";
    } else {
      action = "invariata";
    }
    counts[action]++;
    return { ...row, proposal, decision, action, write };
  });
  return { ok: true, plan: { items, counts } };
}

const AUTHOR_LABEL: Record<LsAuthor, string> = { si: "sì", no: "no", non_risolto: "non risolto" };

/** Le righe per l'uscita (le invariate si contano soltanto): mai email o nomi. */
export function describeOriginItems(plan: OriginPlan) {
  return plan.items
    .filter((item) => item.action !== "invariata")
    .map((item) => ({
      id: item.id,
      workspace: item.workspaceId,
      codice: item.code,
      titolo: item.title,
      canale: channelOfSource(item.source),
      autoreLateralSpace: AUTHOR_LABEL[item.author],
      proposta: item.proposal.origin,
      conferma: item.proposal.needsConfirmation ? "serve" : "no",
      decisione: item.decision,
      azione: item.action,
      nascondi: item.write?.hide ?? false,
    }));
}

/**
 * Cambia l'origine (e nasconde la scheda) con la sua riga di Storia, nello stesso statement.
 * Solo se la scheda è ancora `adoption` e senza decisione. `$1` id, `$2` workspace,
 * `$3` origine, `$4` nascondi, `$5` campi della Storia.
 */
export const APPLY_ORIGIN_SQL = `WITH upd AS (
  UPDATE use_cases u
     SET origin = $3,
         intake = CASE WHEN $4::boolean THEN coalesce(u.intake, '{}'::jsonb) || jsonb_build_object('hiddenFromSearch', true) ELSE u.intake END,
         updated_at = now()
   WHERE u.id = $1::uuid AND u.workspace_id = $2::uuid AND u.origin = 'adoption'
     AND ${ORIGIN_UNDECIDED_SQL}
  RETURNING u.id, u.workspace_id)
INSERT INTO use_case_events (workspace_id, use_case_id, actor_user_id, actor_kind, channel, action, fields)
SELECT workspace_id, id, NULL, 'sistema', 'script', 'modificato', $5::text[] FROM upd
RETURNING use_case_id`;

/**
 * Registra una conferma che lascia `adoption`: solo `intake.originConfirmed`, nessuna riga di
 * Storia (niente è cambiato) e `updated_at` com'era. `$1` id, `$2` workspace.
 */
export const CONFIRM_ORIGIN_SQL = `UPDATE use_cases u
   SET intake = coalesce(u.intake, '{}'::jsonb) || jsonb_build_object('${ORIGIN_CONFIRMED_KEY}', true)
 WHERE u.id = $1::uuid AND u.workspace_id = $2::uuid AND u.origin = 'adoption'
   AND ${ORIGIN_UNDECIDED_SQL}
RETURNING u.id AS use_case_id`;
