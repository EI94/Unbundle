// La riga della CI di una famiglia e la finestra con la chiave, rese in HTML (rilascio 8.2b, RILASCIO-8.2b-SPEC.md §2.5,
// §2.6, §2.7; rilascio 10, PROPOSTA-10.md §1 e §5): lo stato è un puntino più una frase; i pulsanti, bordati e alti
// 44 px al telefono, solo a chi gestisce le chiavi; chi costruisce da fuori vede lo stato senza pulsanti; la chiave si vede
// una volta, con «Copia», il nome esatto del segreto e i passi su GitHub; nessuna finestra del browser. Router, avvisi e
// azioni sono finti. Dati inventati.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { installAppModules } from "../../lib/ai/claude-test-kit.ts";
import type { CiKeyRepoOverview } from "../../lib/db/queries/use-case-ci-keys.ts";
import type { CiKeyRow } from "../../lib/use-cases/ci/keys.ts";
import { findHubForbiddenIn } from "../../lib/use-cases/copy-guard.ts";
import { enableTsxImports } from "../use-cases/detail/referent/tsx-test-loader.ts";
import { ciFamiliesView, type CiFamilyRow, type CiManagedRepos } from "./ci-view.ts";

const stubAction = (name: string) => `export async function ${name}() { return { ok: false, code: "permesso_negato", message: "no" }; }`;
await installAppModules({
  "next/navigation": `export function useRouter() { return { push() {}, refresh() {}, replace() {} }; }
    export function usePathname() { return "/"; }`,
  sonner: `export const toast = Object.assign(() => {}, { success() {}, error() {} });`,
  "@/lib/actions/ci-keys": ["createCiKeyAction", "rotateCiKeyAction", "revokeCiKeyAction"].map(stubAction).join("\n"),
});
await enableTsxImports();
const { CiRow } = await import("./ci-row.tsx");
const { CiKeyShownBody } = await import("./ci-key-actions.tsx");
const { Dialog } = await import("../ui/dialog.tsx");

const WS = "11111111-1111-4111-8111-111111111111";
const REPO = "Voltaen/esempio-rosa";
const NOW = new Date("2026-11-18T20:04:00.000Z");
const KEY = `ub_ci_${"Ab3_".repeat(10)}xY9`;

const readable = (html: string) => html.replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
const render = (element: ReactElement) => readable(renderToStaticMarkup(element));
/** Il testo visibile, un pezzo per elemento. */
const textOf = (html: string) =>
  html
    .split(/<[^>]+>/)
    .map((p) => p.trim())
    .filter(Boolean);
/** I tag `<button>`, con gli attributi e l'etichetta. */
const buttons = (html: string) => [...html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)].map((m) => ({ attrs: m[1], label: textOf(m[2]).join(" ") }));
/** Il testo di un pezzo di HTML così com'è, senza i tag (gli spazi tra un tag e l'altro restano). */
const plainText = (html: string) => html.replace(/<[^>]+>/g, "");
const filled = (html: string) => buttons(html).filter((b) => /(?:^|\s|")bg-primary(?:\s|")/.test(b.attrs));

let seq = 0;
function key(over: Partial<CiKeyRow> = {}): CiKeyRow {
  seq += 1;
  return {
    id: `00000000-0000-4000-8000-${String(seq).padStart(12, "0")}`,
    repo: REPO,
    prefix: "ub_ci_ab12",
    createdAt: new Date("2026-11-18T19:04:00.000Z"),
    expiresAt: new Date("2027-05-17T19:04:00.000Z"),
    lastUsedAt: null,
    remindedAt: null,
    revokedAt: null,
    revokedReason: null,
    replacesKeyId: null,
    ...over,
  };
}

function rowOf(keys: CiKeyRow[], managed: CiManagedRepos | null, o: { ready?: boolean; now?: Date } = {}): CiFamilyRow {
  const repos = new Map<string, CiKeyRepoOverview>([[REPO.toLowerCase(), { repo: REPO, keys, approvedCases: 1 }]]);
  const row = ciFamiliesView({ ready: o.ready ?? true, repos, managed, families: [REPO], now: o.now ?? NOW }).rows.get(REPO.toLowerCase());
  assert.ok(row);
  return row;
}
const MANAGER: CiManagedRepos = { all: true, repos: new Set() };
const renderRow = (row: CiFamilyRow) => render(createElement(CiRow, { workspaceId: WS, row }));

