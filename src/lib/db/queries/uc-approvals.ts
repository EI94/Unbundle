/**
 * Firme nell'app (DESIGN §3.11, §4.5, WP9): la pagina `/firme` del dossier,
 * per il responsabile Lateral Space, il responsabile del cliente e
 * l'approvatore privacy.
 *
 * - `loadCaseApprovals`: le firme in attesa di chi guarda, con i testi e le
 *   impronte del link di approvazione (stesso costruttore, `views/approvals.ts`),
 *   in un solo giro insieme allo stato del caso.
 * - `decideCaseApproval`: riceve lo stesso corpo del link (`{kind, target_id,
 *   decision, read: true, text_hash, reason?}`), ricontrolla che la decisione
 *   aspetti ancora chi guarda e che il testo letto sia quello di adesso, poi
 *   firma con i comandi di oggi, da account: `signNa`, `signWaiver`,
 *   `signFallback`, `signGate`, `resolveBlocker` (scheda privacy),
 *   `signPersonalZoneAccess`; «Non approvo» con `rejectNa` e `rejectGate`.
 *   I comandi ricalcolano da sé ruoli, domini, designazioni e quattro occhi.
 *
 * Modulo senza import dell'app, come `uc-cases.ts`: lo usano anche i test di
 * integrazione.
 */
import { z } from "zod";
import { APPROVAL_KINDS, type ApprovalKind } from "../../uc/public-view.ts";
import { caseCoreSql, parseCaseCore } from "../../uc/sql/readiness.ts";
import { fail, ok, type Result } from "../../uc/types.ts";
import { approvalDecisionAllowed, buildCaseApprovals, type ApprovalStep, type SignerSide } from "../../uc/views/approvals.ts";
import type { CaseRole, CaseStatus } from "../../uc/vocab.ts";
import type { UcExecutor } from "../uc-executor.ts";
import { actorRoles, signPersonalZoneAccess, type UcCommandContext } from "./uc-cases.ts";
import { rejectGate, resolveBlocker, signGate } from "./uc-gates.ts";
import { rejectNa, signFallback, signNa, signWaiver } from "./uc-items.ts";
import { pendingRowsOf, pendingSignatureStatements } from "./uc-signatures.ts";
import { UUID } from "../../uc/ids.ts";

export const APPROVAL_MESSAGES: Readonly<Record<string, string>> = {
  dati_non_validi: "Dati non validi. Aggiorna la pagina e riprova.",
  non_letto: "Conferma di aver letto il testo prima di decidere.",
  ruolo_non_ammesso: "Questa decisione non spetta al tuo ruolo.",
  non_trovato: "Dossier non trovato.",
  caso_in_pausa: "Il caso è in pausa: si firma di nuovo quando riprende.",
  caso_chiuso: "Il caso è chiuso: non si firma più.",
  approvazione_non_trovata: "Questa decisione non aspetta più la tua firma. Aggiorna la pagina.",
  testo_cambiato: "Il testo da approvare è cambiato: aggiorna la pagina e rileggilo.",
  rifiuto_non_disponibile: "Questa decisione non si respinge: se non sei d'accordo, non firmare.",
  motivo_mancante: "Scrivi perché non approvi.",
};

export interface CaseApprovals {
  status: CaseStatus;
  approvals: ApprovalStep[];
}

/** Le firme in attesa di chi guarda, con lo stato del caso, in un solo giro. Null per un caso di un altro workspace. */
export async function loadCaseApprovals(executor: UcExecutor, i: { workspaceId: string; caseId: string; roles: readonly CaseRole[] }): Promise<CaseApprovals | null> {
  if (!UUID.test(i.workspaceId) || !UUID.test(i.caseId)) return null;
  const [caseRows, ...rows] = await executor.batch([caseCoreSql(i.workspaceId, i.caseId), ...pendingSignatureStatements(i.caseId)]);
  const core = parseCaseCore(caseRows[0]);
  if (!core) return null;
  return { status: core.status, approvals: buildCaseApprovals({ rows: pendingRowsOf(rows), roles: i.roles }) };
}

/** Lo stesso corpo di `POST /api/r/[token]/approve` (`approvalBody` di `views/referente-form.ts`). */
const DecisionSchema = z.strictObject({
  kind: z.enum(APPROVAL_KINDS),
  target_id: z.string().regex(UUID),
  decision: z.enum(["approvo", "non_approvo"]),
  read: z.literal(true),
  text_hash: z.string().regex(/^[0-9a-f]{64}$/),
  reason: z.string().max(2000).nullish(),
});

export interface CaseApprovalDecision {
  kind: ApprovalKind;
  targetId: string;
  decision: "approvo" | "non_approvo";
  /** Il lato per cui ha firmato chi guarda. */
  side: SignerSide;
  /** Con questa firma la decisione è completa; un «Non approvo» la chiude sempre. */
  complete: boolean;
  /** Via allo sviluppo di un caso a contratto: le firme ci sono, manca la prova scritta. */
  waitingForEvidence: boolean;
}

