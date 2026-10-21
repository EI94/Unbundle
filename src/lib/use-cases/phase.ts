/**
 * Fase unica di uno use case (docs/use-case/DESIGN.md §3.4, §3.5; decisioni D10 e D16).
 *
 * `phaseOfUseCase` chiama prima `connectorStatus` (src/lib/connector/status.ts, la stessa
 * funzione del connettore del cliente) e poi raffina il sotto-stato. **Non ha regole di
 * fase sue**: la fase dipende solo dal codice del connettore (`CONNECTOR_CODE_PHASE`),
 * così Lateral Space e chi chiede a Claude «a che punto è XX-0012?» vedono la stessa cosa.
 * Se connettore e pagina divergono, `phase.test.ts` fallisce.
 *
 * Il sotto-stato guarda solo campi che il connettore non usa per scegliere tra due fasi:
 * - VALUTATA: la data di revisione (`review_by`) rispetto a oggi: Valutata, Rimandata,
 *   Da rivedere;
 * - APPROVATA: il trimestre (`target_quarter`), oppure «Più avanti»;
 * - AVVIATA_COME_CASO: lo stato del dossier, con l'etichetta di `CASE_STATUS_LABEL`;
 * - REALIZZATA: il tipo, «Realizzato» o «Diffusa»;
 * - DOPPIONE: il codice dell'altra scheda, solo se è un codice valido.
 *
 * `today` arriva dall'esterno (`romeToday(now)`, fuso Europe/Rome): il modulo non legge
 * l'orologio. Il nome non inizia con `use` più una maiuscola (D16).
 *
 * Modulo puro: solo import relativi `.ts`, nessun `server-only`.
 */
import { connectorStatus, type ConnectorStatus, type ConnectorStatusCode, type UseCaseStatusInput } from "../connector/status.ts";
import { USE_CASE_CODE_PATTERN } from "../portfolio/use-case-code.ts";
import { CASE_STATUS_LABEL } from "../uc/case-state.ts";
import type { CaseStatus } from "../uc/vocab.ts";
import { kindOf } from "./labels.ts";
import { isQuarterCode, parseIsoDate, quarterLabel } from "./quarter.ts";
import type { Phase, PhaseTone, SubState } from "./types.ts";

export interface PhaseInput extends UseCaseStatusInput {
  /** `use_cases.portfolio_kind`: `best_practice` è «Da diffondere», il resto «Da costruire». */
  portfolioKind: string | null;
  /** `use_cases.target_quarter` (`AAAA-Qn`) oppure null («Più avanti»). */
  targetQuarter: string | null;
  /** Stato del dossier collegato, da `uc_cases`; solo con UC_ENABLED e to_regclass. */
  dossierStatus: CaseStatus | null;
  /** Codice della scheda di cui questa è doppione (`intake.duplicateOfCode`). */
  duplicateOfCode: string | null;
  /** Oggi, `AAAA-MM-GG`, nel fuso Europe/Rome. */
  today: string;
}

export interface UseCasePhase {
  phase: Phase;
  subState: SubState;
  /** La pillola per i revisori: «Fase · sotto-stato», es. «Chiuso · Doppione di XX-0007»; per «Valutata» `VALUED_PILL`. */
  label: string;
  tone: PhaseTone;
  /** Stato per il cliente, identico a `connectorStatus` sulla stessa riga. */
  connector: ConnectorStatus;
  /** Solo la fase, es. «Da valutare». */
  phaseName: string;
  /** Solo il sotto-stato, es. «T1 2027»; null quando la pillola è la sola fase («Realizzato»). */
  subStateLabel: string | null;
  /** La pillola per i contributori: uguale a `label`, ma mai con il codice di un'altra scheda. */
  contributorLabel: string;
}

/** Nome di ogni fase, come nella pillola. */
export const PHASE_LABEL: Readonly<Record<Phase, string>> = Object.freeze({
  da_valutare: "Da valutare",
  approvato: "Approvato",
  in_realizzazione: "In realizzazione",
  realizzato: "Realizzato",
  chiuso: "Chiuso",
});

/**
 * Testo dei sotto-stati fissi. «trimestre» e «dossier» prendono il testo dal dato (trimestre,
 * stato del dossier); «rimandata» aggiunge la data, «doppione» il codice dell'altra scheda.
 */
