"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  GoogleAuthProvider,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  updateProfile,
} from "firebase/auth";
import { firebaseAuth } from "@/lib/firebase/client";
import { joinCourseByLinkAction, requestCohortReopenAction } from "@/lib/actions/learning-join";
import { KEPT_OTHER_COHORT_TEXT } from "@/lib/learning/join-arrival";
import { COURSE_JOIN_TEXT } from "@/lib/public/course";
import { fillPublic } from "@/lib/public/text";
import { cn } from "@/lib/utils";
import { PUBLIC_FIELD, PUBLIC_LABEL, PUBLIC_LINK, PUBLIC_PRIMARY, PUBLIC_SECONDARY } from "@/components/public/classes";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * Accesso e iscrizione sulla stessa schermata.
 *
 * Il vincolo è trenta secondi dal link al corso, quindi niente pagine
 * intermedie, niente bottone «Accetta», nessun campo da compilare per chi usa
 * Google. Le tre spunte servono a far capire che qualcosa sta accadendo: uno
 * spinner nudo per due secondi, su un telefono in aula, sembra un blocco.
 *
 * (Ondata 0) Un solo bivio: con `kept_other_cohort` la persona resta nel turno
 * di prima, dove ha già delle risposte. Prima di aprire il corso la pagina lo
 * dice e offre «Chiedi di riaprire il turno» (`requestCohortReopenAction`, con
 * il token di questo link); «Apri il corso» porta alla lezione.
 *
 * (Rilascio 10, ondata 4, PROPOSTA-10 §3.11) Un solo pulsante pieno: «Entra con
 * Google», con il link «Usa email e password»; aperto il modulo, il pieno è il
 * suo «Entra» e Google diventa bordato. «Non sono io» offre di nuovo Google ed
 * email e password, anche su un telefono condiviso. Bersagli di 44 px, campi a
 * 16 px, il pulsante principale a 48 px. I testi stanno in `src/lib/public/course.ts`.
 */

type Step = "account" | "enroll" | "open";

const J = COURSE_JOIN_TEXT;

/** Le webview di WhatsApp e Teams non supportano la finestra di Google. */
const NEEDS_REDIRECT = new Set([
  "auth/popup-blocked",
  "auth/operation-not-supported-in-this-environment",
  "auth/web-storage-unsupported",
]);

