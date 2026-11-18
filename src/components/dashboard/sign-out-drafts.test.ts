import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// (Mappatura board) Uscire dall'app (docs/mappatura/MAPPATURA-BOARD-PIANO.md §4.7): «Esci» nella barra laterale e
// «Cambia account» negli inviti chiudono la sessione con lo stesso aiuto (src/lib/auth/end-session.ts), che prima fa
// mandare alla board aperta quello che resta e toglie le bozze della board dal dispositivo. Su un browser condiviso chi
// entra dopo non trova le modifiche di un altro. I due componenti si provano dal loro sorgente.

const sidebar = readFileSync(new URL("./app-sidebar.tsx", import.meta.url), "utf8");
const switchAccount = readFileSync(new URL("../workspace/switch-account-button.tsx", import.meta.url), "utf8");

test("«Esci»: la sessione si chiude con endAppSession, dopo la conferma dell'uscita e prima di Firebase", () => {
  assert.match(sidebar, /import \{ endAppSession \} from "@\/lib\/auth\/end-session";/);
  const handler = sidebar.slice(sidebar.indexOf("const handleLogout = async () => {"), sidebar.indexOf("};", sidebar.indexOf("const handleLogout = async () => {")));
  const end = handler.indexOf("await endAppSession();");
  assert.ok(end > 0, "la sessione si chiude con endAppSession");
  // (Rilascio 10) Con modifiche della Formazione non salvate, la conferma scarta ed esce: «Esci» è il passo stesso.
  const ask = handler.indexOf("if (!confirmLearningNavigation(() => void handleLogout())) return;");
  assert.ok(ask >= 0 && ask < end, "chi annulla l'uscita non perde la bozza");
  assert.ok(end < handler.indexOf("await signOut(firebaseAuth)"), "Firebase dopo la sessione dell'app");
  assert.doesNotMatch(handler, /\/api\/auth\/session/, "nessun DELETE da solo");
});

test("«Cambia account»: le bozze lasciano il dispositivo come con «Esci», poi il login", () => {
  assert.match(switchAccount, /import \{ endAppSession \} from "@\/lib\/auth\/end-session";/);
  const handler = switchAccount.slice(switchAccount.indexOf("async function switchAccount()"), switchAccount.indexOf("return (", switchAccount.indexOf("async function switchAccount()")));
  assert.ok(handler.indexOf("await endAppSession();") > 0);
  assert.ok(handler.indexOf("await endAppSession();") < handler.indexOf("window.location.href = loginHref;"));
  assert.doesNotMatch(handler, /\/api\/auth\/session/, "nessun DELETE da solo");
});
