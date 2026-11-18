import test, { before } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { enableTsxImports } from "../use-cases/detail/referent/tsx-test-loader.ts";

// (Rilascio 10, ondata 2a «Cornice», rifiniture) Il foglio «Il tuo account» e la cronologia del browser, su una
// cronologia finta: aprire dal menu aggiunge un passo e ✕ (o Esc) torna indietro di quel passo, come i pannelli
// `?apri=` (`useSheetParam`); `settings#cli` e `settings#granola` aprono il foglio al posto dell'indirizzo, senza un
// passo nuovo. Id inventati.

let url: typeof import("./account-url.ts");

before(async () => {
  await enableTsxImports();
  url = await import("./account-url.ts");
});

const W = "00000000-0000-4000-8000-0000000000f1";
const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

/** Una cronologia del browser finta: i passi fino a quello di adesso, e ogni gesto del foglio (`push`, `replace`, `back`). */
function browserAt(...visited: string[]) {
  const entries = [...visited];
  let index = entries.length - 1;
  const calls: string[] = [];
  const now = () => new URL(entries[index], "http://unbundle.test");
  const page = {
    location: {
      get pathname() {
        return now().pathname;
      },
      get search() {
        return now().search;
      },
      get hash() {
        return now().hash;
      },
    },
    history: {
      pushState(_state: unknown, _unused: string, to?: string | URL | null) {
        calls.push(`push ${to}`);
        entries.splice(index + 1, entries.length, String(to));
        index += 1;
      },
      replaceState(_state: unknown, _unused: string, to?: string | URL | null) {
        calls.push(`replace ${to}`);
        entries[index] = String(to);
      },
      back() {
        calls.push("back");
        index = Math.max(0, index - 1);
      },
    },
  };
  return {
    page,
    calls,
    /** L'indirizzo di adesso. */
    here: () => entries[index],
    /** «Indietro» premuto da chi guarda (non dal foglio). */
    userBack: () => {
      index = Math.max(0, index - 1);
      return entries[index];
    },
    /** «Avanti» premuto da chi guarda. */
    userForward: () => {
      index = Math.min(entries.length - 1, index + 1);
      return entries[index];
    },
    /** Una navigazione dell'app (un link di Next): un passo nuovo, che il foglio non ha aggiunto. */
    navigate: (to: string) => {
      entries.splice(index + 1, entries.length, to);
      index += 1;
    },
  };
}

test("dal menu sotto il nome: aprire aggiunge un passo, ✕ torna indietro, e il primo «Indietro» porta alla pagina di prima", () => {
  const b = browserAt(`/dashboard/${W}/contesto`, `/dashboard/${W}/use-cases?vista=da-decidere#cosa-serve`);
  url.openAccountSheet(undefined, {}, b.page);
  assert.equal(b.here(), `/dashboard/${W}/use-cases?vista=da-decidere&account=1#cosa-serve`);
  url.closeAccountSheet(b.page);
  assert.deepEqual(b.calls, [`push /dashboard/${W}/use-cases?vista=da-decidere&account=1#cosa-serve`, "back"]);
  assert.equal(b.here(), `/dashboard/${W}/use-cases?vista=da-decidere#cosa-serve`, "il foglio è chiuso, la pagina è quella di prima");
  // Prima (replaceState) restavano due passi uguali, e il primo «Indietro» non cambiava niente a schermo.
  assert.equal(b.userBack(), `/dashboard/${W}/contesto`);
});

test("aperto su una parte, chiuso con Esc: lo stesso; e riaperto con «Avanti», ✕ torna ancora indietro", () => {
  const b = browserAt(`/dashboard/${W}`);
  url.openAccountSheet("claude", {}, b.page);
  url.closeAccountSheet(b.page);
  assert.deepEqual(b.calls, [`push /dashboard/${W}?account=claude`, "back"]);
  assert.equal(b.userForward(), `/dashboard/${W}?account=claude`, "«Avanti» riapre il foglio");
  url.closeAccountSheet(b.page);
  assert.deepEqual(b.calls.slice(2), ["back"]);
  assert.equal(b.here(), `/dashboard/${W}`);
});

