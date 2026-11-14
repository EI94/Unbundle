/**
 * Gli eventi di GitHub per la fabbrica (rilascio 8.1b, docs/rilascio-8/RILASCIO-8.1-COSTRUZIONE.md §2, 8.1b).
 *
 * - `verifyGithubSignature`: la firma `X-Hub-Signature-256` (HMAC SHA-256 del corpo con il segreto del webhook), in
 *   tempo costante. Senza firma giusta non si legge niente.
 * - `parseGithubEvent`: dal corpo di GitHub solo quello che serve, controllato. Una PR: repository, numero, ramo,
 *   stato, bozza, date. Un push: repository e ramo. Mai chi l'ha fatto: si legge per caso, mai per persona (art. 15.4).
 *   Le PR da un fork non contano (il ramo potrebbe fingere un compito).
 * - `caseCodeFromBranch`: il caso dal ramo `<id>/…`, come `daRamo` della CLI del modello.
 * - (Proposte) Un'issue aperta, o un commento che comincia con `/compito`, diventa una proposta di compito: il titolo
 *   (dell'issue, o il resto della riga di `/compito`), le etichette e i codici dei casi nel testo per capire di quale
 *   caso è. Mai il corpo dell'issue, mai chi l'ha scritta. Le issue e i commenti dei bot non contano.
 *
 * Modulo puro: niente database, niente rete.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import type { PullRequestState } from "../../db/use-case-hub-github-ddl.ts";
import { taskRefFromBranch } from "./tasks.ts";

/** Il corpo più grande che si legge (sotto il limite di Vercel; le PR e i push della fabbrica stanno molto sotto). */
export const GITHUB_BODY_MAX_BYTES = 4 * 1024 * 1024;

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
      /** L'ora di GitHub di questo stato della PR: un evento più vecchio di quello già applicato non cambia niente. */
      updatedAt: string | null;
      /** L'azione di GitHub: `opened`, `closed`, … */
      action: string;
      reopened: boolean;
      signal: boolean;
      ready: boolean;
    }
  | { kind: "push"; repo: string; branch: string }
  | {
      kind: "proposta";
      repo: string;
      /** Il numero dell'issue (o della PR, per un commento su una PR). */
      number: number;
      /** Il commento `/compito`, se la proposta viene da lì. */
      commentId: number | null;
      title: string;
      /** I codici dei casi nel titolo e nelle etichette (`TJ-0049`), in maiuscolo. */
      caseCodes: string[];
      onPullRequest: boolean;
    }
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
    // Unita conta solo nel ramo principale: una PR unita in un altro ramo (una pila di PR) non porta il lavoro in main.
    const base = isRecord(pr.base) ? str(pr.base.ref) : null;
    const defaultBranch = isRecord(payload.repository) ? str(payload.repository.default_branch) : null;
    const intoDefault = defaultBranch === null || base === defaultBranch;
    const state: PullRequestState = open ? "aperta" : mergedAt && intoDefault ? "unita" : "chiusa";
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
      updatedAt: isoOrNull(pr.updated_at),
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
  if (event === "issues" || event === "issue_comment") return parseProposal(event, payload, repo);
  return { kind: "altro", repo, reason: "evento_non_usato" };
}

const TITLE_MAX = 200;
const CASE_CODE_G = /\b([A-Za-z]{2,6}-\d{3,5})\b/g;

/** I codici dei casi in un testo, in maiuscolo, senza doppioni. */
export function caseCodesIn(...texts: string[]): string[] {
  const out = new Set<string>();
  for (const text of texts) for (const m of text.matchAll(CASE_CODE_G)) out.add(m[1].toUpperCase());
  return [...out];
}

/** Il titolo della proposta da `/compito …`: solo se la prima riga non vuota del commento comincia con `/compito`. */
export function compitoCommand(body: string): { title: string } | null {
  const first = body.split("\n").find((line) => line.trim() !== "") ?? "";
  const m = /^[ \t]*\/compito\b[ \t]*(.*)$/.exec(first);
  return m ? { title: m[1].trim() } : null;
}

/** Chi può proporre: chi ha accesso al repository (proprietario, membro, collaboratore; in un repository privato anche
 * chi ci ha già contribuito). Solo un controllo: non si salva mai chi è. */
