/**
 * La linea dell'Agent Factory di un cliente (rilascio 8.1a, docs/rilascio-8/RILASCIO-8.1-COSTRUZIONE.md §2): dove sta
 * ogni caso, il prossimo passo, le famiglie e la coda della fabbrica. Senza database.
 *
 * - La stazione si ricava da dossier, progetto e compiti. La fase del dossier resta una decisione delle persone:
 *   qui si legge soltanto.
 * - Le famiglie sono i repository: un caso senza repository è «da avviare».
 * - La coda della fabbrica, al posto dei turni, è il lavoro sulla fabbrica stessa: per ora i repository rimasti
 *   indietro con il modello. La prende chi ci lavora.
 * - Mai una cifra per persona: i compiti si contano per caso.
 * - (8.2a) Le evals e il banco di prova del caso in un frammento breve: «evals 96%», «evals 80%, sotto soglia»,
 *   «evals 62% su tj-0049/t-3, sotto soglia» (il ramo, quando non è main), «il banco consiglia Claude Haiku 5.5 per
 *   «lettura»».
 *
 * Modulo puro.
 */
import type { CaseStatus } from "../../uc/vocab.ts";
import { EVALS_MAIN, formatQuality, modelLabel, type BenchVerdict } from "./benchmark.ts";

/**
 * La versione del repository modello di oggi: si aggiorna qui quando ne esce una (`CHANGELOG.md` del modello). La 1.4.0
 * porta `unbundle eval` e `unbundle banco`: il numero cambia nello stesso rilascio in cui il modello 1.4.0 arriva sul suo
 * main, mai prima (la coda manderebbe ad aggiornare a una versione che «unbundle aggiorna» non porta ancora).
 * (8.0c) La 1.5.0: la CLI decide se si scrive dal campo `scrive` di `unbundle context` (con chi costruisce da fuori, non
 * più solo l'elenco dei ruoli di Lateral Space). Il modello 1.5.0 si unisce prima del rilascio 8.0c.
 */
export const AGENT_FACTORY_TEMPLATE_VERSION = "1.5.0";

export const STATIONS = ["dossier", "impostazione", "approvato", "costruzione", "collaudo", "esercizio"] as const;
export type Station = (typeof STATIONS)[number];

export const STATION_LABEL: Readonly<Record<Station, string>> = {
  dossier: "Da impostare",
  impostazione: "Impostazione",
  approvato: "Approvato",
  costruzione: "Costruzione",
  collaudo: "Collaudo",
  esercizio: "Esercizio",
};

export interface LineCase {
  dossierStatus: CaseStatus;
  /** Lo stato del progetto più avanti: approvato vince su in corso. Null senza progetto. */
  projectStatus: "in_corso" | "da_approvare" | "approvato" | null;
  tasks: { total: number; open: number; inProgress: number; inReview: number; done: number; cancelled: number };
}

/** La stazione di un caso. */
export function stationOf(c: LineCase): Station {
  if (c.dossierStatus === "in_esercizio" || c.dossierStatus === "misura_roi") return "esercizio";
  if (c.dossierStatus === "collaudo" || c.dossierStatus === "backtest" || c.dossierStatus === "stabilizzazione") return "collaudo";
  if (c.projectStatus === "approvato") {
    const live = c.tasks.total - c.tasks.cancelled;
    if (live === 0) return "approvato";
    return c.tasks.done >= live ? "collaudo" : "costruzione";
  }
  if (c.projectStatus === "in_corso" || c.projectStatus === "da_approvare") return "impostazione";
  return "dossier";
}

