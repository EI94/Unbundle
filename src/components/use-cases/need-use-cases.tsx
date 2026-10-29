import Link from "next/link";
import { SCREEN_SEPARATOR, keepTogether } from "@/lib/use-cases/line-breaks";
import type { NeedUseCaseRef } from "@/lib/use-cases/needs";
import { cn } from "@/lib/utils";
import { Disclosure } from "./disclosure";

// Al telefono un bersaglio da dito (44 px); dal tablet almeno 24 px.
const TARGET = "min-h-11 sm:min-h-6";

/**
 * Uno use case di un'esigenza: «TJ-0012 · Smistamento», il titolo solo senza codice. Sottolineato come
 * gli altri link dell'area: nel tema scuro --primary è chiaro come il testo e sta dentro righe grigie
 * («Ufficio IT · 30/11 · TJ-0012 · …»), dove il solo colore non basta a dire dove inizia il link.
 */
export function NeedUseCaseLink({ useCase, href, scroll = true }: { useCase: NeedUseCaseRef; href: string; scroll?: boolean }) {
  return (
    <Link
      href={href}
      scroll={scroll}
      data-need-use-case={useCase.id}
      title={useCase.code ? `${useCase.code} · ${useCase.title}` : useCase.title}
      className={cn(
        "inline-flex items-center rounded-sm text-xs text-primary underline underline-offset-2 outline-none hover:decoration-2 focus-visible:ring-3 focus-visible:ring-ring/50",
        TARGET,
      )}
    >
      {/* Righe da 20 px e la sottolineatura a 2 px: sta dentro la riga, e `line-clamp` (overflow nascosto) non la taglia. */}
      <span className="line-clamp-2 leading-5 break-words">
        {useCase.code ? (
          <>
            <span className="font-mono">{useCase.code}</span>
            {SCREEN_SEPARATOR}
          </>
        ) : null}
        {useCase.title}
      </span>
    </Link>
  );
}

/**
 * Gli use case di un'esigenza dietro un titolo chiuso: «Per 3 use case», «Serve anche ad altri 2
 * use case». Il `<details>` nativo si apre con Invio o Spazio e si annuncia come pulsante chiuso o
 * aperto; i suoi link entrano nell'ordine del Tab solo da aperto. `context` (il titolo
 * dell'esigenza) lo leggono solo i lettori di schermo: «Per 3 use case: Accesso al gestionale».
 * Aperto, prende tutta la riga (`open:basis-full`). Senza stato: si rende sul server (la vista
 * «Cosa serve») e nel client (il capitolo della scheda).
 */
export function NeedUseCasesDisclosure({
  summary,
  context,
  useCases,
  hrefOf,
  scroll = true,
  className,
}: {
  summary: string;
  context: string;
  useCases: readonly NeedUseCaseRef[];
  hrefOf: (id: string) => string;
  scroll?: boolean;
  className?: string;
}) {
  return (
    <Disclosure
      slot="need-use-cases"
      className={cn("min-w-0 open:basis-full", className)}
      summaryClassName={cn("text-xs", TARGET)}
      summary={
        <>
          {keepTogether(summary)}
          <span className="sr-only">: {context}</span>
        </>
      }
    >
      <ul className="space-y-1 border-l pl-3">
        {useCases.map((useCase) => (
          <li key={useCase.id}>
            <NeedUseCaseLink useCase={useCase} href={hrefOf(useCase.id)} scroll={scroll} />
          </li>
        ))}
      </ul>
    </Disclosure>
  );
}