test("un foglio che non ha un passo suo (aperto da un link): ✕ lo chiude sostituendo l'indirizzo, la pagina resta", () => {
  const b = browserAt(`/dashboard/${W}/agent-factory`, `/dashboard/${W}/use-cases?account=granola`);
  url.closeAccountSheet(b.page);
  assert.deepEqual(b.calls, [`replace /dashboard/${W}/use-cases`]);
  assert.equal(b.here(), `/dashboard/${W}/use-cases`);
  // Un passo aggiunto prima non vale per un altro indirizzo: dal menu, poi un link dentro il foglio, poi un altro foglio
  // aperto da un link; chiuderlo non torna indietro di un passo che non è il suo.
  const c = browserAt(`/dashboard/${W}/contesto`);
  url.openAccountSheet(undefined, {}, c.page);
  c.navigate(`/dashboard/${W}/settings#granola-regole`);
  c.navigate(`/dashboard/${W}/use-cases?account=claude`);
  url.closeAccountSheet(c.page);
  assert.deepEqual(c.calls, [`push /dashboard/${W}/contesto?account=1`, `replace /dashboard/${W}/use-cases`]);
  // Tornando con «Indietro» fino al passo che il menu aveva aggiunto, ✕ torna di nuovo indietro.
  c.userBack();
  assert.equal(c.userBack(), `/dashboard/${W}/contesto?account=1`);
  url.closeAccountSheet(c.page);
  assert.equal(c.calls.at(-1), "back");
  assert.equal(c.here(), `/dashboard/${W}/contesto`);
});

test("`settings#cli` e `settings#granola` aprono il foglio sulla parte giusta, al posto dell'indirizzo, senza un passo nuovo", () => {
  const settings = `/dashboard/${W}/settings`;
  const cli = browserAt(`/cli/collega`, `${settings}#cli`);
  url.openAccountForSettingsAnchor(settings, W, cli.page);
  assert.deepEqual(cli.calls, [`replace ${settings}?account=claude#cli`]);
  // Chiuderlo sostituisce di nuovo: il foglio non ha aggiunto passi, e «Indietro» porta dove si era.
  url.closeAccountSheet(cli.page);
  assert.deepEqual(cli.calls.slice(1), [`replace ${settings}#cli`]);
  assert.equal(cli.userBack(), `/cli/collega`);
  // Il ritorno da Granola tiene com'è andata (`?granola=`), che il foglio dice.
  const back = browserAt(`${settings}?granola=errore#granola`);
  url.openAccountForSettingsAnchor(settings, W, back.page);
  assert.deepEqual(back.calls, [`replace ${settings}?granola=errore&account=granola#granola`]);
  // Le altre ancore restano della pagina, anche quella delle regole delle call; un foglio già aperto non si riapre; le
  // Impostazioni di un altro workspace o un'altra pagina, niente.
  for (const [pathname, at] of [
    [settings, `${settings}#integrazioni`],
    [settings, `${settings}#granola-regole`],
    [settings, `${settings}?account=email#granola`],
    [`/dashboard/${W}/agent-factory`, `/dashboard/${W}/agent-factory#cli`],
    [`/dashboard/00000000-0000-4000-8000-0000000000f2/settings`, `/dashboard/00000000-0000-4000-8000-0000000000f2/settings#cli`],
  ]) {
    const b = browserAt(at);
    url.openAccountForSettingsAnchor(pathname, W, b.page);
    assert.deepEqual(b.calls, [], at);
  }
});

test("il cablaggio: il foglio chiama l'ancora a ogni pagina e chiude con `closeAccountSheet`; il menu apre con `openAccountSheet`", () => {
  const sheet = read("./account-sheet.tsx");
  assert.match(sheet, /useEffect\(\(\) => openAccountForSettingsAnchor\(pathname, workspaceId\), \[pathname, workspaceId\]\);/);
  assert.match(sheet, /<Sheet open=\{open\} onOpenChange=\{\(next\) => \(next \? undefined : closeAccountSheet\(\)\)\}>/);
  assert.doesNotMatch(sheet, /history\.(?:pushState|replaceState|back)/, "la cronologia la tocca solo account-url.ts");
  const sidebar = read("../dashboard/app-sidebar.tsx");
  assert.match(sidebar, /const openAccount = \(\) => \{\s*closeMobileNavigation\(\);\s*openAccountSheet\(\);\s*\};/);
});
