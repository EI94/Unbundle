/**
 * I compiti di un caso (rilascio 8.1a, docs/rilascio-8/RILASCIO-8.1-COSTRUZIONE.md §2): le regole, senza database.
 *
 * - **`compiti.md`:** nel repository lo scrive l'impostazione; da lì i compiti entrano in Unbundle
 *   (`parseTasksMarkdown`, poi `planTaskImport`). Da quel momento la fonte è Unbundle: `renderTasksMarkdown`
 *   riscrive il file come specchio, senza nomi di persone.
 * - **L'importazione** crea i compiti nuovi e aggiorna titolo, aree, ore e prove di quelli che ci sono. Lo stato lo
 *   cambia solo per dire «fatto», per esempio dalla PR unita, e mai all'indietro. Non cancella niente: un compito
 *   che c'è solo in Unbundle resta.
 * - **Le aree** sono percorsi nel repository. Due compiti si sovrappongono se un'area dell'uno contiene un'area
 *   dell'altro (`areasOverlap`): `take` lo dice prima di prendere.
 * - **Il compito fermo** (`staleStep`): dopo 2 giorni lavorativi senza segnali si chiede a chi lo ha, dopo altri
 *   2 lo si dice al responsabile del caso. Non si riassegna mai da solo.
 *
 * Modulo puro.
 */
import { workingDaysBetween } from "../../uc/calendar.ts";
import { TASK_LIMITS, type TaskStatus } from "../../db/use-case-hub-tasks-ddl.ts";

export const TASK_REF_RE = /^T-[1-9][0-9]{0,3}$/;

/** Un compito come sta in `compiti.md`. */
export interface TaskDraft {
  ref: string;
  title: string;
  areas: string[];
  estimateHours: number | null;
  evidence: string | null;
  /** Solo quello che il file può dire: fatto (`[x]`), annullato, oppure niente. */
  done: boolean;
  cancelled: boolean;
}

/** Un compito come sta in Unbundle. */
export interface TaskRow {
  id: string;
  ref: string;
  title: string;
  areas: string[];
  estimateHours: number | null;
  evidence: string | null;
  status: TaskStatus;
  holderUserId: string | null;
  takenAt: string | null;
  lastActivityAt: string | null;
  staleAskedAt: string | null;
  staleEscalatedAt: string | null;
}

// ─── compiti.md ──────────────────────────────────────────────────────

/** Le cartelle in testa a un'area che non è del caso; il resto è dentro `casi/<id>/`. */
const REPO_ROOTS = ["casi/", "componenti/", "strumenti/", "profili/", "plugin/", "catalogo/", ".github/", "docs/"];
const STATUS_WORDS: Readonly<Record<string, TaskStatus>> = { fatto: "fatto", "in corso": "in_corso", "in revisione": "in_revisione", annullato: "annullato" };
const LINE = /^\s*[-*]\s+\[( |x|X)\]\s+(T-\d{1,4})\s+(.*)$/;

