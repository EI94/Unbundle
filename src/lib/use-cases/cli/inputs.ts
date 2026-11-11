/**
 * Gli ingressi delle scritture della CLI e dell'MCP del caso (rilascio 8.0b), controllati prima del database con gli
 * stessi limiti dei CHECK della 0031: una richiesta sbagliata riceve un messaggio chiaro, mai un errore 500.
 *
 * - **La sintesi di una sessione:** solo numeri, il compito (`T-n`), il modello, la PR su GitHub, il ramo. La chiave
 *   è l'impronta dell'id della sessione calcolata dalla CLI: l'id vero non arriva mai.
 * - **Il repository:** `owner/nome`, la cartella `casi/<id>`, il profilo del catalogo, il progetto Vercel.
 *
 * Modulo puro: import relativi `.ts`.
 */
import { BUILD_HARNESSES, BUILD_OUTCOMES, CLI_LIMITS, type BuildHarness, type BuildOutcome } from "../../db/use-case-hub-cli-ddl.ts";
import { FACTORY_FRAMEWORKS, type FactoryFramework } from "../../db/use-case-hub-factory-ddl.ts";

export type InputResult<T> = { ok: true; value: T } | { ok: false; message: string };

const L = CLI_LIMITS;
const bad = <T>(message: string): InputResult<T> => ({ ok: false, message });

export interface BuildSessionInput {
  sessionKey: string;
  taskRef: string | null;
  harness: BuildHarness;
  model: string | null;
  inputTokens: number;
  outputTokens: number;
  cacheTokens: number;
  costUsd: number | null;
  durationSeconds: number;
  outcome: BuildOutcome;
  prUrl: string | null;
  branch: string | null;
  endedAt: string;
}

const count = (value: unknown, label: string): InputResult<number> => {
  if (value === undefined || value === null) return { ok: true, value: 0 };
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > L.tokensMax) return bad(`${label}: un numero intero da 0 a ${L.tokensMax}.`);
  return { ok: true, value };
};

/** Il corpo di `POST /api/cli/sessioni` (nomi italiani, come la CLI li manda). */
export function parseBuildSession(body: Record<string, unknown>, now = new Date()): InputResult<BuildSessionInput> {
  const sessionKey = body.chiaveSessione;
  if (typeof sessionKey !== "string" || !/^[0-9a-f]{64}$/.test(sessionKey)) return bad("chiaveSessione: l'impronta SHA-256 dell'id della sessione, 64 caratteri esadecimali.");
  const task = body.compito ?? null;
  if (task !== null && (typeof task !== "string" || !/^T-[0-9]{1,4}$/.test(task))) return bad("compito: come «T-3», oppure niente.");
  const harness = body.harness;
  if (!BUILD_HARNESSES.includes(harness as BuildHarness)) return bad(`harness: uno tra ${BUILD_HARNESSES.join(", ")}.`);
  const model = body.modello ?? null;
  if (model !== null && (typeof model !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,79}$/.test(model))) return bad("modello: un nome di modello, al massimo 80 caratteri.");
  const input = count(body.tokenIngresso, "tokenIngresso");
  if (!input.ok) return input;
  const output = count(body.tokenUscita, "tokenUscita");
  if (!output.ok) return output;
  const cache = count(body.tokenCache, "tokenCache");
  if (!cache.ok) return cache;
  const cost = body.costoUsd ?? null;
  if (cost !== null && (typeof cost !== "number" || !Number.isFinite(cost) || cost < 0 || cost > L.costUsdMax)) return bad(`costoUsd: un numero da 0 a ${L.costUsdMax}, oppure niente.`);
  const duration = body.durataSecondi;
  if (typeof duration !== "number" || !Number.isInteger(duration) || duration < 0 || duration > L.durationSecondsMax) return bad("durataSecondi: un numero intero di secondi, al massimo una settimana.");
  const outcome = body.esito;
  if (!BUILD_OUTCOMES.includes(outcome as BuildOutcome)) return bad(`esito: uno tra ${BUILD_OUTCOMES.join(", ")}.`);
  const pr = body.pr ?? null;
  if (pr !== null && (typeof pr !== "string" || pr.length > L.prUrl || !/^https:\/\/github\.com\/[A-Za-z0-9-]{1,39}\/[A-Za-z0-9._-]{1,100}\/pull\/[0-9]{1,9}$/.test(pr))) {
    return bad("pr: l'indirizzo di una pull request su GitHub, oppure niente.");
  }
  const branch = body.ramo ?? null;
  if (branch !== null && (typeof branch !== "string" || branch.length > L.branch || !/^[A-Za-z0-9._/-]+$/.test(branch))) return bad("ramo: il nome di un ramo git, al massimo 120 caratteri.");
  const ended = body.finitaIl;
  const endedAt = typeof ended === "string" ? new Date(ended) : null;
  if (!endedAt || Number.isNaN(endedAt.getTime())) return bad("finitaIl: una data e un'ora ISO.");
  if (endedAt.getTime() > now.getTime() + 5 * 60_000) return bad("finitaIl: non può essere nel futuro.");
  return {
    ok: true,
    value: {
      sessionKey,
      taskRef: task as string | null,
      harness: harness as BuildHarness,
      model: model as string | null,
      inputTokens: input.value,
      outputTokens: output.value,
      cacheTokens: cache.value,
      costUsd: cost as number | null,
      durationSeconds: duration,
      outcome: outcome as BuildOutcome,
      prUrl: pr as string | null,
      branch: branch as string | null,
      endedAt: endedAt.toISOString(),
    },
  };
}

export interface CaseRepoInput {
  repo: string;
  folder: string;
  profile: FactoryFramework | null;
  vercelProject: string | null;
}

/** Il corpo di `POST /api/cli/repository`. */
export function parseCaseRepo(body: Record<string, unknown>): InputResult<CaseRepoInput> {
  const repo = body.repository;
  if (typeof repo !== "string" || repo.length > L.repo || !/^[A-Za-z0-9][A-Za-z0-9-]{0,38}\/[A-Za-z0-9._-]{1,100}$/.test(repo)) return bad("repository: «owner/nome», come su GitHub.");
  const folder = body.cartella;
  if (typeof folder !== "string" || !/^casi\/[a-z0-9][a-z0-9-]{0,40}$/.test(folder)) return bad("cartella: «casi/<id del caso>», in minuscolo.");
  const profile = body.profilo ?? null;
  if (profile !== null && !FACTORY_FRAMEWORKS.includes(profile as FactoryFramework)) return bad(`profilo: uno tra ${FACTORY_FRAMEWORKS.join(", ")}, oppure niente.`);
  const vercel = body.progettoVercel ?? null;
  if (vercel !== null && (typeof vercel !== "string" || !/^[a-z0-9][a-z0-9._-]{0,99}$/.test(vercel))) return bad("progettoVercel: il nome del progetto su Vercel, oppure niente.");
  return { ok: true, value: { repo, folder, profile: profile as FactoryFramework | null, vercelProject: vercel as string | null } };
}