export const SUB_STATE_LABEL: Readonly<Record<Exclude<SubState, "trimestre" | "dossier">, string>> = Object.freeze({
  nuova: "Nuova",
  possibile_doppione: "Possibile doppione",
  serve_info: "Serve info",
  valutata: "Valutata",
  rimandata: "Rimandata",
  da_rivedere: "Da rivedere",
  piu_avanti: "Più avanti",
  senza_dossier: "Senza dossier",
  realizzato: "Realizzato",
  diffusa: "Diffusa",
  non_avviato: "Non avviato",
  doppione: "Doppione",
  archiviato: "Archiviato",
});

/** Tono della pillola: puntino più parola, mai solo colore. «Da rivedere» è giallo. */
export const PHASE_TONE: Readonly<Record<Phase, PhaseTone>> = Object.freeze({
  da_valutare: "grigio",
  approvato: "blu",
  in_realizzazione: "blu",
  realizzato: "verde",
  chiuso: "grigio",
});

/** La fase di ogni stato del connettore: l'unica regola che decide la fase. */
export const CONNECTOR_CODE_PHASE: Readonly<Record<ConnectorStatusCode, Phase>> = Object.freeze({
  RICEVUTA: "da_valutare",
  IN_VALUTAZIONE: "da_valutare",
  POSSIBILE_DOPPIONE: "da_valutare",
  SERVONO_INFORMAZIONI: "da_valutare",
  VALUTATA: "da_valutare",
  APPROVATA: "approvato",
  AVVIATA_COME_CASO: "in_realizzazione",
  IN_SVILUPPO: "in_realizzazione",
  REALIZZATA: "realizzato",
  NON_AVVIATA: "chiuso",
  DOPPIONE: "chiuso",
  ARCHIVIATA: "chiuso",
});

const DAY_MONTH = new Intl.DateTimeFormat("it-IT", { timeZone: "UTC", day: "numeric", month: "short" });
const DAY_MONTH_YEAR = new Intl.DateTimeFormat("it-IT", { timeZone: "UTC", day: "numeric", month: "short", year: "numeric" });

/** La data di revisione come giorno `AAAA-MM-GG`; accetta anche un timestamp che inizia così. */
function reviewDay(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const day = value.trim().slice(0, 10);
  return parseIsoDate(day) ? day : null;
}

/** «14 gen»; con l'anno, «14 gen 2027», quando non è l'anno di oggi (come le date delle righe del dossier). */
function dayLabel(day: string, today: string): string {
  const { year, month, day: dd } = parseIsoDate(day)!;
  const date = new Date(Date.UTC(year, month - 1, dd));
  return (day.slice(0, 4) === today.slice(0, 4) ? DAY_MONTH : DAY_MONTH_YEAR).format(date);
}

/** Il codice dell'altra scheda, solo nel formato del contratto (mai testo libero di `intake`). */
function otherCode(i: PhaseInput): string | null {
  for (const raw of [i.duplicateOfCode, i.intake?.duplicateOfCode]) {
    if (typeof raw === "string" && USE_CASE_CODE_PATTERN.test(raw.trim())) return raw.trim();
  }
  return null;
}

interface Refined {
  subState: SubState;
  subStateLabel: string | null;
  /** Sotto-stato per i contributori, se diverso da `subStateLabel`. */
  contributorSubStateLabel?: string | null;
  tone?: PhaseTone;
}