function failWith<T>(code: string): Result<T> {
  return fail(code, APPROVAL_MESSAGES[code] ?? APPROVAL_MESSAGES.dati_non_validi);
}

/**
 * «Ho letto e approvo» / «Non approvo» da `/firme`. Ruolo ammesso per quella
 * decisione (gli stessi delle action di oggi), caso aperto e non in pausa,
 * decisione ancora in attesa di chi guarda, testo uguale a quello letto. Poi il
 * comando di oggi con il firmatario da account.
 *
 * Il testo letto e la firma sono un passo solo, come sul link (`decideApproval`
 * di `uc-public.ts`): `signNa`, `signWaiver`, `signFallback`, `resolveBlocker`
 * e, per «Non approvo», `rejectNa` ricevono `d.text_hash` come `expectedTextHash` e lo
 * confrontano con la riga che caricano e che la scrittura tiene ferma. Se
 * Lateral Space ripropone un «non si applica», una deroga o un ripiego, o
 * registra una scheda privacy nuova, dopo la lettura, la firma non va sul testo
 * nuovo: «testo_cambiato». La via è al sicuro da sé (l'impronta non cambia per
 * la stessa proposta). Anche l'accesso ai dati personali: `signPersonalZoneAccess`
 * (`uc-cases.ts`) riceve `d.text_hash` e lo confronta con la concessione che firma
 * («testo_cambiato»), qui e su `/r`.
 */
export async function decideCaseApproval(executor: UcExecutor, ctx: UcCommandContext, input: unknown): Promise<Result<CaseApprovalDecision>> {
  const parsed = DecisionSchema.safeParse(input);
  if (!parsed.success) return failWith(parsed.error.issues.some((i) => i.path[0] === "read") ? "non_letto" : "dati_non_validi");
  const d = parsed.data;
  const roles = actorRoles(ctx);
  if (!approvalDecisionAllowed(d.kind, d.decision, roles)) return failWith(d.decision === "non_approvo" && approvalDecisionAllowed(d.kind, "approvo", roles) ? "rifiuto_non_disponibile" : "ruolo_non_ammesso");
  const loaded = await loadCaseApprovals(executor, { workspaceId: ctx.workspaceId, caseId: ctx.caseId, roles });
  if (!loaded) return failWith("non_trovato");
  if (loaded.status === "sospeso") return failWith("caso_in_pausa");
  if (loaded.status === "chiuso") return failWith("caso_chiuso");
  const target = loaded.approvals.find((a) => a.kind === d.kind && a.targetId.toLowerCase() === d.target_id.toLowerCase());
  if (!target) return failWith("approvazione_non_trovata");
  if (target.textHash !== d.text_hash) return failWith("testo_cambiato");
  const after = <T>(r: Result<T>, complete: (value: T) => boolean, waitingForEvidence: (value: T) => boolean = () => false): Result<CaseApprovalDecision> =>
    r.ok
      ? ok({ kind: d.kind, targetId: target.targetId, decision: d.decision, side: target.side, complete: complete(r.value), waitingForEvidence: waitingForEvidence(r.value) })
      : r.code === "testo_cambiato" && target.kind !== "gate"
        ? failWith("testo_cambiato")
        : fail(r.code, r.message);
  // Il testo letto: il comando lo confronta con la riga che firma.
  const expectedTextHash = d.text_hash;

  if (d.decision === "non_approvo") {
    if (!target.canReject) return failWith("rifiuto_non_disponibile");
    const reason = (d.reason ?? "").trim();
    if (reason.length < 3) return failWith("motivo_mancante");
    if (target.kind === "na") return after(await rejectNa(executor, ctx, { itemId: target.targetId, reason, expectedTextHash: d.text_hash }), () => true);
    return after(await rejectGate(executor, ctx, { reviewId: target.targetId, reason }), () => true);
  }

  switch (target.kind) {
    case "na":
      return after(await signNa(executor, ctx, { itemId: target.targetId, expectedTextHash }), (v) => v.complete);
    case "deroga":
      return after(await signWaiver(executor, ctx, { itemId: target.targetId, expectedTextHash }), (v) => v.complete);
    case "ripiego":
      return after(await signFallback(executor, ctx, { itemId: target.targetId, expectedTextHash }), (v) => v.complete);
    case "gate":
      return after(
        await signGate(executor, ctx, { reviewId: target.targetId }),
        (v) => v.complete,
        (v) => v.waitingFor === "prova_scritta",
      );
    case "a8":
      // Senza prove nuove: si firma la scheda già registrata, solo se è quella del testo letto.
      return after(await resolveBlocker(executor, ctx, { blockerId: target.targetId, expectedTextHash }), (v) => v.complete);
    case "zona_personale":
      // Firmata solo sul testo letto: una concessione riproposta nel frattempo dà «testo_cambiato».
      return after(await signPersonalZoneAccess(executor, ctx, { userId: target.targetId }, undefined, { expectedTextHash: d.text_hash }), (v) => v.active);
  }
}