export function JoinCourseForm({
  token,
  signedInAs,
}: {
  token: string;
  signedInAs: { name: string | null; email: string } | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<Step[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [showEmail, setShowEmail] = useState(false);
  // In aula quasi tutti entrano per la prima volta: si parte da «crea l'account».
  const [registering, setRegistering] = useState(true);
  const [form, setForm] = useState({ name: "", email: "", password: "" });
  const [browserHint, setBrowserHint] = useState(false);
  const [copied, setCopied] = useState(false);
  // «Non sono io»: la persona collegata non è chi ha in mano il telefono.
  const [notMe, setNotMe] = useState(false);
  // (Ondata 0) Con `kept_other_cohort`: l'indirizzo della lezione, aperto solo con «Apri il corso».
  const [kept, setKept] = useState<string | null>(null);
  const [reopen, setReopen] = useState<{ pending: boolean; sent: boolean; message: string | null }>({ pending: false, sent: false, message: null });
  const inFlight = useRef(false);

  /** Al rientro da signInWithRedirect la pagina riparte da zero. */
  useEffect(() => {
    let cancelled = false;
    getRedirectResult(firebaseAuth)
      .then(async (result) => {
        if (cancelled || !result?.user) return;
        const idToken = await result.user.getIdToken();
        await run(idToken);
      })
      .catch(() => {
        /* nessun redirect in corso: è il caso normale */
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function describe(err: unknown) {
    const code =
      err && typeof err === "object" && "code" in err
        ? String((err as { code: unknown }).code)
        : "";
    if (code) return { code, message: Object.hasOwn(J.firebase, code) ? J.firebase[code] : null };
    return { code: "", message: err instanceof Error ? err.message : null };
  }

  /** Scambia il token Firebase per il cookie di sessione, poi iscrive. */
  async function run(idToken: string | null) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      if (idToken) {
        const res = await fetch("/api/auth/session", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ idToken }),
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(body.error ?? J.sessionFailed);
        }
      }
      setDone(["account"]);

      const result = await joinCourseByLinkAction(token);
      if (result.status === "error") {
        setError(result.message);
        setDone([]);
        return;
      }
      if (result.status !== "done") {
        setError(J.enrollFailed);
        setDone([]);
        return;
      }
      if (result.outcome === "kept_other_cohort") {
        setDone([]);
        setKept(result.path);
        return;
      }
      setDone(["account", "enroll"]);
      setDone(["account", "enroll", "open"]);
      router.replace(result.path);
    } catch (err) {
      const { message } = describe(err);
      setError(message ?? J.failed);
      setDone([]);
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  async function withGoogle() {
    setBusy(true);
    setError(null);
    try {
      const provider = new GoogleAuthProvider();
      // Sempre esplicito: su un telefono aziendale già collegato all'account
      // di un collega, una scelta silenziosa farebbe consegnare le attività
      // sotto il nome sbagliato — e le consegne sono immutabili.
      provider.setCustomParameters({ prompt: "select_account" });
      const result = await signInWithPopup(firebaseAuth, provider);
      await run(await result.user.getIdToken());
    } catch (err) {
      const { code, message } = describe(err);
      if (NEEDS_REDIRECT.has(code)) {
        setBrowserHint(true);
        try {
          await signInWithRedirect(firebaseAuth, new GoogleAuthProvider());
          return;
        } catch {
          setError(J.googleBlocked);
        }
      } else {
        setError(message ?? J.googleFailed);
      }
    } finally {
      setBusy(false);
    }
  }

  async function withEmail(event: React.FormEvent) {
    event.preventDefault();
    if (registering && !form.name.trim()) {
      setError(J.nameNeeded);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const email = form.email.trim();
      let credential;
      if (registering) {
        try {
          credential = await createUserWithEmailAndPassword(firebaseAuth, email, form.password);
        } catch (err) {
          // Chi ha già un account e sceglie «crea» con la stessa password entra
          // comunque: in aula nessuno deve capire quale dei due pulsanti usare.
          if (describe(err).code !== "auth/email-already-in-use") throw err;
          try {
            credential = await signInWithEmailAndPassword(firebaseAuth, email, form.password);
          } catch {
            throw err;
          }
        }
      } else {
        credential = await signInWithEmailAndPassword(firebaseAuth, email, form.password);
      }
      if (registering && form.name.trim()) {
        await updateProfile(credential.user, { displayName: form.name.trim() });
      }
      await run(await credential.user.getIdToken());
    } catch (err) {
      const { message } = describe(err);
      setError(message ?? J.emailFailed);
    } finally {
      setBusy(false);
    }
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2500);
    } catch {
      setError(J.copyFailed);
    }
  }

  async function askReopen() {
    setReopen({ pending: true, sent: false, message: null });
    try {
      const result = await requestCohortReopenAction(token);
      setReopen({ pending: false, sent: result.ok, message: result.message });
    } catch {
      setReopen({ pending: false, sent: false, message: KEPT_OTHER_COHORT_TEXT.failed });
    }
  }

  if (kept) {
    const T = KEPT_OTHER_COHORT_TEXT;
    return (
      <div className="space-y-3" data-testid="join-kept">
        <p className="font-medium">{T.title}</p>
        <p className="text-muted-foreground">{T.body}</p>
        {reopen.message && (
          <p role="status" className="text-muted-foreground">
            {reopen.message}
          </p>
        )}
        <div className="space-y-2 pt-1">
          <Button type="button" className={PUBLIC_PRIMARY} onClick={() => router.replace(kept)}>
            {T.open}
          </Button>
          {!reopen.sent && (
            <Button type="button" variant="outline" className={PUBLIC_SECONDARY} disabled={reopen.pending} onClick={() => void askReopen()}>
              {T.reopen}
            </Button>
          )}
        </div>
      </div>
    );
  }

  if (busy || done.length > 0) {
    const steps: Step[] = ["account", "enroll", "open"];
    return (
      <div className="space-y-3" data-testid="join-progress">
        <p className="font-medium">{J.progress}</p>
        <ul className="space-y-2" aria-live="polite">
          {steps.map((step) => {
            const complete = done.includes(step);
            return (
              <li key={step} className="flex items-center gap-3" data-step={step} data-state={complete ? "done" : "pending"}>
                <span
                  aria-hidden
                  className={
                    complete
                      ? "flex size-5 items-center justify-center rounded-full bg-primary text-[11px] font-bold text-primary-foreground"
                      : "size-5 rounded-full border-2 border-muted"
                  }
                >
                  {complete ? "✓" : ""}
                </span>
                <span className={complete ? "text-foreground" : "text-muted-foreground"}>
                  {J.steps[step]}
                  {complete ? <span className="sr-only"> ({J.stepDone})</span> : null}
                </span>
              </li>
            );
          })}
        </ul>
        {error && (
          <div className="rounded-xl border border-destructive/40 bg-destructive/10 p-4" role="alert">
            <p>{error}</p>
            <Button
              className="mt-3 h-11"
              type="button"
              variant="outline"
              onClick={() => {
                setError(null);
                setDone([]);
                setBusy(false);
              }}
            >
              {J.retry}
            </Button>
          </div>
        )}
      </div>
    );
  }

  const asSignedIn = signedInAs && !notMe ? signedInAs : null;

  return (
    <div className="space-y-4">
      {error && !showEmail && (
        <div className="rounded-xl border border-destructive/40 bg-destructive/10 p-4" role="alert" data-testid="join-error">
          {error}
        </div>
      )}

      {browserHint && (
        <div className="rounded-xl border bg-muted/40 p-4">
          <p className="font-medium">{J.browserTitle}</p>
          <p className="mt-1 text-muted-foreground">{J.browserBody}</p>
          <Button className="mt-3 h-11" type="button" variant="outline" onClick={copyLink}>
            {copied ? J.copied : J.copy}
          </Button>
        </div>
      )}

      {asSignedIn ? (
        <div className="space-y-1">
          <Button className={PUBLIC_PRIMARY} type="button" data-testid="join-continue" onClick={() => run(null)}>
            {fillPublic(J.continueAs, { Nome: asSignedIn.name || asSignedIn.email })}
          </Button>
          <div className="flex items-center justify-between gap-3 text-sm text-muted-foreground">
            <span className="min-w-0 truncate">{asSignedIn.email}</span>
            <button
              className={cn(PUBLIC_LINK, "shrink-0 text-foreground")}
              type="button"
              data-testid="join-not-me"
              onClick={() => {
                setNotMe(true);
                setError(null);
              }}
            >
              {J.notMe}
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <Button className={PUBLIC_PRIMARY} variant={showEmail ? "outline" : "default"} type="button" data-testid="join-google" onClick={withGoogle}>
            {J.google}
          </Button>

          {!showEmail ? (
            <button className={PUBLIC_LINK} type="button" data-testid="join-use-email" onClick={() => setShowEmail(true)}>
              {J.useEmail}
            </button>
          ) : (
            <form className="space-y-4 pt-2" onSubmit={withEmail} noValidate>
              {registering && (
                <div className="space-y-1.5">
                  <Label htmlFor="join-name" className={PUBLIC_LABEL}>
                    {J.name}
                  </Label>
                  <Input
                    id="join-name"
                    className={PUBLIC_FIELD}
                    required
                    autoComplete="name"
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    placeholder={J.namePlaceholder}
                  />
                </div>
              )}
              <div className="space-y-1.5">
                <Label htmlFor="join-email" className={PUBLIC_LABEL}>
                  {J.email}
                </Label>
                <Input
                  id="join-email"
                  className={PUBLIC_FIELD}
                  type="email"
                  required
                  autoComplete="email"
                  inputMode="email"
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="join-password" className={PUBLIC_LABEL}>
                  {J.password}
                </Label>
                <Input
                  id="join-password"
                  className={PUBLIC_FIELD}
                  type="password"
                  required
                  minLength={6}
                  autoComplete={registering ? "new-password" : "current-password"}
                  value={form.password}
                  onChange={(e) => setForm({ ...form, password: e.target.value })}
                />
              </div>
              {error && (
                <p className="rounded-xl border border-destructive/40 bg-destructive/10 p-3" role="alert" data-testid="join-error">
                  {error}
                </p>
              )}
              <Button className={PUBLIC_PRIMARY} type="submit" disabled={busy} data-testid="join-email-submit">
                {registering ? J.register : J.login}
              </Button>
              <button
                className={cn(PUBLIC_LINK, "w-full justify-center text-muted-foreground")}
                type="button"
                data-testid="join-toggle-register"
                onClick={() => {
                  setRegistering((value) => !value);
                  setError(null);
                }}
              >
                {registering ? J.toLogin : J.toRegister}
              </button>
            </form>
          )}
        </div>
      )}
    </div>
  );
}
