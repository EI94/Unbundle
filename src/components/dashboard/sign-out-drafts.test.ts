import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// (Mappatura board) Uscire dall'app dalla barra laterale (docs/mappatura/MAPPATURA-BOARD-PIANO.md §4.7): prima che la
// sessione finisca, la board aperta manda quello che resta e le bozze della board si tolgono dal dispositivo. Su un
// browser condiviso chi entra dopo non trova le modifiche di un altro. La barra laterale si prova dal suo sorgente.

const source = readFileSync(new URL("./app-sidebar.tsx", import.meta.url), "utf8");

test("«Esci»: le board aperte e le loro bozze prima della fine della sessione", () => {
  assert.match(source, /import \{ signOutBoards \} from "@\/components\/mappatura\/store\/drafts";/);
  const handler = source.slice(source.indexOf("const handleLogout = async () => {"), source.indexOf("};", source.indexOf("const handleLogout = async () => {")));
  const boards = handler.indexOf("await signOutBoards(deviceStorage());");
  const session = handler.indexOf('await fetch("/api/auth/session", { method: "DELETE" });');
  assert.ok(boards > 0 && session > boards, "le board escono prima che la sessione finisca");
  assert.ok(handler.indexOf("confirmLearningNavigation()") < boards, "chi annulla l'uscita non perde la bozza");
});
