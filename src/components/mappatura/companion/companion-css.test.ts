import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseCss } from "../../theme/test-support/board-css.ts";

// (Mappatura board) Il compagno dentro il pannello dell'assistente (docs/mappatura/MAPPATURA-BOARD-PIANO.md §1.5): il
// pannello e la sua testa sono della board (board-views.css), il contenuto del compagno (board-companion.css). Il corpo
// del pannello non ha margini, così il compagno decide i suoi: quelli della testa, perché testo, bottoni e campo stiano
// in colonna con «Assistente» e «Chiudi», e non contro i bordi del pannello.

const rules = (name: string) => parseCss(readFileSync(new URL(`../${name}`, import.meta.url), "utf8"));
function declarations(sheet: ReturnType<typeof parseCss>, selector: string): Map<string, string> {
  const rule = sheet.find((item) => item.at === null && item.selector === `[data-board-root] ${selector}`);
  assert.ok(rule, `manca la regola ${selector}`);
  return rule.declarations;
}

test("il compagno sta nei margini della testa del pannello; il campo in fondo è largo quanto il pannello e non tocca il fondo", () => {
  const views = rules("board-views.css");
  const companion = rules("board-companion.css");
  const inline = declarations(views, ".b-assist-head").get("padding")?.split(" ")[1];
  assert.equal(inline, "22px");
  assert.equal(declarations(views, ".b-assist-body").get("padding"), undefined, "il corpo del pannello non ha margini: li mette il compagno");

  const [top, side] = declarations(companion, ".b-comp").get("padding")?.split(" ") ?? [];
  assert.equal(side, inline, "testo e bottoni del compagno in colonna con la testa");
  assert.ok(parseFloat(top ?? "0") > 0, "un po' d'aria sotto la testa");

  const form = declarations(companion, ".b-comp-form");
  assert.equal(form.get("position"), "sticky");
  assert.equal(form.get("margin"), `0 -${inline}`, "la riga del campo va da bordo a bordo del pannello");
  const [, formSide, formBottom] = form.get("padding")?.split(" ") ?? [];
  assert.equal(formSide, inline);
  assert.ok(parseFloat(formBottom ?? "0") >= 12, "il campo non tocca il fondo del pannello");
});
