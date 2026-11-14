/**
 * Gli eventi di GitHub per la fabbrica (rilascio 8.1b, docs/rilascio-8/RILASCIO-8.1-COSTRUZIONE.md §2, 8.1b).
 *
 * - `verifyGithubSignature`: la firma `X-Hub-Signature-256` (HMAC SHA-256 del corpo con il segreto del webhook), in
 *   tempo costante. Senza firma giusta non si legge niente.
 * - `parseGithubEvent`: dal corpo di GitHub solo quello che serve, controllato. Una PR: repository, numero, ramo,
 *   stato, bozza, date. Un push: repository e ramo. Mai chi l'ha fatto: si legge per caso, mai per persona (art. 15.4).
 *   Le PR da un fork non contano (il ramo potrebbe fingere un compito).
 * - `caseCodeFromBranch`: il caso dal ramo `<id>/…`, come `daRamo` della CLI del modello.
 *
 * Modulo puro: niente database, niente rete.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import type { PullRequestState } from "../../db/use-case-hub-github-ddl.ts";
import { taskRefFromBranch } from "./tasks.ts";

/** Il corpo più grande che si legge (le PR e i push della fabbrica stanno molto sotto). */
export const GITHUB_BODY_MAX_BYTES = 5 * 1024 * 1024;

export const GITHUB_DELIVERY_RE = /^[A-Za-z0-9-]{1,64}$/;
const REPO_RE = /^[A-Za-z0-9][A-Za-z0-9-]{0,38}\/[A-Za-z0-9._-]{1,100}$/;
const EVENT_RE = /^[a-z_]{1,40}$/;
const BRANCH_MAX = 120;

/** Vero se la firma è quella del corpo con il segreto. Il confronto è in tempo costante. */
export function verifyGithubSignature(secret: string, body: string | Uint8Array, header: string | null): boolean {
  if (!secret || !header || !/^sha256=[0-9a-f]{64}$/.test(header)) return false;
  const expected = createHmac("sha256", secret).update(body).digest();
  const given = Buffer.from(header.slice("sha256=".length), "hex");
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/** Il nome dell'evento, se ha la forma di GitHub (`pull_request`, `push`, …). */
export function githubEventName(header: string | null): string | null {
  return header && EVENT_RE.test(header) ? header : null;
}

/** Il caso (`tj-0049`) dal ramo `tj-0049/t-3-titolo` o `tj-0049/qualcosa`; null se il ramo non è di un caso. */
export function caseCodeFromBranch(branch: string): string | null {
  return /^([a-z0-9]{2,6}-\d{3,5})\//i.exec(branch)?.[1]?.toLowerCase() ?? null;
}

/** Il compito (`T-3`) dal ramo, se è di quel caso. */
export function taskRefOfBranch(branch: string, caseCode: string): string | null {
  return taskRefFromBranch(branch, caseCode);
}

/** Le azioni di una PR che dicono che qualcuno ci sta lavorando (un segnale di vita per il compito). */
const SIGNAL_ACTIONS = new Set(["opened", "reopened", "ready_for_review", "synchronize"]);
/** Le azioni che rendono una PR pronta da rivedere (la notifica al team). */
const READY_ACTIONS = new Set(["opened", "reopened", "ready_for_review"]);

export type GithubEvent =
  | { kind: "ping" }
  | {
      kind: "pr";
      repo: string;
      number: number;
      branch: string;
      state: PullRequestState;
      draft: boolean;
      openedAt: string | null;
      mergedAt: string | null;
      closedAt: string | null;
      /** L'azione di GitHub: `opened`, `closed`, … */
      action: string;
      reopened: boolean;
      signal: boolean;
      ready: boolean;
    }
  | { kind: "push"; repo: string; branch: string }
  | { kind: "altro"; repo: string | null; reason: string };

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown) => (typeof v === "string" ? v : null);
const isoOrNull = (v: unknown) => {
  const s = str(v);
  if (!s || s.length > 40) return null;
  const t = Date.parse(s);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
};
const okBranch = (b: string | null): b is string => b !== null && b.trim().length > 0 && b.length <= BRANCH_MAX && !/[\s\0]/.test(b);

function repoOf(payload: Record<string, unknown>): string | null {
  const r = isRecord(payload.repository) ? str(payload.repository.full_name) : null;
  return r && REPO_RE.test(r) ? r : null;
}

/** Dall'evento e dal corpo, quello che serve; tutto il resto si scarta. */
export function parseGithubEvent(event: string, payload: unknown): GithubEvent {
  if (event === "ping") return { kind: "ping" };
  if (!isRecord(payload)) return { kind: "altro", repo: null, reason: "corpo_non_valido" };
  const repo = repoOf(payload);
  if (event === "pull_request") {
    const pr = payload.pull_request;
    const action = str(payload.action) ?? "";
    if (!repo || !isRecord(pr)) return { kind: "altro", repo, reason: "pr_non_valida" };
    const number = typeof pr.number === "number" && Number.isInteger(pr.number) && pr.number >= 1 && pr.number <= 999_999_999 ? pr.number : null;
    const head = isRecord(pr.head) ? pr.head : null;
    const branch = head ? str(head.ref) : null;
    const headRepo = head && isRecord(head.repo) ? str(head.repo.full_name) : null;
    if (number === null || !okBranch(branch) || !/^[a-z_]{1,40}$/.test(action)) return { kind: "altro", repo, reason: "pr_non_valida" };
    if (headRepo !== repo) return { kind: "altro", repo, reason: "fork" };
    const mergedAt = isoOrNull(pr.merged_at);
    const open = pr.state === "open";
    const state: PullRequestState = open ? "aperta" : mergedAt ? "unita" : "chiusa";
    return {
      kind: "pr",
      repo,
      number,
      branch,
      state,
      draft: pr.draft === true,
      openedAt: isoOrNull(pr.created_at),
      mergedAt: state === "unita" ? mergedAt : null,
      closedAt: open ? null : isoOrNull(pr.closed_at),
      action,
      reopened: action === "reopened",
      signal: SIGNAL_ACTIONS.has(action),
      ready: open && pr.draft !== true && READY_ACTIONS.has(action),
    };
  }
  if (event === "push") {
    if (!repo) return { kind: "altro", repo, reason: "push_non_valido" };
    const ref = str(payload.ref);
    if (!ref?.startsWith("refs/heads/")) return { kind: "altro", repo, reason: "non_un_ramo" };
    if (payload.deleted === true) return { kind: "altro", repo, reason: "ramo_cancellato" };
    const branch = ref.slice("refs/heads/".length);
    if (!okBranch(branch)) return { kind: "altro", repo, reason: "push_non_valido" };
    return { kind: "push", repo, branch };
  }
  return { kind: "altro", repo, reason: "evento_non_usato" };
}

/** L'indirizzo della PR, fatto da repository e numero (mai quello del corpo). */
export function pullRequestUrl(repo: string, number: number): string {
  return `https://github.com/${repo}/pull/${number}`;
}
