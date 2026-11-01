import test, { before } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { enableTsxImports } from "./referent/tsx-test-loader.ts";

// L'arrivo sulla scheda da un `#ancora` dell'indirizzo (rilascio 3): un link copiato a metà o
// storpiato («#%», «#100%») apriva il confine d'errore «Non riusciamo a caricare gli use case.» al
// posto della scheda, perché `decodeURIComponent` lanciava `URIError` nell'effetto di `Arrival`, e
// «Riprova» non serviva: l'ancora restava nell'indirizzo. Ora l'ancora si legge con `knownAnchorOf`.
let arrival: typeof import("./arrival.tsx");
before(async () => {
  await enableTsxImports();
  arrival = await import("./arrival.tsx");
});

const IDS = ["decisione", "impatto", "cosa-e", "cosa-serve", "storia"] as const;

test("knownAnchorOf: un'ancora della scheda arriva; una malformata non lancia e non arriva da nessuna parte", () => {
  assert.equal(arrival.knownAnchorOf("#storia", IDS), "storia");
  assert.equal(arrival.knownAnchorOf("#cosa-serve", IDS), "cosa-serve");
  assert.equal(arrival.knownAnchorOf("#%63osa-e", IDS), "cosa-e", "decodificata come fa il browser");
  for (const hash of ["#%", "#100%", "#%E0%A4%A", "#%E0"]) {
    assert.doesNotThrow(() => arrival.knownAnchorOf(hash, IDS), hash);
    assert.equal(arrival.knownAnchorOf(hash, IDS), null, hash);
  }
  assert.equal(arrival.knownAnchorOf("", IDS), null, "senza ancora");
  assert.equal(arrival.knownAnchorOf("#", IDS), null, "un # da solo");
  assert.equal(arrival.knownAnchorOf("#quando", IDS), null, "un'ancora che questa scheda non ha");
});

test("Arrival legge l'ancora dell'indirizzo solo con knownAnchorOf, mai con un decodeURIComponent nudo", () => {
  const source = readFileSync(new URL("./arrival.tsx", import.meta.url), "utf8");
  assert.match(source, /const fromHash = \(\) => knownAnchorOf\(window\.location\.hash, knownIds\);/);
  assert.doesNotMatch(source, /decodeURIComponent\(/, "la decodifica sta in hashTargetOf, che non lancia");
});
