/**
 * Ricerca del workspace del cliente per nome, a partire da `workspace_hint` del
 * seed (PIANO §8.1, passo 3).
 *
 * 1. Dal suggerimento si toglie la parte tra parentesi.
 * 2. Si normalizza: NFKC, minuscolo, «·», «-», «/» e gli altri separatori
 *    diventano spazi, spazi compressi.
 * 3. Si confronta in modo esatto con il nome del workspace oppure con
 *    «organizzazione · workspace» (normalizzati allo stesso modo).
 * 4. In mancanza, valgono i workspace che contengono tutti i token.
 *
 * Serve **esattamente un** risultato: con zero o più candidati lo script elenca
 * i candidati, esce con errore e non crea niente (mai un workspace nuovo).
 * Qui solo la logica: la SQL che legge i candidati sta nello script. Modulo puro.
 */
import type { Result } from "../types.ts";
import { fail, ok } from "../types.ts";

/** Normalizzazione dei nomi per il confronto. */
export function normalizeWorkspaceName(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("it")
    .replace(/[·•|/\\\-–—_,;:]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Toglie le parti tra parentesi («Nome (nota)» → «Nome»). */
export function stripParenthetical(value: string): string {
  let out = value;
  for (let i = 0; i < 5 && /\([^()]*\)/.test(out); i++) out = out.replace(/\s*\([^()]*\)/g, "");
  return out.replace(/\s+/g, " ").trim();
}

export interface WorkspaceSearch {
  /** Suggerimento senza parentesi e normalizzato. */
  normalized: string;
  /** Token per la ricerca ILIKE (almeno 2 caratteri, senza doppioni). */
  tokens: string[];
}

export function workspaceSearch(hint: string): WorkspaceSearch {
  const normalized = normalizeWorkspaceName(stripParenthetical(hint));
  const tokens = [...new Set(normalized.split(" ").filter((t) => t.length >= 2))];
  return { normalized, tokens };
}

export interface WorkspaceCandidate {
  id: string;
  name: string;
  organizationName: string | null;
}

export interface WorkspaceMatch {
  id: string;
  /** Come si è trovato: nome esatto, «organizzazione · workspace», oppure tutti i token. */
  via: "nome" | "organizzazione_e_nome" | "token";
}

function labels(c: WorkspaceCandidate): { name: string; full: string | null } {
  return {
    name: normalizeWorkspaceName(c.name),
    full: c.organizationName ? normalizeWorkspaceName(`${c.organizationName} · ${c.name}`) : null,
  };
}

/** Elenco leggibile dei candidati per il messaggio d'errore dello script (id e nome). */
export function describeCandidates(candidates: readonly WorkspaceCandidate[]): string[] {
  return candidates.map((c) => `${c.id} · ${c.organizationName ? `${c.organizationName} · ` : ""}${c.name}`);
}

/**
 * Sceglie il workspace tra i candidati. Esattamente uno, altrimenti errore con
 * `nessun_workspace` o `workspace_ambiguo` (il chiamante elenca i candidati).
 */
export function pickWorkspace(candidates: readonly WorkspaceCandidate[], search: WorkspaceSearch): Result<WorkspaceMatch> {
  if (!search.normalized) return fail("suggerimento_vuoto", "Il suggerimento del workspace è vuoto: indica il workspace con --workspace.");
  const exactName = candidates.filter((c) => labels(c).name === search.normalized);
  const exactFull = candidates.filter((c) => labels(c).full === search.normalized);
  const exact = [...new Map([...exactName, ...exactFull].map((c) => [c.id, c])).values()];
  if (exact.length === 1) return ok({ id: exact[0].id, via: exactName.length === 1 ? "nome" : "organizzazione_e_nome" });
  if (exact.length > 1) return fail("workspace_ambiguo", `Ci sono ${exact.length} workspace con questo nome: indica quello giusto con --workspace.`);
  const byTokens = candidates.filter((c) => {
    const haystack = ` ${labels(c).full ?? labels(c).name} `;
    return search.tokens.length > 0 && search.tokens.every((t) => haystack.includes(t));
  });
  if (byTokens.length === 1) return ok({ id: byTokens[0].id, via: "token" });
  if (byTokens.length === 0) return fail("nessun_workspace", "Nessun workspace corrisponde al suggerimento: lo script non ne crea uno nuovo. Indica il workspace con --workspace.");
  return fail("workspace_ambiguo", `Ci sono ${byTokens.length} workspace possibili: indica quello giusto con --workspace.`);
}