/** Il prossimo passo di un caso, in una frase breve. */
export function nextStepOf(c: LineCase): string {
  const station = stationOf(c);
  if (station === "esercizio") return "In esercizio.";
  if (station === "collaudo") return c.dossierStatus === "collaudo" || c.dossierStatus === "backtest" || c.dossierStatus === "stabilizzazione" ? "Collaudo con il cliente." : "Compiti fatti: pronto per il collaudo.";
  if (station === "dossier") return "Impostare il caso con il coding agent.";
  if (station === "impostazione") return c.projectStatus === "da_approvare" ? "Il progetto aspetta l'approvazione." : "Finire l'impostazione e mandarla in approvazione.";
  if (station === "approvato") return "Portare i compiti in Unbundle («compiti importa»).";
  if (c.tasks.open > 0) return c.tasks.open === 1 ? "1 compito da prendere." : `${c.tasks.open} compiti da prendere.`;
  return c.tasks.inReview > 0 ? "Compiti in revisione." : "Compiti in corso.";
}

/** Quanti casi in ogni stazione, nell'ordine della linea. */
export function lineCounts(cases: readonly LineCase[]): { station: Station; count: number }[] {
  const counts = new Map<Station, number>(STATIONS.map((s) => [s, 0]));
  for (const c of cases) counts.set(stationOf(c), (counts.get(stationOf(c)) ?? 0) + 1);
  return STATIONS.map((station) => ({ station, count: counts.get(station) ?? 0 }));
}

/** Confronto di due versioni `a.b.c`: negativo se `a` è più vecchia. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

export interface FactoryRepoState {
  repo: string;
  templateVersion: string | null;
}

/** La coda della fabbrica: i repository indietro con il modello (o di cui non si sa ancora la versione). */
export function factoryQueue(repos: readonly FactoryRepoState[], latest: string = AGENT_FACTORY_TEMPLATE_VERSION): { repo: string; text: string }[] {
  return repos
    .filter((r) => r.templateVersion === null || compareVersions(r.templateVersion, latest) < 0)
    .map((r) => ({
      repo: r.repo,
      text: r.templateVersion
        ? `Ha il modello ${r.templateVersion}, c'è il ${latest}: «unbundle aggiorna» apre la pull request.`
        : `Non so ancora che versione del modello abbia: la dice il prossimo «unbundle start», oppure «unbundle aggiorna».`,
    }))
    .sort((a, b) => a.repo.localeCompare(b.repo));
}

/** (8.2a) Le evals di un caso come le dice la riga della pagina. */
export interface LineEvals {
  quality: number;
  thresholdsMet: boolean;
  fakeModels: boolean;
  /** Il ramo delle evals: un caso senza evals di main mostra quelle di un altro ramo, e la riga lo dice. */
  branch: string | null;
}

/**
 * (8.2a) Le evals in un frammento: «evals 96%», «evals 80%, sotto soglia»; il ramo quando non è main («evals 62% su
 * tj-0049/t-3, sotto soglia», «senza ramo» se non si sa); con i modelli finti lo dice.
 */
export function evalsFact(e: LineEvals | null): string | null {
  if (!e) return null;
  const branch = e.branch === EVALS_MAIN ? "" : e.branch ? ` su ${e.branch}` : " senza ramo";
  return `evals ${formatQuality(e.quality)}${branch}${e.thresholdsMet ? "" : ", sotto soglia"}${e.fakeModels ? ", modelli finti" : ""}`;
}

/**
 * (8.2a) Il consiglio del banco, un ruolo alla volta: «il banco consiglia Claude Haiku 5.5 per «lettura»». Mai quello di
 * un banco superato (`superseded`: il consiglio è stato seguito, o il ruolo non c'è più).
 */
export function benchFacts(benches: readonly { role: string; verdict: BenchVerdict; superseded?: boolean }[]): string[] {
  return benches.flatMap((b) => (b.verdict.kind === "cambia" && !b.superseded ? [`il banco consiglia ${modelLabel(b.verdict.model)} per «${b.role}»`] : []));
}

/** (8.2a) «Da fare per te»: le evals sotto soglia, con la qualità. La pagina ha i gruppi (non le singole prove). */
export function evalsTodoText(quality: number): string {
  return `Le evals di main sono sotto soglia (${formatQuality(quality)}): guarda quali gruppi non passano.`;
}
