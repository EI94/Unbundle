import type { ReactNode } from "react";
import { PublicCard, PublicCardText, PublicShell, PublicStateCard } from "@/components/public";
import { ErrorCard } from "./screen";

/**
 * Il guscio e le schede di servizio della pagina `/r/[token]` (rilascio 10, §3.11: le stesse parole e lo stesso
 * comportamento del guscio unico delle pagine pubbliche, `src/components/public/`, con le stesse props):
 * - in alto il marchio, non cliccabile, con la riga «{Cliente} · con Lateral Space» quando il cliente si conosce;
 * - una scheda sola per il link che non si può usare (token sbagliato, scaduto, revocato, sezione spenta: sempre lo
 *   stesso testo, così non si capisce quale), senza dati del caso;
 * - una scheda sola per l'errore, con il solo «Riprova» (`ErrorCard`), anche quando il servizio non risponde.
 */

/**
 * Il guscio di ogni schermata del link: il marchio in alto e una colonna di lettura (`max-w-xl`, DESIGN §4.7), con il
 * margine di 16 px al telefono e lo spazio per la barra fissa in basso. Corpo a 16 px. `footer`: il piè di pagina che
 * dà la pagina («Come usiamo le tue risposte», la scadenza del link), solo dove serve.
 */
export function ReferentShell({ children, footer, client }: { children: ReactNode; footer?: ReactNode; client?: string | null }) {
  return (
    <PublicShell footer={footer} client={client}>
      {children}
    </PublicShell>
  );
}

export function LinkCard({ title, body, children }: { title: string; body: string; children?: ReactNode }) {
  return (
    <PublicCard title={title}>
      <PublicCardText>{body}</PublicCardText>
      {children}
    </PublicCard>
  );
}

/** «Questo link non vale più.» — per ogni link che non si può usare, con la sola azione possibile: rispondere all'email. */
export function InvalidLinkCard() {
  return <PublicStateCard kind="link" />;
}

/** Il servizio non risponde (`non_disponibile`): la stessa scheda dell'errore, con «Riprova» che ricarica la pagina. */
export function UnavailableCard() {
  return <ErrorCard />;
}
