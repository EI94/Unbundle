import { INVALID_LINK_MESSAGE } from "@/lib/uc/public-view";

/**
 * Schede di servizio della pagina `/r/[token]`: link non utilizzabile (token
 * sbagliato, scaduto, revocato, sezione spenta: sempre lo stesso testo, così
 * non si capisce quale) e servizio non disponibile. Senza dati del caso.
 */

/**
 * Il guscio di ogni schermata del link: «Unbundle» in alto e una colonna di
 * lettura (`max-w-xl`, DESIGN §4.7), con il margine di 16 px al telefono e lo
 * spazio per la barra fissa in basso. Corpo a 16 px.
 */
export function ReferentShell({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto w-full max-w-xl min-w-0 px-4 pt-5 pb-10 text-base sm:px-6 sm:pt-10">
      <p className="text-sm font-semibold tracking-wide">Unbundle</p>
      {children}
    </main>
  );
}

export function LinkCard({ title, body, children }: { title: string; body: string; children?: React.ReactNode }) {
  return (
    <section className="mt-8 rounded-xl bg-card p-6 text-card-foreground ring-1 ring-foreground/10">
      <h1 className="text-xl font-semibold break-words">{title}</h1>
      <p className="mt-3 text-base leading-7 break-words text-muted-foreground">{body}</p>
      {children}
    </section>
  );
}

/** «Questo link non è più valido.» — per ogni link che non si può usare. */
export function InvalidLinkCard() {
  const [first, ...rest] = INVALID_LINK_MESSAGE.split(". ");
  return <LinkCard title={`${first}.`} body={rest.join(". ")} />;
}

export function UnavailableCard() {
  return <LinkCard title="Servizio non disponibile" body="La pagina non si apre in questo momento. Le risposte già inviate sono al sicuro: riprova tra qualche minuto." />;
}
