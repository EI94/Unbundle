/**
 * Il compito e la sua pull request, in SQL (rilascio 8.1b; 8.0c per lo script dell'operatore): la regola sta qui una
 * volta sola. La usano l'evento di GitHub (`src/lib/db/queries/use-case-github.ts`) e `use-case-admin repo-unregister`
 * (`src/lib/use-cases/admin/repo-unregister.ts`), che chiude le pull request aperte di un repository tolto come le
 * chiuderebbe GitHub.
 *
 * Modulo puro: import relativi `.ts`, niente `@/…` né `server-only` (lo caricano anche gli script dell'operatore).
 */
import { cast, raw, toStatement, ucSql, type SqlFragment, type UcStatement } from "../../uc/sql/statement.ts";

/** Un compito alla volta per use case: l'import, `compito nuovo`, gli eventi di GitHub (stesso lock, stessa chiave). */
export const tasksLockOfUseCaseSql = (useCaseId: string): UcStatement =>
  toStatement(ucSql`SELECT pg_advisory_xact_lock(hashtext('unbundle:use-case-tasks:' || ${cast(useCaseId, "text")}))`);

/** L'ordine dei lock di più use case: sempre lo stesso, così due transazioni non si aspettano l'una con l'altra. */
export const byUseCaseId = (a: string, b: string): number => a.localeCompare(b);

/**
 * Il compito `t` dopo che la sua pull request `p` è stata scritta in questa transazione. Si muove solo se la PR è
 * cambiata davvero (`p.changed_at = now()`: stato o bozza diversi, o il compito legato adesso):
 * - unita → il compito è fatto;
 * - con un'altra PR pronta (aperta, non in bozza) dello stesso compito → in revisione;
 * - chiusa senza unirla, o tornata in bozza → il compito in revisione torna in corso (da fare, se nessuno lo ha).
 *
 * Un compito fatto o annullato non cambia più. `match` dice quale PR e quale compito, con ogni altra condizione;
 * `url` è l'indirizzo della PR per `pr_url` (si scrive solo per una PR pronta o unita); `signal` un segnale di vita.
 * Restituisce lo stato del compito dopo.
 */
export function taskAfterPullRequestSql(i: { match: SqlFragment; url: SqlFragment; signal: boolean }): UcStatement {
  // Una PR pronta (aperta, non in bozza) del compito, dopo la scrittura della PR.
  const readyPr = ucSql`EXISTS (SELECT 1 FROM use_case_pull_requests o WHERE o.task_id = t.id AND o.state = 'aperta' AND NOT o.draft)`;
  // Lo stato del compito cambia solo se la PR è cambiata adesso: un'etichetta, una modifica del testo o un evento
  // vecchio su una PR già unita non rimettono «fatto» un compito riaperto.
  const changed = raw("p.changed_at = now()");
  return toStatement(ucSql`UPDATE use_case_tasks t SET
  status = CASE
    WHEN NOT ${changed} THEN t.status
    WHEN p.state = 'unita' THEN 'fatto'
    WHEN ${readyPr} THEN 'in_revisione'
    WHEN t.status = 'in_revisione' THEN CASE WHEN t.holder_user_id IS NULL THEN 'da_fare' ELSE 'in_corso' END
    ELSE t.status END,
  pr_url = CASE WHEN ${changed} AND (p.state = 'unita' OR (p.state = 'aperta' AND NOT p.draft)) THEN ${i.url} ELSE t.pr_url END,
  branch = coalesce(t.branch, p.branch),
  last_activity_at = CASE WHEN ${cast(i.signal, "boolean")} OR (${changed} AND p.state = 'unita') THEN now() ELSE t.last_activity_at END,
  updated_at = CASE WHEN ${changed} THEN now() ELSE t.updated_at END
FROM use_case_pull_requests p
WHERE ${i.match} AND t.status IN ('da_fare', 'in_corso', 'in_revisione')
RETURNING t.id, t.status`);
}
