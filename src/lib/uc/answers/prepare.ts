/**
 * Normalizzazione più scansione del testo: quello che le API del referente e i
 * comandi di Lateral Space fanno prima di salvare una risposta (PIANO §3.9,
 * §3.10, §5.5).
 *
 * - Invio (`strict = true`): un errore di formato o un esito bloccante della
 *   scansione rifiutano la risposta.
 * - Bozza (`strict = false`): gli esiti `sanitario` e `discriminatorio`
 *   impediscono il salvataggio (nessun testo arriva sul server); gli altri esiti
 *   bloccanti (nomi, contatti…) e gli errori di formato tornano come errori da
 *   correggere prima dell'invio, ma la bozza si salva.
 *
 * La scansione passa su ogni foglia stringa del valore e dei campi liberi
 * accanto (`extras`: nota, motivo…). Gli `Issue` dei risultati della scansione
 * hanno codice `testo_<categoria>` e non contengono mai il testo.
 *
 * Modulo puro.
 */
import type { Json } from "../types.ts";
import type { ResponseType } from "../vocab.ts";
import {
  findingMessage,
  hasHardBlock,
  scanPayload,
  type PathFinding,
  type PayloadScanResult,
  type ScanCategory,
  type ScanContext,
} from "../text/scan.ts";
import { issue, type Issue } from "./issues.ts";
import { normalizeAnswer } from "./normalize.ts";
import type { NormalizeContext, ResponseConfig } from "./types.ts";
import { normalizeUniversalAction, type UniversalAction } from "./universal.ts";

export interface PrepareScanOptions {
  /** Default `risposta`; `testo_ls` per gli inserimenti di Lateral Space. */
  context?: ScanContext;
  /** Solo per le voci con `spec.health_rule_question`. */
  healthRuleQuestion?: { questionText: string };
  names?: readonly string[];
}

export type PreparedAnswer =
  | {
      ok: true;
      value: Json;
      normalized: Json | null;
      /** Errori ancora da correggere prima dell'invio (solo in bozza). */
      errors: Issue[];
      warnings: Issue[];
      partial?: boolean;
      validFrom?: string | null;
      textHash?: string | null;
      findings: PayloadScanResult;
    }
  | {
      ok: false;
      /** `formato`: la risposta non è valida; `testo_bloccato`: la scansione la ferma. */
      reason: "formato" | "testo_bloccato";
      errors: Issue[];
      warnings: Issue[];
      findings: PayloadScanResult;
    };

/** Un risultato della scansione come `Issue` da mostrare accanto al campo. */
export function findingIssue(f: PathFinding): Issue {
  return issue(`testo_${f.category}`, findingMessage(f.category), f.path === "" ? undefined : f.path);
}

function dedupeIssues(list: readonly Issue[]): Issue[] {
  const seen = new Set<string>();
  return list.filter((i) => {
    const k = `${i.code}|${i.field ?? ""}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

function scanAll(value: unknown, extras: Record<string, unknown> | undefined, scan: PrepareScanOptions, exempt?: Record<string, readonly ScanCategory[]>): PayloadScanResult {
  const opts = { context: scan.context ?? "risposta", healthRuleQuestion: scan.healthRuleQuestion, names: scan.names, exempt };
  const a = scanPayload(value, opts);
  if (!extras) return a;
  const b = scanPayload(extras, opts);
  return { blocking: [...a.blocking, ...b.blocking], warnings: [...a.warnings, ...b.warnings], truncated: a.truncated || b.truncated };
}

/** Un payload letto solo in parte non si salva: nessun testo resta senza controllo. */
const TRUNCATED_ISSUE: Issue = issue("risposta_troppo_complessa", "La risposta è troppo lunga o troppo annidata: allega un file.");

/** Prepara una risposta tipizzata per il salvataggio (vedi l'intestazione del modulo). */
export function prepareAnswer(i: {
  type: ResponseType;
  raw: unknown;
  config: ResponseConfig | null | undefined;
  ctx: NormalizeContext;
  /** Campi liberi accanto al valore: nota, «chi potrebbe saperlo»… */
  extras?: Record<string, unknown>;
  scan?: PrepareScanOptions;
}): PreparedAnswer {
  const n = normalizeAnswer(i.type, i.raw, i.config, i.ctx);
  const findings = scanAll(n.ok ? n.value : i.raw, i.extras, i.scan ?? {});
  const blockingIssues = dedupeIssues(findings.blocking.map(findingIssue));
  const warningIssues = dedupeIssues(findings.warnings.map(findingIssue));

  if (!n.ok) {
    return { ok: false, reason: "formato", errors: [...n.errors, ...blockingIssues], warnings: [...n.warnings, ...warningIssues], findings };
  }
  if (findings.truncated) {
    return { ok: false, reason: "testo_bloccato", errors: [TRUNCATED_ISSUE], warnings: [...n.warnings, ...warningIssues], findings };
  }
  if (i.ctx.strict ? findings.blocking.length > 0 : hasHardBlock(findings.blocking)) {
    const shown = i.ctx.strict ? blockingIssues : dedupeIssues(findings.blocking.filter((f) => hasHardBlock([f])).map(findingIssue));
    return { ok: false, reason: "testo_bloccato", errors: shown, warnings: [...n.warnings, ...warningIssues], findings };
  }
  return {
    ok: true,
    value: n.value,
    normalized: n.normalized,
    errors: [...n.errors, ...blockingIssues],
    warnings: [...n.warnings, ...warningIssues],
    ...(n.partial !== undefined ? { partial: n.partial } : {}),
    ...(n.validFrom !== undefined ? { validFrom: n.validFrom } : {}),
    ...(n.textHash !== undefined ? { textHash: n.textHash } : {}),
    findings,
  };
}

/**
 * Prepara un'azione universale («Non lo so», delega, «Non si applica»). Sono
 * sempre invii: ogni esito bloccante ferma. Nella delega il nome del collega è un
 * dato di contatto voluto: lì un nome non blocca.
 */
export function prepareUniversalAction(i: {
  action: UniversalAction;
  raw: unknown;
  activeItemIds: readonly string[];
  scan?: PrepareScanOptions;
}): PreparedAnswer {
  const n = normalizeUniversalAction(i.action, i.raw, { activeItemIds: i.activeItemIds });
  const exempt: Record<string, readonly ScanCategory[]> | undefined = i.action === "delega" ? { nome: ["nome_persona"] } : undefined;
  // L'email della delega si controlla a parte (formato): non è un testo libero.
  const scanned = n.ok && i.action === "delega" && n.value !== null && typeof n.value === "object" && !Array.isArray(n.value)
    ? { ...n.value, email: undefined }
    : n.ok
      ? n.value
      : i.raw;
  const findings = scanAll(scanned, undefined, i.scan ?? {}, exempt);
  const blockingIssues = dedupeIssues(findings.blocking.map(findingIssue));
  const warningIssues = dedupeIssues(findings.warnings.map(findingIssue));
  if (!n.ok) return { ok: false, reason: "formato", errors: [...n.errors, ...blockingIssues], warnings: warningIssues, findings };
  if (findings.truncated) return { ok: false, reason: "testo_bloccato", errors: [TRUNCATED_ISSUE], warnings: warningIssues, findings };
  if (findings.blocking.length > 0) return { ok: false, reason: "testo_bloccato", errors: blockingIssues, warnings: warningIssues, findings };
  return { ok: true, value: n.value, normalized: n.value, errors: [], warnings: warningIssues, findings };
}
