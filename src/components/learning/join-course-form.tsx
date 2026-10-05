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
import { joinCourseByLinkAction } from "@/lib/actions/learning-join";
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
 */

type Step = "account" | "enroll" | "open";

const STEP_LABELS: Record<Step, string> = {
  account: "Account verificato",
  enroll: "Iscrizione alla lezione",
  open: "Apro il corso",
};

const FIREBASE_MESSAGES: Record<string, string> = {
  "auth/email-already-in-use":
    "Questa email ha già un account. Usa la password che hai scelto allora, oppure entra con Google.",
  "auth/invalid-email": "Controlla l'indirizzo email.",
  "auth/weak-password": "Serve una password di almeno 6 caratteri.",
  "auth/user-not-found": "Nessun account con questa email: usa «Crea un account».",
  "auth/wrong-password": "Password errata.",
  "auth/invalid-credential": "Email o password non corrette. Se è la prima volta, tocca «Non ho un account: creane uno».",
  "auth/too-many-requests": "Troppi tentativi. Aspetta un minuto e riprova.",
  "auth/network-request-failed":
    "Connessione interrotta. Controlla la rete e riprova: non hai perso nulla.",
  "auth/popup-closed-by-user": "Finestra chiusa prima di finire. Riprova.",
};

/** Le webview di WhatsApp e Teams non supportano la finestra di Google. */
const NEEDS_REDIRECT = new Set([
  "auth/popup-blocked",
  "auth/operation-not-supported-in-this-environment",
  "auth/web-storage-unsupported",
]);

