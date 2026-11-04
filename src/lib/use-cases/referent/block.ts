/**
 * «Referente in un tocco» (rilascio 5, SPEC §3.1, §3.4, §9.2, §9.5): il referente di uno use case per
 * il blocco «Referente» della scheda, dalle richieste lette dal pannello. Niente si salva: il referente
 * è la persona dell'ultima richiesta al referente (R*) non revocata; R è l'ultima richiesta non revocata
 * a quella persona (di qualunque tipo).
 *
 * Modulo puro: lo usano il pannello (`loadUseCaseReferentPanel`) e i test.
 */
import type { ReferentRequestStatus } from "../../db/use-case-hub-referents-ddl.ts";
import type { ReferentCheckConfirm, ReferentCheckEstimate, ReferentCheckOutcome } from "../../db/use-case-hub-referent-check-ddl.ts";
import type { ReferentBlockCheck, ReferentBlockView } from "./contract.ts";
import { adoptionPatch, referentHours, sameTeamEstimate, type TeamEstimate } from "./estimate.ts";
import { referentRequestsOf, referentStateOf, type ReferentRequestFact } from "./use-case-state.ts";

/** La riga di `use_case_referent_checks` come la legge il pannello. */
export interface ReferentCheckRow {
  submittedAt: Date | null;
  confirm: ReferentCheckConfirm | null;
  confirmNote: string | null;
  estimate: ReferentCheckEstimate | null;
  timesPerMonth: number | null;
  minutesEach: number | null;
  teamComponentKey: string | null;
  teamVolumeYear: number | null;
  teamMinutes: number | null;
  correctionDoneAt: Date | null;
  estimateOutcome: ReferentCheckOutcome | null;
  estimateOutcomeAt: Date | null;
}

/** Una richiesta dello use case con la sua persona (solo sul server) e la sua conferma. */
export interface BlockRequestFact {
  id: string;
  version: number;
  contactId: string;
  contactName: string;
  roleLabel: string | null;
  emailMasked: string | null;
  /** La persona è un revisore del workspace («Fa parte del team»). */
  team: boolean;
  status: ReferentRequestStatus;
  createdAt: Date;
  expiresAt: Date;
  reminderCount: number;
  openTask: number;
  check: ReferentCheckRow | null;
}

export interface ReferentBlockInput {
  eligible: boolean;
  requests: readonly BlockRequestFact[];
  clientRequirementToVerify: boolean;
  /** La stima del team di adesso (`teamEstimateOf(valueModel)`). */
  teamNow: TeamEstimate | null;
  now: Date;
  /** Le domande «Non ce l'ho» del referente (calcolate dal server per la sua persona). */
  declinedNeedIds: readonly string[];
  hints: readonly string[];
  /** Le domande da chiedere della scheda (`askableNeeds`). */
  askableNeedIds: readonly string[];
}

const iso = (d: Date | null) => (d ? d.toISOString() : null);

function factOf(r: BlockRequestFact): ReferentRequestFact {
  return {
    id: r.id,
    contactId: r.contactId,
    status: r.status,
    createdAt: r.createdAt,
    expiresAt: r.expiresAt,
    reminderCount: r.reminderCount,
    openTask: r.openTask,
    check: r.check
      ? {
          submittedAt: r.check.submittedAt,
          confirm: r.check.confirm,
          correctionDoneAt: r.check.correctionDoneAt,
          estimate: r.check.estimate,
          estimateOutcome: r.check.estimateOutcome,
          teamComponentKey: r.check.teamComponentKey,
        }
      : null,
  };
}

/** La persona del referente (solo sul server), oppure null. */
export function referentContactOf(requests: readonly BlockRequestFact[]): string | null {
  return referentRequestsOf(requests.map(factOf)).referent;
}

