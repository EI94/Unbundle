/**
 * `use-case-admin doctor` (docs/use-case/DESIGN.md §10.5 e §12.2): i controlli prima di
 * accendere l'area per un workspace. Sola lettura. Verde solo se passano tutti:
 *
 * 1. la 0020 è applicata;
 * 2. nessun doppione tra dossier e scheda, con la stessa condizione della 0020 (righe complete
 *    e incomplete);
 * 3. ogni workspace ha la sua riga di `workspace_connector_configs`;
 * 4. nessuna scheda senza codice;
 * 5. nessuna scheda con l'origine ancora da decidere (`origin`);
 * 6. `dossierLinksReady` per ogni workspace, se le tabelle uc ci sono;
 * 7. `scoringVersion` 2 (`scoring-v2` applicato; §12.2 punto 7);
 * 8. `UC_LS_EMAIL_DOMAINS` presente (senza, nessuno risulta di Lateral Space).
 *
 * Un controllo che non si può fare perché manca lo schema conta come non superato. L'uscita non
 * ha email, nomi di persone o valori delle variabili.
 *
 * Modulo puro: solo import relativi `.ts`.
 */
import { counted } from "./cli.ts";


export interface DoctorWorkspace {
  id: string;
  name: string;
  /** Ha la riga di config; `null` senza la 0019. */
  config: boolean | null;
  /** Schede senza codice; `null` senza la 0019. */
  missingCodes: number | null;
  /** Schede con l'origine da decidere; `null` senza la 0020. */
  originPending: number | null;
  /** `dossierLinksReady`; `null` senza tabelle uc (niente da collegare). */
  dossierLinksReady: boolean | null;
  scoringVersion: number;
}

export interface DoctorFacts {
  m0019: boolean;
  m0020: boolean;
  uc: boolean;
  /** Schede con più di un dossier (0 senza tabelle uc). */
  duplicateCards: number;
  lsDomainsSet: boolean;
  workspaces: DoctorWorkspace[];
}

export type DoctorCheckKey =
  | "migrazione_0020"
  | "doppioni"
  | "righe_config"
  | "codici"
  | "origine"
  | "dossier_links"
  | "scoring_v2"
  | "uc_ls_email_domains";

export interface DoctorCheck {
  controllo: DoctorCheckKey;
  ok: boolean;
  dettaglio: string;
}

/** `config.scoringVersion` del modello del workspace: 2 solo se lo dice, altrimenti 1. */
export function scoringVersionOf(value: unknown): number {
  return value === 2 || value === "2" ? 2 : 1;
}

/** I workspace che non passano un controllo, per il dettaglio (al massimo 10 id). */
function failing(workspaces: readonly DoctorWorkspace[], bad: (ws: DoctorWorkspace) => boolean): string {
  const ids = workspaces.filter(bad).map((ws) => ws.id);
  if (ids.length === 0) return "";
  return `${ids.length} workspace: ${ids.slice(0, 10).join(", ")}${ids.length > 10 ? ", …" : ""}`;
}

export function evaluateDoctor(facts: DoctorFacts): { green: boolean; checks: DoctorCheck[] } {
  const ws = facts.workspaces;
  const sum = (pick: (w: DoctorWorkspace) => number | null) => ws.reduce((total, w) => total + (pick(w) ?? 0), 0);
  const checks: DoctorCheck[] = [
    {
      controllo: "migrazione_0020",
      ok: facts.m0020,
      dettaglio: facts.m0020 ? "applicata" : "manca la 0020",
    },
    {
      controllo: "doppioni",
      ok: facts.duplicateCards === 0,
      dettaglio: !facts.uc ? "tabelle uc assenti" : facts.duplicateCards === 0 ? "nessuno" : `${counted(facts.duplicateCards, "scheda", "schede")} con più dossier: dossier-dups`,
    },
    {
      controllo: "righe_config",
      ok: facts.m0019 && ws.every((w) => w.config === true),
      dettaglio: !facts.m0019 ? "manca la 0019" : failing(ws, (w) => w.config !== true) || "tutte presenti",
    },
    {
      controllo: "codici",
      ok: facts.m0019 && ws.every((w) => w.missingCodes === 0),
      dettaglio: !facts.m0019 ? "manca la 0019" : sum((w) => w.missingCodes) === 0 ? "tutti assegnati" : `${counted(sum((w) => w.missingCodes), "scheda", "schede")} senza codice: codes`,
    },
    {
      controllo: "origine",
      ok: facts.m0020 && ws.every((w) => w.originPending === 0),
      dettaglio: !facts.m0020 ? "manca la 0020" : sum((w) => w.originPending) === 0 ? "decisa" : `${counted(sum((w) => w.originPending), "scheda", "schede")} da decidere: origin`,
    },
    {
      controllo: "dossier_links",
      ok: ws.every((w) => w.dossierLinksReady !== false),
      dettaglio: !facts.uc ? "tabelle uc assenti" : failing(ws, (w) => w.dossierLinksReady === false) || "pronti",
    },
    {
      controllo: "scoring_v2",
      ok: ws.every((w) => w.scoringVersion === 2),
      dettaglio: failing(ws, (w) => w.scoringVersion !== 2) || "v2 ovunque",
    },
    {
      controllo: "uc_ls_email_domains",
      ok: facts.lsDomainsSet,
      dettaglio: facts.lsDomainsSet ? "presente" : "assente: nessuno risulta di Lateral Space",
    },
  ];
  return { green: checks.every((check) => check.ok), checks };
}
