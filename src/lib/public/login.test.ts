import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { findHubForbiddenIn } from "../use-cases/copy-guard.ts";
import { LOGIN_TEXT } from "./login.ts";

// (Rilascio 10, ondata 4 «Fuori», docs/ui-10/PROPOSTA-10.md §3.11 «Login», audit Fuori §3.1 e §8.1) L'accesso: H1
// «Accedi a Unbundle» anche al telefono, i link secondari a 44 px, «Privacy», la sessione scaduta in una riga, l'avviso
// dell'app di chat più corto, «Mandami il link per la password»; tutto il resto come prima (Google, email e password,
// account nuovo, password dimenticata, `callbackUrl`, «Copia il link»).

const read = (path: string) => readFileSync(new URL(`../../../${path}`, import.meta.url), "utf8");
const code = (path: string) =>
  read(path)
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

function strings(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (value && typeof value === "object") return Object.values(value).flatMap(strings);
  return [];
}

test("the texts: no «login», «reset» or «Privacy Policy» on screen; the short notices", () => {
  const texts = strings(LOGIN_TEXT);
  assert.deepEqual(findHubForbiddenIn(texts, "esterno"), []);
  assert.equal(LOGIN_TEXT.title, "Accedi a Unbundle");
  assert.equal(LOGIN_TEXT.stale, "Sessione scaduta: accedi di nuovo.");
  assert.equal(LOGIN_TEXT.privacyLink, "Privacy");
  assert.equal(LOGIN_TEXT.form.reset, "Mandami il link per la password");
  assert.equal(LOGIN_TEXT.form.back, "Torna all'accesso");
  assert.ok(LOGIN_TEXT.form.inApp.split(/\s+/).length <= 25, "l'avviso dell'app di chat più corto");
  for (const text of texts) assert.doesNotMatch(text, /\b(?:login|reset|Policy)\b/i, text);
});

test("the page: the public shell, H1 «Accedi a Unbundle» on every width, the stale session in one line, «Privacy» in the footer", () => {
  const page = code("src/app/(auth)/login/page.tsx");
  assert.match(page, /<h1 className="mt-6 text-2xl font-semibold tracking-tight">\{LOGIN_TEXT\.title\}<\/h1>/);
  assert.doesNotMatch(page, /hidden lg:flex|lg:hidden|<h2/, "un solo H1, visibile anche al telefono");
  assert.match(page, /\{fromInvite \? <p className="mt-2 text-muted-foreground">\{LOGIN_TEXT\.fromInvite\}<\/p> : null\}/);
  assert.match(page, /data-testid="session-stale-banner">\s*\{LOGIN_TEXT\.stale\}/);
  assert.match(page, /<PublicLink href="\/legal\/terms">\{LOGIN_TEXT\.termsLink\}<\/PublicLink>/);
  assert.match(page, /<PublicLink href="\/legal\/privacy">\{LOGIN_TEXT\.privacyLink\}<\/PublicLink>/);
  assert.match(page, /if \(session\) redirect\(callbackUrl \?\? "\/dashboard"\);/, "chi è già dentro va dove doveva");
  assert.match(code("src/app/(auth)/layout.tsx"), /return <PublicRoot>\{children\}<\/PublicRoot>;/);
  assert.match(code("src/app/(auth)/login/error.tsx"), /return <PublicErrorScreen retry=\{retry\} \/>;/);
});

test("the form: one filled button, Google outlined, secondary links 44 px, no toast, the password hint only for a new account", () => {
  const form = code("src/components/auth/login-form.tsx");
  assert.equal(form.match(/className=\{PUBLIC_PRIMARY\}/g)?.length, 1, "un solo pieno: quello del modulo");
  assert.match(form, /<Button type="button" variant="outline" className=\{cn\(PUBLIC_SECONDARY, "gap-2"\)\} onClick=\{handleGoogle\}/);
  assert.match(form, /const secondary = cn\(PUBLIC_LINK, "text-sm text-muted-foreground"\);/);
  assert.equal(form.match(/className=\{secondary\}/g)?.length, 4, "Registrati, Password dimenticata, Accedi, Torna all'accesso");
  assert.doesNotMatch(form, /from "sonner"|toast\./, "niente toast: un portale uscirebbe dal contenitore chiaro");
  assert.match(form, /setNotice\(L\.resetSent\);/);
  assert.match(form, /placeholder=\{mode === "register" \? L\.passwordPlaceholder : undefined\}/);
  assert.equal(form.match(/className=\{PUBLIC_LABEL\}/g)?.length, 3, "etichette leggibili");
  assert.doesNotMatch(form, /text-xs|amber|red-\d|text-red|bg-foreground text-background/);
  // Tutto quello che c'era resta: Google, email e password, account nuovo, nuova password, «Copia il link», callbackUrl.
  for (const kept of ["signInWithPopup", "signInWithEmailAndPassword", "createUserWithEmailAndPassword", "sendPasswordResetEmail", "copyPageLink", 'searchParams.get("callbackUrl")', 'data-testid="in-app-browser-hint"', 'data-testid="login-error"']) {
    assert.ok(form.includes(kept), kept);
  }
  assert.doesNotMatch(form, /"[A-ZÈ][a-zàèéìòù']+\s[^"\n]*"/, "nessuna frase scritta a mano");
});