test("chi costruisce, anche da fuori, vede lo stato: il puntino del suo colore e la frase, senza pulsanti", () => {
  const html = renderRow(rowOf([key({ lastUsedAt: new Date("2026-11-18T20:00:00.000Z") })], null));
  assert.match(html, /^<div data-slot="ci-row" data-ci-state="usata"/);
  assert.match(html, /<span aria-hidden="true" data-tone="verde" class="[^"]*\bbg-uc-verde\b[^"]*"><\/span>/, "il colore solo nel puntino");
  assert.deepEqual(textOf(html), ["CI collegata · ultimo invio oggi · la chiave scade il 17/05/2027"]);
  assert.deepEqual(buttons(html), []);
  assert.doesNotMatch(html, /ci-actions/);
  // La 0042 non pronta: la frase, anche per chi gestisce le chiavi, senza pulsanti.
  const notReady = renderRow(rowOf([], MANAGER, { ready: false }));
  assert.deepEqual(textOf(notReady), ["Non ancora disponibile: riprova tra qualche minuto."]);
  assert.deepEqual(buttons(notReady), []);
  assert.equal(renderToStaticMarkup(createElement(CiRow, { workspaceId: WS, row: undefined })), "", "la famiglia senza repository: niente");
});

test("chi gestisce le chiavi: il pulsante dello stato, bordato e da 44 px; il «⋯» quando c'è una chiave", () => {
  const cases: Array<[string, CiFamilyRow, string | null, boolean]> = [
    ["non collegata", rowOf([], MANAGER), "Collega la CI", false],
    ["mai usata", rowOf([key()], MANAGER), null, true],
    ["usata", rowOf([key({ lastUsedAt: NOW })], MANAGER), null, true],
    ["in scadenza", rowOf([key({ createdAt: new Date("2026-06-05T10:00:00Z"), expiresAt: new Date("2026-12-02T10:00:00Z"), lastUsedAt: NOW })], MANAGER), "Ruota la chiave", true],
    ["scaduta", rowOf([key({ createdAt: new Date("2026-05-01T10:00:00Z"), expiresAt: new Date("2026-11-02T10:00:00Z"), lastUsedAt: new Date("2026-11-01T10:00:00Z") })], MANAGER), "Crea una chiave nuova", false],
  ];
  for (const [label, row, primary, menu] of cases) {
    const html = renderRow(row);
    const all = buttons(html);
    const main = all.find((b) => !/aria-label=/.test(b.attrs));
    assert.equal(main?.label ?? null, primary, label);
    if (main) {
      assert.match(main.attrs, /\bmin-h-11\b/, `${label}: 44 px al telefono`);
      assert.match(main.attrs, /\bsm:min-h-9\b/, label);
      assert.match(main.attrs, /type="button"/, label);
    }
    const trigger = all.find((b) => /aria-label="Altre azioni sulla CI di esempio-rosa"/.test(b.attrs));
    assert.equal(Boolean(trigger), menu, `${label}: il «⋯»`);
    if (trigger) assert.match(trigger.attrs, /\bsize-11 sm:size-8\b/, `${label}: il «⋯» da 44 px`);
    // (Rilascio 10, §1 regola 2) Il pulsante pieno della pagina è il prossimo passo: la riga non ne ha.
    assert.deepEqual(filled(html), [], label);
    assert.deepEqual(findHubForbiddenIn(textOf(html), "area"), [], label);
  }
});

test("la chiave, una volta: il titolo, «Copiala adesso», il campo con «Copia», il segreto e i passi su GitHub, «Fatto»", () => {
  const html = render(createElement(Dialog, { open: true }, createElement(CiKeyShownBody, { repo: REPO, keyValue: KEY, expiresAt: "2027-05-17T19:04:00.000Z", rotated: false })));
  assert.match(html, /<h2 [^>]*data-slot="dialog-title"[^>]*>La chiave della CI di esempio-rosa<\/h2>/);
  assert.match(html, /<p [^>]*data-slot="dialog-description"[^>]*>Copiala adesso: dopo non si vede più\.<\/p>/);
  // La chiave sta solo nel campo, una volta; il campo si legge e si seleziona, non si invia e non si corregge.
  assert.equal(html.split(KEY).length - 1, 1, "la chiave una volta sola");
  const field = /<input\b([^>]*)\/?>/.exec(html)?.[1] ?? "";
  assert.match(field, new RegExp(`value="${KEY}"`));
  assert.match(field, /readOnly=""|readonly=""/i);
  assert.match(field, /aria-label="La chiave della CI"/);
  assert.match(field, /autoComplete="off"|autocomplete="off"/i);
  assert.match(field, /spellCheck="false"|spellcheck="false"/i);
  assert.doesNotMatch(field, /\bname=/, "fuori da ogni modulo");
  assert.match(field, /\btext-base\b/, "16 px al telefono: il campo non ingrandisce la pagina");
  const [copy, done] = buttons(html);
  assert.equal(copy.label, "Copia");
  assert.match(copy.attrs, /\bmin-h-11\b/);
  assert.match(copy.attrs, /\bsm:min-h-9\b/);
  assert.equal(done.label, "Fatto");
  assert.match(done.attrs, /data-slot="dialog-close"/, "«Fatto» chiude la finestra");
  assert.equal(filled(html).length, 1, "un solo pulsante pieno, quello della finestra");
  assert.equal(filled(html)[0].label, "Fatto");
  // I passi su GitHub (Free: i segreti del repository), con il nome esatto del segreto come codice.
  const steps = /<p data-slot="ci-key-steps"[^>]*>([\s\S]*?)<\/p>/.exec(html)?.[1] ?? "";
  assert.match(steps, /<code [^>]*>UNBUNDLE_CI_TOKEN<\/code>/);
  assert.equal(
    plainText(steps),
    "Su GitHub, in Voltaen/esempio-rosa: Settings › Secrets and variables › Actions › New repository secret. Nome UNBUNDLE_CI_TOKEN, valore la chiave.",
  );
  assert.ok(textOf(html).includes("Vale fino al 17/05/2027, solo per mandare le evals di main di questo repository."));
  assert.deepEqual(findHubForbiddenIn(textOf(html.replace(KEY, "")), "area"), []);
});