/** Il sotto-stato dentro la fase che ha deciso il connettore. */
function refine(code: ConnectorStatusCode, i: PhaseInput): Refined {
  switch (code) {
    case "RICEVUTA":
    case "IN_VALUTAZIONE":
      return { subState: "nuova", subStateLabel: SUB_STATE_LABEL.nuova };
    case "POSSIBILE_DOPPIONE":
      return { subState: "possibile_doppione", subStateLabel: SUB_STATE_LABEL.possibile_doppione };
    case "SERVONO_INFORMAZIONI":
      return { subState: "serve_info", subStateLabel: SUB_STATE_LABEL.serve_info };
    case "VALUTATA": {
      const present = typeof i.reviewBy === "string" && i.reviewBy.trim() !== "";
      if (!present) return { subState: "valutata", subStateLabel: SUB_STATE_LABEL.valutata };
      const day = reviewDay(i.reviewBy);
      // Una data illeggibile conta come arrivata: la scheda torna davanti al team.
      // Chi l'ha proposta non vede il parcheggio del team: per lui è valutata, da decidere
      // (`VALUED_PILL`), come per il connettore (VALUTATA) e come dice il dialogo «Rimanda».
      if (day === null || day <= i.today) {
        return { subState: "da_rivedere", subStateLabel: SUB_STATE_LABEL.da_rivedere, contributorSubStateLabel: VALUED_PILL, tone: "giallo" };
      }
      return { subState: "rimandata", subStateLabel: `${SUB_STATE_LABEL.rimandata} al ${dayLabel(day, i.today)}`, contributorSubStateLabel: VALUED_PILL };
    }
    case "APPROVATA":
      return isQuarterCode(i.targetQuarter)
        ? { subState: "trimestre", subStateLabel: quarterLabel(i.targetQuarter) }
        : { subState: "piu_avanti", subStateLabel: SUB_STATE_LABEL.piu_avanti };
    case "AVVIATA_COME_CASO":
      return {
        subState: "dossier",
        subStateLabel: i.dossierStatus !== null && Object.hasOwn(CASE_STATUS_LABEL, i.dossierStatus) ? CASE_STATUS_LABEL[i.dossierStatus] : null,
      };
    case "IN_SVILUPPO":
      return { subState: "senza_dossier", subStateLabel: SUB_STATE_LABEL.senza_dossier };
    case "REALIZZATA":
      // «Realizzato» da solo: la pillola non ripete la parola.
      return kindOf(i.portfolioKind) === "da_diffondere"
        ? { subState: "diffusa", subStateLabel: SUB_STATE_LABEL.diffusa }
        : { subState: "realizzato", subStateLabel: null };
    case "NON_AVVIATA":
      return { subState: "non_avviato", subStateLabel: SUB_STATE_LABEL.non_avviato };
    case "DOPPIONE": {
      const other = otherCode(i);
      return {
        subState: "doppione",
        subStateLabel: other ? `${SUB_STATE_LABEL.doppione} di ${other}` : SUB_STATE_LABEL.doppione,
        contributorSubStateLabel: SUB_STATE_LABEL.doppione,
      };
    }
    case "ARCHIVIATA":
      return { subState: "archiviato", subStateLabel: SUB_STATE_LABEL.archiviato };
  }
}

/**
 * La pillola di «Valutata»: «Da valutare · Valutata» si contraddice (è valutata, manca la
 * decisione), quindi la pillola dice «Valutata, da decidere». La fase resta «Da valutare».
 */
export const VALUED_PILL = "Valutata, da decidere";

function pill(phaseName: string, subStateLabel: string | null, subState?: SubState): string {
  if (subState === "valutata") return VALUED_PILL;
  return subStateLabel ? `${phaseName} · ${subStateLabel}` : phaseName;
}

/**
 * Fase, sotto-stato, pillola e tono di uno use case, con lo stato per il cliente.
 * `today` deve essere una data `AAAA-MM-GG` (Europe/Rome): altrimenti `RangeError`.
 */
export function phaseOfUseCase(i: PhaseInput): UseCasePhase {
  if (!parseIsoDate(i.today)) throw new RangeError("today deve essere una data AAAA-MM-GG");
  const connector = connectorStatus(i);
  const phase = CONNECTOR_CODE_PHASE[connector.statusCode];
  const refined = refine(connector.statusCode, i);
  const phaseName = PHASE_LABEL[phase];
  const contributorSubState = refined.contributorSubStateLabel !== undefined ? refined.contributorSubStateLabel : refined.subStateLabel;
  return {
    phase,
    subState: refined.subState,
    label: pill(phaseName, refined.subStateLabel, refined.subState),
    tone: refined.tone ?? PHASE_TONE[phase],
    connector,
    phaseName,
    subStateLabel: refined.subStateLabel,
    contributorLabel: contributorSubState === VALUED_PILL ? VALUED_PILL : pill(phaseName, contributorSubState, refined.subState),
  };
}
