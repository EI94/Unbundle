import test from "node:test";
import assert from "node:assert/strict";
import { firebaseErrorCode, firebaseErrorMessage, GOOGLE_NEEDS_REAL_BROWSER, isInAppBrowser } from "./auth-errors.ts";

test("gli errori noti hanno un messaggio in italiano, gli altri un messaggio generico senza codici", () => {
  assert.match(firebaseErrorMessage({ code: "auth/invalid-credential" }), /Email o password/);
  assert.equal(firebaseErrorMessage({ code: "auth/strano" }), "Accesso non riuscito. Riprova.");
  assert.equal(firebaseErrorMessage(new Error("boom")), "Accesso non riuscito. Riprova.");
  assert.equal(firebaseErrorCode(null), "");
});

test("la finestra di Google bloccata chiede un browser vero", () => {
  assert.equal(GOOGLE_NEEDS_REAL_BROWSER.has("auth/popup-blocked"), true);
  assert.equal(GOOGLE_NEEDS_REAL_BROWSER.has("auth/popup-closed-by-user"), false);
});

test("riconosce i browser interni di WhatsApp, Instagram, LinkedIn e le webview Android", () => {
  assert.equal(isInAppBrowser("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 WhatsApp/2.24"), true);
  assert.equal(isInAppBrowser("Mozilla/5.0 (iPhone) Instagram 300.0"), true);
  assert.equal(isInAppBrowser("Mozilla/5.0 (Linux; Android 14; Pixel 8; wv) AppleWebKit/537.36"), true);
  assert.equal(isInAppBrowser("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/17.0 Safari/605.1.15"), false);
  assert.equal(isInAppBrowser("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) CriOS/120.0 Mobile Safari/604.1"), false);
});