test("dopo una rotazione: «La chiave nuova», e su GitHub al posto della vecchia, con lo stesso nome", () => {
  const html = render(createElement(Dialog, { open: true }, createElement(CiKeyShownBody, { repo: REPO, keyValue: KEY, expiresAt: "2027-05-17T19:04:00.000Z", rotated: true })));
  assert.match(html, />La chiave nuova della CI di esempio-rosa<\/h2>/);
  const steps = /<p data-slot="ci-key-steps"[^>]*>([\s\S]*?)<\/p>/.exec(html)?.[1] ?? "";
  assert.equal(plainText(steps), "Su GitHub, in Voltaen/esempio-rosa: Settings › Secrets and variables › Actions › UNBUNDLE_CI_TOKEN. Mettila al posto della vecchia, con lo stesso nome.");
  assert.doesNotMatch(steps, /New repository secret/, "il segreto c'è già: si aggiorna");
});

test("le finestre: quelle dell'app, mai del browser; la chiave non resta da nessuna parte dopo «Fatto»", () => {
  const source = readFileSync(new URL("./ci-key-actions.tsx", import.meta.url), "utf8");
  const code = source.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, "");
  assert.doesNotMatch(code, /window\.(confirm|alert|prompt)|globalThis\.(confirm|alert|prompt)/);
  assert.doesNotMatch(code, /localStorage|sessionStorage|document\.cookie|console\.|searchParams|router\.push|history\./, "la chiave mai nel browser oltre la finestra, mai in un log");
  // Le tre conferme sono `ConfirmDialog`; «Revoca» è rosso solo lì.
  assert.equal((code.match(/<ConfirmDialog\b/g) ?? []).length, 3);
  assert.match(code, /title=\{CI_TEXT\.connect\.title\(name\)\}[\s\S]*?confirmLabel=\{CI_TEXT\.connect\.confirm\}/);
  assert.match(code, /title=\{CI_TEXT\.rotate\.title\(name\)\}[\s\S]*?confirmLabel=\{CI_TEXT\.rotate\.confirm\}/);
  assert.match(code, /title=\{CI_TEXT\.revoke\.title\(name\)\}[\s\S]*?confirmLabel=\{CI_TEXT\.revoke\.confirm\}\s*destructive/);
  assert.equal((code.match(/\bdestructive\b/g) ?? []).length, 1, "nessuna voce rossa nel «⋯»");
  // La finestra della chiave: un tocco fuori non la chiude; chiusa, la chiave sparisce dallo stato.
  assert.match(code, /<Dialog\s+open=\{shown !== null\}\s+disablePointerDismissal/);
  assert.match(code, /if \(!next\) setShown\(null\);/);
  // L'avviso dice il messaggio dell'azione, mai la chiave.
  assert.match(code, /notifyDone\(result\.message \?\? \(kind === "revoca" \? CI_TEXT\.done\.revoked : CI_TEXT\.done\.created\)\)/);
  assert.doesNotMatch(code, /notifyDone\([^)]*\.key\b/);
  // I pulsanti della riga e «Copia» sono bordati: l'unico pulsante pieno è «Fatto», quello della finestra.
  const plain = (code.match(/<Button\b[^>]*>/g) ?? []).filter((tag) => !/variant="/.test(tag));
  assert.equal(plain.length, 1, plain.join("\n"));
  assert.match(code, /<DialogClose render=\{<Button type="button" className="min-h-11 sm:min-h-9" \/>\}>\{CI_TEXT\.key\.done\}<\/DialogClose>/);
});