export function JoinCourseForm({
  token,
  signedInAs,
  courseTitle,
}: {
  token: string;
  signedInAs: { name: string | null; email: string } | null;
  courseTitle: string;
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
    if (code) return { code, message: FIREBASE_MESSAGES[code] ?? null };
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
          throw new Error(
            body.error ??
              "Non è stato possibile aprire la sessione. Riprova ad accedere."
          );
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
        setError("Non è stato possibile completare l'iscrizione. Riprova.");
        setDone([]);
        return;
      }
      setDone(["account", "enroll"]);
      setDone(["account", "enroll", "open"]);
      router.replace(result.path);
    } catch (err) {
      const { message } = describe(err);
      setError(
        message ??
          "Qualcosa non ha funzionato. Riprova: nessuna delle tue risposte è andata persa."
      );
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
          setError(
            "Questa app non permette di accedere con Google. Apri il link in Safari o Chrome."
          );
        }
      } else {
        setError(message ?? "Accesso con Google non riuscito. Riprova.");
      }
    } finally {
      setBusy(false);
    }
  }

  async function withEmail(event: React.FormEvent) {
    event.preventDefault();
    if (registering && !form.name.trim()) {
      setError("Scrivi nome e cognome: compaiono nel registro della formazione.");
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
      setError(message ?? "Accesso non riuscito. Controlla email e password.");
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
      setError("Copia non riuscita: seleziona l'indirizzo dalla barra del browser.");
    }
  }

  if (busy || done.length > 0) {
    const steps: Step[] = ["account", "enroll", "open"];
    return (
      <div className="space-y-3" data-testid="join-progress">
        <p className="text-sm font-medium">Ti sto portando dentro al corso…</p>
        <ul className="space-y-2" aria-live="polite">
          {steps.map((step) => {
            const complete = done.includes(step);
            return (
              <li
                key={step}
                className="flex items-center gap-3 text-sm"
                data-step={step}
                data-state={complete ? "done" : "pending"}
              >
                <span
                  aria-hidden
                  className={
                    complete
                      ? "flex size-5 items-center justify-center rounded-full bg-emerald-600 text-[11px] font-bold text-white"
                      : "size-5 rounded-full border-2 border-muted"
                  }
                >
                  {complete ? "✓" : ""}
                </span>
                <span className={complete ? "text-foreground" : "text-muted-foreground"}>
                  {STEP_LABELS[step]}
                </span>
              </li>
            );
          })}
        </ul>
        {error && (
          <div
            className="rounded-2xl border border-destructive/40 bg-destructive/10 p-4 text-sm"
            role="alert"
          >
            <p>{error}</p>
            <Button
              className="mt-3"
              type="button"
              variant="outline"
              onClick={() => {
                setError(null);
                setDone([]);
                setBusy(false);
              }}
            >
              Riprova
            </Button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {error && !showEmail && (
        <div
          className="rounded-2xl border border-destructive/40 bg-destructive/10 p-4 text-sm"
          role="alert"
          data-testid="join-error"
        >
          {error}
        </div>
      )}

      {browserHint && (
        <div className="rounded-2xl border bg-muted/40 p-4 text-sm">
          <p className="font-medium">Apri il link nel browser</p>
          <p className="mt-1 text-muted-foreground">
            L&apos;app da cui hai aperto il link non permette l&apos;accesso con
            Google.
          </p>
          <Button className="mt-3" type="button" variant="outline" onClick={copyLink}>
            {copied ? "Indirizzo copiato" : "Copia l'indirizzo"}
          </Button>
        </div>
      )}

      {signedInAs ? (
        <div className="space-y-3">
          <Button
            className="h-12 w-full text-base"
            size="lg"
            type="button"
            data-testid="join-continue"
            onClick={() => run(null)}
          >
            Entra nel corso come {signedInAs.name || signedInAs.email}
          </Button>
          <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
            <span className="min-w-0 truncate">{signedInAs.email}</span>
            <button
              className="shrink-0 font-medium text-foreground underline"
              type="button"
              onClick={() => {
                setShowEmail(false);
                void withGoogle();
              }}
            >
              Non sono io
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <Button
            className="h-12 w-full text-base"
            size="lg"
            type="button"
            data-testid="join-google"
            onClick={withGoogle}
          >
            Entra con Google
          </Button>

          {!showEmail ? (
            <Button
              className="h-12 w-full text-base"
              size="lg"
              variant="outline"
              type="button"
              data-testid="join-use-email"
              onClick={() => setShowEmail(true)}
            >
              Entra con email e password
            </Button>
          ) : (
            <form className="space-y-3 rounded-2xl border bg-background/60 p-4" onSubmit={withEmail} noValidate>
              {registering && (
                <div className="space-y-1.5">
                  <Label htmlFor="join-name">Nome e cognome</Label>
                  <Input
                    id="join-name"
                    className="h-11"
                    required
                    autoComplete="name"
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    placeholder="Come ti chiami"
                  />
                </div>
              )}
              <div className="space-y-1.5">
                <Label htmlFor="join-email">Email</Label>
                <Input
                  id="join-email"
                  className="h-11"
                  type="email"
                  required
                  autoComplete="email"
                  inputMode="email"
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="join-password">Password</Label>
                <Input
                  id="join-password"
                  className="h-11"
                  type="password"
                  required
                  minLength={6}
                  autoComplete={registering ? "new-password" : "current-password"}
                  value={form.password}
                  onChange={(e) => setForm({ ...form, password: e.target.value })}
                />
              </div>
              {error && (
                <p className="rounded-xl border border-destructive/40 bg-destructive/10 p-3 text-sm" role="alert" data-testid="join-error">
                  {error}
                </p>
              )}
              <Button className="h-12 w-full text-base" type="submit" disabled={busy} data-testid="join-email-submit">
                {registering ? "Crea l'account ed entra" : "Entra nel corso"}
              </Button>
              <button
                className="min-h-10 w-full text-center text-sm text-muted-foreground underline"
                type="button"
                data-testid="join-toggle-register"
                onClick={() => { setRegistering((value) => !value); setError(null); }}
              >
                {registering
                  ? "Ho già un account: accedi"
                  : "Non ho un account: creane uno"}
              </button>
            </form>
          )}
        </div>
      )}

      <p className="text-center text-xs text-muted-foreground">
        Entrando ti iscrivi a «{courseTitle}».
      </p>
    </div>
  );
}
