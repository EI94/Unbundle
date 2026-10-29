import test from "node:test";
import assert from "node:assert/strict";
import { newPage, waitIdle } from "../../../scripts/uc-test/cdp.mjs";

// Il driver di Chrome del banco di prova (scripts/uc-test/cdp.mjs), senza Chrome: un finto browser
// risponde ai comandi e il test manda gli eventi di DevTools. Quando un nuovo documento sostituisce
// il precedente, Chrome annulla le richieste che il vecchio aveva ancora aperte e non ne annuncia mai
// la fine (né `loadingFinished` né `loadingFailed`): `waitIdle()` le aspettava fino al suo tempo
// massimo. Si dimenticano le richieste del documento sostituito, non quelle del nuovo.

type Message = { sessionId?: string; method: string; params?: Record<string, unknown> };

function fakeBrowser() {
  const listeners = new Set<(msg: Message) => void>();
  return {
    colorScheme: "dark",
    async send(method: string) {
      if (method === "Target.createTarget") return { targetId: "T" };
      if (method === "Target.attachToTarget") return { sessionId: "S" };
      return {};
    },
    on(listener: (msg: Message) => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    emit(method: string, params: Record<string, unknown>) {
      for (const listener of listeners) listener({ sessionId: "S", method, params });
    },
  };
}

test("banco di prova: le richieste del documento sostituito non tengono la pagina occupata", async () => {
  const browser = fakeBrowser();
  const page = await newPage(browser);
  page.loaded = true;
  // Il vecchio documento (L1) apre due prefetch e un iframe una sua richiesta, poi arriva L2.
  browser.emit("Network.requestWillBeSent", { requestId: "old-1", frameId: "T", loaderId: "L1" });
  browser.emit("Network.requestWillBeSent", { requestId: "old-2", frameId: "T", loaderId: "L1" });
  browser.emit("Network.requestWillBeSent", { requestId: "doc", frameId: "T", loaderId: "L2" });
  browser.emit("Network.requestWillBeSent", { requestId: "frame", frameId: "F", loaderId: "L9" });
  browser.emit("Network.loadingFinished", { requestId: "old-2" });
  assert.deepEqual([...page.inflight].sort(), ["doc", "frame", "old-1"]);

  // Un iframe che cambia documento non tocca le richieste della pagina.
  browser.emit("Page.frameNavigated", { frame: { id: "F", loaderId: "L10" } });
  assert.deepEqual([...page.inflight].sort(), ["doc", "frame", "old-1"]);

  browser.emit("Page.frameNavigated", { frame: { id: "T", loaderId: "L2" } });
  assert.deepEqual([...page.inflight].sort(), ["doc", "frame"], "la richiesta annullata di L1 non conta più");

  browser.emit("Network.loadingFinished", { requestId: "doc" });
  browser.emit("Network.loadingFailed", { requestId: "frame" });
  page.lastNetworkAt = Date.now() - 1000;
  assert.equal(await waitIdle(page, { quietMs: 50, timeoutMs: 500 }), true, "la pagina è quieta");
});

test("banco di prova: senza un nuovo documento ogni richiesta aperta tiene la pagina occupata", async () => {
  const browser = fakeBrowser();
  const page = await newPage(browser);
  page.loaded = true;
  browser.emit("Network.requestWillBeSent", { requestId: "rsc", frameId: "T", loaderId: "L1" });
  // Una navigazione del router di Next resta nello stesso documento: Chrome non manda `frameNavigated`.
  browser.emit("Page.navigatedWithinDocument", { frameId: "T", url: "http://127.0.0.1/x?vista=panoramica" });
  page.lastNetworkAt = Date.now() - 1000;
  assert.equal(await waitIdle(page, { quietMs: 50, timeoutMs: 300 }), false);
  browser.emit("Network.loadingFinished", { requestId: "rsc" });
  page.lastNetworkAt = Date.now() - 1000;
  assert.equal(await waitIdle(page, { quietMs: 50, timeoutMs: 300 }), true);
});
