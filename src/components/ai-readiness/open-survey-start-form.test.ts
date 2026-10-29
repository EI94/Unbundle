import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// «Hai già iniziato questa survey da questo dispositivo» del link aperto di AI Readiness: la survey già
// iniziata si legge da localStorage una volta, al montaggio e dopo l'idratazione, come prima di
// eslint-plugin-react-hooks 7.1. Letta come archivio esterno (useSyncExternalStore con l'evento
// `storage`) l'avviso compariva subito anche in un'altra scheda già aperta appena qui si iniziava la
// survey, e in questa scheda a ogni nuovo rendering dopo l'avvio, mentre si apre la survey.
const source = readFileSync(new URL("./open-survey-start-form.tsx", import.meta.url), "utf8");

test("survey aperta: la survey già iniziata si legge una volta al montaggio, non a ogni rendering", () => {
  assert.doesNotMatch(source, /useSyncExternalStore/, "nessun archivio esterno riletto a ogni rendering");
  assert.doesNotMatch(source, /addEventListener\(\s*["']storage["']/, "un'altra scheda non cambia l'avviso");
  assert.match(source, /const \[existingUrl, setExistingUrl\] = useState<string \| null>\(null\);/, "sul server e all'idratazione, niente avviso");
  assert.match(
    source,
    /useEffect\(\(\) => \{\s*(?:\/\/[^\n]*\n\s*)*setExistingUrl\(readExistingUrl\(openToken\)\);\s*\}, \[openToken\]\);/,
    "una lettura per montaggio (e per link)",
  );
});