/** La stima del team dopo «Usa la stima di …»: l'istantanea con i numeri del referente (adoptionPatch). */
function adoptedOf(snapshot: { key: string; volumeYear: number; minutes: number }, numbers: { timesPerMonth: number | null; minutesEach: number | null }) {
  const patch = adoptionPatch(numbers);
  return { key: snapshot.key, volumeYear: patch.volumeYear ?? snapshot.volumeYear, minutes: patch.minutesPerUnit ?? snapshot.minutes };
}

/** La conferma e la stima di R* per il blocco (§9.2). */
export function blockCheckOf(row: ReferentCheckRow, version: number, teamNow: TeamEstimate | null): ReferentBlockCheck {
  const snapshot =
    row.teamComponentKey !== null && row.teamVolumeYear !== null && row.teamMinutes !== null
      ? { key: row.teamComponentKey, volumeYear: row.teamVolumeYear, minutes: row.teamMinutes }
      : null;
  const numbers = { timesPerMonth: row.timesPerMonth, minutesEach: row.minutesEach };
  const given = row.timesPerMonth !== null || row.minutesEach !== null;
  const now = teamNow ? { key: teamNow.key, volumeYear: teamNow.volumeYear, minutes: teamNow.minutes } : null;
  // «Usa la stima di …» scrive i numeri del referente nel componente: quel cambio è del team, non dopo la risposta.
  const adoptedNow = row.estimateOutcome === "adottata" && snapshot !== null && sameTeamEstimate(adoptedOf(snapshot, numbers), now);
  return {
    submittedAt: iso(row.submittedAt),
    confirm: row.confirm,
    note: row.confirmNote,
    estimate: row.estimate,
    timesPerMonth: row.timesPerMonth,
    minutesEach: row.minutesEach,
    correctionDoneAt: iso(row.correctionDoneAt),
    outcome: row.estimateOutcome,
    outcomeAt: iso(row.estimateOutcomeAt),
    team: snapshot
      ? {
          key: snapshot.key,
          volumeYear: snapshot.volumeYear,
          minutes: snapshot.minutes,
          hours: Math.round((snapshot.volumeYear * snapshot.minutes) / 60),
          perMonth: snapshot.volumeYear < 12 ? null : Math.round(snapshot.volumeYear / 12),
        }
      : null,
    teamChanged: snapshot !== null && !sameTeamEstimate(snapshot, now) && !adoptedNow,
    teamNow: teamNow !== null,
    referentHours: given ? referentHours(snapshot, numbers) : null,
    version,
  };
}

/** Il blocco «Referente» (§9.5); null quando lo use case non ha un referente (o non ne ha uno da scegliere). */
export function referentBlockOf(i: ReferentBlockInput): ReferentBlockView | null {
  if (!i.eligible) return null;
  const facts = i.requests.map(factOf);
  const result = referentStateOf({
    eligible: true,
    requests: facts,
    clientRequirementToVerify: i.clientRequirementToVerify,
    hasTeamEstimateNow: i.teamNow !== null,
    now: i.now,
  });
  if (!result || result.state === "manca") return null;
  const { latestReferent, current } = referentRequestsOf(facts);
  if (!latestReferent || !current) return null;
  const star = i.requests.find((r) => r.id === latestReferent.id)!;
  const r = i.requests.find((x) => x.id === current.id)!;
  const live = r.status === "inviata" && r.expiresAt.getTime() > i.now.getTime();
  const declined = new Set(i.declinedNeedIds.map((id) => id.toLowerCase()));
  return {
    contact: { id: star.contactId, name: star.contactName, roleLabel: star.roleLabel, emailMasked: star.emailMasked, team: star.team },
    requestId: r.id,
    referentRequestId: star.id,
    state: result.state,
    review: result.review,
    live,
    check: star.check ? blockCheckOf(star.check, star.version, i.teamNow) : null,
    declinedNeedIds: [...declined],
    hints: i.hints.slice(0, 3),
    askableForReferent: i.askableNeedIds.map((id) => id.toLowerCase()).filter((id) => !declined.has(id)),
  };
}