/** Un'area come percorso nel repository: senza `./`, senza spazi; dentro il caso se non parte da una cartella del repository. */
export function normalizeArea(area: string, caseFolder: string): string | null {
  const clean = area.trim().replace(/^\.\//, "").replace(/\s+/g, "");
  if (!clean || clean.length > TASK_LIMITS.area || clean.split("/").includes("..") || clean.startsWith("/")) return null;
  const full = REPO_ROOTS.some((root) => clean.startsWith(root)) ? clean : `${caseFolder.replace(/\/$/, "")}/${clean}`;
  return full.length <= TASK_LIMITS.area ? full : null;
}

/**
 * I compiti di `compiti.md`: le righe `- [ ] T-n Titolo · 8 h · aree: a, b · prove: …`, con `[x]` per i fatti. Le
 * righe che non sono compiti si saltano; un riferimento ripetuto vale la prima volta.
 */
export function parseTasksMarkdown(text: string, caseFolder: string): TaskDraft[] {
  const out: TaskDraft[] = [];
  const seen = new Set<string>();
  for (const line of text.split("\n")) {
    const m = LINE.exec(line);
    if (!m) continue;
    const ref = m[2];
    if (!TASK_REF_RE.test(ref) || seen.has(ref)) continue;
    const parts = m[3].split(" · ").map((p) => p.trim());
    const title = (parts.shift() ?? "").slice(0, TASK_LIMITS.title).trim();
    if (!title) continue;
    let estimateHours: number | null = null;
    let areas: string[] = [];
    let evidence: string | null = null;
    let cancelled = false;
    let done = m[1].toLowerCase() === "x";
    for (const part of parts) {
      const hours = /^(\d{1,4}(?:[.,]\d)?)\s*h$/i.exec(part);
      if (hours) estimateHours = Math.min(TASK_LIMITS.hoursMax, Number(hours[1].replace(",", ".")));
      else if (/^aree:/i.test(part)) {
        areas = part
          .replace(/^aree:\s*/i, "")
          .split(",")
          .map((a) => normalizeArea(a, caseFolder))
          .filter((a): a is string => a !== null)
          .slice(0, TASK_LIMITS.areasMax);
      } else if (/^prove:/i.test(part)) {
        const value = part.replace(/^prove:\s*/i, "").trim();
        evidence = value && value !== "—" && value !== "-" ? value.slice(0, TASK_LIMITS.evidence) : null;
      } else if (STATUS_WORDS[part.toLowerCase()] === "annullato") cancelled = true;
      else if (STATUS_WORDS[part.toLowerCase()] === "fatto") done = true;
    }
    seen.add(ref);
    out.push({ ref, title, areas: [...new Set(areas)], estimateHours, evidence, done, cancelled });
  }
  return out;
}

const STATUS_SUFFIX: Readonly<Record<TaskStatus, string | null>> = { da_fare: null, in_corso: "in corso", in_revisione: "in revisione", fatto: null, annullato: "annullato" };

/** Le aree come le scrive il file: quelle del caso senza `casi/<id>/`. */
function shortArea(area: string, caseFolder: string): string {
  const prefix = `${caseFolder.replace(/\/$/, "")}/`;
  return area.startsWith(prefix) ? area.slice(prefix.length) : area;
}

const byRef = (a: { ref: string }, b: { ref: string }) => Number(a.ref.slice(2)) - Number(b.ref.slice(2));

/** Lo specchio di `compiti.md`, da Unbundle: nessun nome di persona, lo stato in fondo alla riga. */
export function renderTasksMarkdown(caseCode: string, caseFolder: string, tasks: readonly Pick<TaskRow, "ref" | "title" | "areas" | "estimateHours" | "evidence" | "status">[]): string {
  const lines = [...tasks].sort(byRef).map((t) => {
    const parts = [`${t.ref} ${t.title}`];
    if (t.estimateHours !== null) parts.push(`${String(t.estimateHours).replace(".", ",")} h`);
    if (t.areas.length) parts.push(`aree: ${t.areas.map((a) => shortArea(a, caseFolder)).join(", ")}`);
    if (t.evidence) parts.push(`prove: ${t.evidence}`);
    const suffix = STATUS_SUFFIX[t.status];
    if (suffix) parts.push(suffix);
    return `- [${t.status === "fatto" ? "x" : " "}] ${parts.join(" · ")}`;
  });
  return [
    `# ${caseCode} · Compiti`,
    "",
    "Questo file lo scrive Unbundle con `unbundle start`: non modificarlo a mano. I compiti si vedono con `unbundle compiti`, si prendono con `unbundle take` e si passano con `unbundle lascia` o `unbundle passa`.",
    "",
    ...lines,
    "",
  ].join("\n");
}

// ─── L'importazione ──────────────────────────────────────────────────

export type TaskImportOp =
  | { kind: "nuovo"; draft: TaskDraft; status: "da_fare" | "fatto" | "annullato" }
  | { kind: "aggiornato"; id: string; ref: string; changes: Partial<Pick<TaskDraft, "title" | "areas" | "estimateHours" | "evidence">>; status: TaskStatus | null };

export interface TaskImportPlan {
  ops: TaskImportOp[];
  unchanged: string[];
  /** I compiti che ci sono solo in Unbundle: restano. */
  onlyInUnbundle: string[];
}

const sameAreas = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((x, i) => x === b[i]);

/**
 * Cosa cambia l'importazione di `incoming` (il file, più «fatto» dalle PR unite in `doneRefs`) su `existing`. Lo
 * stato va solo avanti verso «fatto»; un compito fatto o annullato resta com'è.
 */
export function planTaskImport(existing: readonly TaskRow[], incoming: readonly TaskDraft[], doneRefs: ReadonlySet<string> = new Set()): TaskImportPlan {
  const byRefExisting = new Map(existing.map((t) => [t.ref, t]));
  const ops: TaskImportOp[] = [];
  const unchanged: string[] = [];
  for (const draft of incoming) {
    const done = draft.done || doneRefs.has(draft.ref);
    const current = byRefExisting.get(draft.ref);
    if (!current) {
      ops.push({ kind: "nuovo", draft, status: done ? "fatto" : draft.cancelled ? "annullato" : "da_fare" });
      continue;
    }
    const changes: Partial<Pick<TaskDraft, "title" | "areas" | "estimateHours" | "evidence">> = {};
    if (current.title !== draft.title) changes.title = draft.title;
    if (!sameAreas(current.areas, draft.areas)) changes.areas = draft.areas;
    if (current.estimateHours !== draft.estimateHours) changes.estimateHours = draft.estimateHours;
    if (current.evidence !== draft.evidence) changes.evidence = draft.evidence;
    const closed = current.status === "fatto" || current.status === "annullato";
    const status = done && !closed ? ("fatto" as const) : null;
    if (Object.keys(changes).length || status) ops.push({ kind: "aggiornato", id: current.id, ref: current.ref, changes, status });
    else unchanged.push(current.ref);
  }
  const incomingRefs = new Set(incoming.map((d) => d.ref));
  const onlyInUnbundle = existing.filter((t) => !incomingRefs.has(t.ref)).map((t) => t.ref).sort((a, b) => Number(a.slice(2)) - Number(b.slice(2)));
  return { ops, unchanged, onlyInUnbundle };
}

/** Dal ramo di una PR unita (`tj-0049/t-3-aeroporti`) il compito del caso, se è suo. */
export function taskRefFromBranch(branch: string, caseCode: string): string | null {
  const m = /^([a-z0-9-]+)\/t-(\d{1,4})(?:-|$)/i.exec(branch.trim());
  if (!m || m[1].toLowerCase() !== caseCode.toLowerCase()) return null;
  const ref = `T-${Number(m[2])}`;
  return TASK_REF_RE.test(ref) ? ref : null;
}

// ─── Le aree ─────────────────────────────────────────────────────────

/** Vero se un percorso contiene l'altro, o sono lo stesso (una cartella finisce con `/` o non ha estensione). */
function contains(outer: string, inner: string): boolean {
  if (outer === inner) return true;
  const dir = outer.endsWith("/") ? outer : `${outer}/`;
  return inner.startsWith(dir);
}

/** Le aree di `a` che toccano le aree di `b`. */
export function areasOverlap(a: readonly string[], b: readonly string[]): string[] {
  return a.filter((x) => b.some((y) => contains(x, y) || contains(y, x)));
}

/** I compiti in corso di altri che toccano le aree di `task`. */
export function overlappingTasks(task: Pick<TaskRow, "ref" | "areas">, others: readonly TaskRow[]): { ref: string; areas: string[] }[] {
  return others
    .filter((o) => o.ref !== task.ref && (o.status === "in_corso" || o.status === "in_revisione"))
    .map((o) => ({ ref: o.ref, areas: areasOverlap(task.areas, o.areas) }))
    .filter((o) => o.areas.length > 0);
}

// ─── Il compito fermo ────────────────────────────────────────────────

/** Giorni lavorativi senza segnali prima di chiedere a chi ha il compito, e prima di dirlo al responsabile. */
export const STALE_ASK_DAYS = 2;
export const STALE_ESCALATE_DAYS = 4;

/**
 * Che cosa fare di un compito in corso oggi: niente, chiedere a chi lo ha, o dirlo al responsabile. Si chiede una
 * volta per segnale: un segnale nuovo dopo la domanda riparte da capo.
 */
export function staleStep(task: Pick<TaskRow, "status" | "holderUserId" | "takenAt" | "lastActivityAt" | "staleAskedAt" | "staleEscalatedAt">, now: Date): "niente" | "chiedi" | "responsabile" {
  if (task.status !== "in_corso" || !task.holderUserId) return "niente";
  const signal = task.lastActivityAt ?? task.takenAt;
  if (!signal) return "niente";
  const since = new Date(signal);
  const days = workingDaysBetween(since, now);
  const askedForThisSignal = task.staleAskedAt !== null && new Date(task.staleAskedAt) >= since;
  const escalatedForThisSignal = task.staleEscalatedAt !== null && new Date(task.staleEscalatedAt) >= since;
  if (days >= STALE_ESCALATE_DAYS && askedForThisSignal && !escalatedForThisSignal) return "responsabile";
  if (days >= STALE_ASK_DAYS && !askedForThisSignal) return "chiedi";
  return "niente";
}

// ─── Il brief ────────────────────────────────────────────────────────

/** La riga dei compiti nel brief: senza nomi, «tuo» o «di un collega». */
export function tasksBriefLine(tasks: readonly Pick<TaskRow, "ref" | "status" | "holderUserId">[], viewerId: string): string | null {
  if (!tasks.length) return null;
  const sorted = [...tasks].sort(byRef);
  const mine = sorted.filter((t) => (t.status === "in_corso" || t.status === "in_revisione") && t.holderUserId === viewerId);
  const others = sorted.filter((t) => (t.status === "in_corso" || t.status === "in_revisione") && t.holderUserId !== viewerId);
  const free = sorted.filter((t) => t.status === "da_fare");
  const done = sorted.filter((t) => t.status === "fatto").length;
  const parts: string[] = [];
  for (const t of mine.slice(0, 3)) parts.push(`${t.ref} tuo, ${t.status === "in_revisione" ? "in revisione" : "in corso"}`);
  if (others.length) parts.push(`${others.map((t) => t.ref).slice(0, 4).join(", ")} di colleghi`);
  if (free.length) parts.push(`${free.length === 1 ? "1 da prendere" : `${free.length} da prendere`} (${free.slice(0, 3).map((t) => t.ref).join(", ")}${free.length > 3 ? "…" : ""})`);
  parts.push(`${done} su ${sorted.filter((t) => t.status !== "annullato").length} fatti`);
  return `Compiti: ${parts.join(" · ")}.`;
}
