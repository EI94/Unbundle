"use client";

import { useEffect } from "react";
import { digestOf } from "@/lib/uc/log";

/**
 * (Ondata 0) L'ultima rete, al posto della pagina inglese di Next: un errore nel layout radice, oppure in una pagina
 * senza un `error.tsx` suo sopra di sé (`/login`, `/invite`, `/share`, `/cli/collega`, `/privacy/ai-readiness`…).
 * Sostituisce tutto il documento, quindi deve avere `<html>` e `<body>` e non ha gli stili dell'app: pochi stili scritti
 * qui, chiari o scuri come il sistema (guida di Next `03-file-conventions/error.md`, «Global Error»).
 *
 * «Riprova» ricarica la pagina intera, come fa la pagina di Next: qui non resta niente da tenere, e dopo un rilascio
 * una scheda rimasta aperta (niente Skew Protection sul piano Hobby) riparte con i file nuovi, cosa che `retry` non fa.
 * Si registra solo il codice dell'errore (`digest`), mai il messaggio.
 */
const CSS = `
:root { color-scheme: light dark; }
body { margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 24px; box-sizing: border-box;
  font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; background: #ffffff; color: #111111; }
main { max-width: 28rem; }
h1 { font-size: 1.5rem; line-height: 1.25; margin: 0 0 8px; font-weight: 600; }
p { margin: 0 0 20px; color: #4b5563; font-size: 0.95rem; line-height: 1.5; }
button { min-height: 44px; padding: 0 20px; border-radius: 8px; border: 0; font: inherit; font-weight: 500; cursor: pointer;
  background: #111111; color: #ffffff; }
button:focus-visible { outline: 3px solid #2563eb; outline-offset: 2px; }
@media (prefers-color-scheme: dark) {
  body { background: #0a0a0a; color: #f2f2f2; }
  p { color: #a3a3a3; }
  button { background: #f2f2f2; color: #0a0a0a; }
  button:focus-visible { outline-color: #60a5fa; }
}
`;

export default function GlobalError({ error }: { error: unknown; retry: () => void }) {
  const digest = digestOf(error);
  useEffect(() => {
    console.error("[app] pagina non caricata", digest ?? "senza codice");
  }, [digest]);
  return (
    <html lang="it">
      <head>
        <title>Questa pagina non si è caricata — Unbundle</title>
        <meta name="robots" content="noindex" />
        <style dangerouslySetInnerHTML={{ __html: CSS }} />
      </head>
      <body>
        <main role="alert">
          <h1>Questa pagina non si è caricata.</h1>
          <p>Quello che hai già salvato resta salvato.</p>
          <button type="button" onClick={() => window.location.reload()}>
            Riprova
          </button>
        </main>
      </body>
    </html>
  );
}