const PROPOSERS = new Set(["OWNER", "MEMBER", "COLLABORATOR"]);
function mayPropose(association: unknown, privateRepo: boolean): boolean {
  return typeof association === "string" && (PROPOSERS.has(association) || (privateRepo && association === "CONTRIBUTOR"));
}

/** Taglia a `max` caratteri senza spezzare un'emoji (le coppie UTF-16). */
export function cutText(text: string, max: number): string {
  const chars = Array.from(text);
  return chars.length <= max ? text : chars.slice(0, max).join("");
}

function parseProposal(event: string, payload: Record<string, unknown>, repo: string | null): GithubEvent {
  if (!repo) return { kind: "altro", repo, reason: "proposta_non_valida" };
  const action = str(payload.action);
  const issue = isRecord(payload.issue) ? payload.issue : null;
  const sender = isRecord(payload.sender) ? payload.sender : null;
  if (sender?.type === "Bot") return { kind: "altro", repo, reason: "bot" };
  const number = issue && typeof issue.number === "number" && Number.isInteger(issue.number) && issue.number >= 1 && issue.number <= 999_999_999 ? issue.number : null;
  const issueTitle = issue ? (str(issue.title) ?? "").trim() : "";
  if (number === null) return { kind: "altro", repo, reason: "proposta_non_valida" };
  const labels = issue && Array.isArray(issue.labels) ? issue.labels.map((l) => (isRecord(l) ? (str(l.name) ?? "") : "")).filter(Boolean) : [];
  const onPullRequest = Boolean(issue && isRecord(issue.pull_request));
  let title = issueTitle;
  let commentId: number | null = null;
  const privateRepo = isRecord(payload.repository) && payload.repository.private === true;
  if (event === "issues") {
    if (action !== "opened") return { kind: "altro", repo, reason: "azione_non_usata" };
    if (onPullRequest) return { kind: "altro", repo, reason: "azione_non_usata" };
    if (!mayPropose(issue?.author_association, privateRepo)) return { kind: "altro", repo, reason: "autore_senza_accesso" };
  } else {
    if (action !== "created") return { kind: "altro", repo, reason: "azione_non_usata" };
    const comment = isRecord(payload.comment) ? payload.comment : null;
    const command = compitoCommand(comment ? (str(comment.body) ?? "") : "");
    if (!comment || !command) return { kind: "altro", repo, reason: "commento_senza_compito" };
    if (!mayPropose(comment.author_association, privateRepo)) return { kind: "altro", repo, reason: "autore_senza_accesso" };
    commentId = typeof comment.id === "number" && Number.isInteger(comment.id) && comment.id > 0 ? comment.id : null;
    if (commentId === null) return { kind: "altro", repo, reason: "proposta_non_valida" };
    if (command.title) title = command.title;
  }
  title = cutText(title.replace(/\s+/g, " ").trim(), TITLE_MAX);
  if (!title) return { kind: "altro", repo, reason: "proposta_senza_titolo" };
  return { kind: "proposta", repo, number, commentId, title, caseCodes: caseCodesIn(title, issueTitle, ...labels), onPullRequest };
}

/**
 * Il JSON dell'evento dal corpo: `application/json`, o il modulo di GitHub (`payload=…`) se il webhook è rimasto con il
 * tipo di contenuto predefinito. La firma vale sul corpo così com'è, in entrambi i casi.
 */
export function githubPayloadText(contentType: string | null, body: string): string | null {
  if ((contentType ?? "").toLowerCase().startsWith("application/x-www-form-urlencoded")) return new URLSearchParams(body).get("payload");
  return body;
}

/** L'indirizzo dell'issue o del commento, fatto da repository, numero e id (mai quello del corpo). */
export function proposalUrl(repo: string, number: number, commentId: number | null): string {
  return `https://github.com/${repo}/issues/${number}${commentId ? `#issuecomment-${commentId}` : ""}`;
}

/** L'indirizzo della PR, fatto da repository e numero (mai quello del corpo). */
export function pullRequestUrl(repo: string, number: number): string {
  return `https://github.com/${repo}/pull/${number}`;
}
