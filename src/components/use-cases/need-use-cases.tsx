import Link from "next/link";
import { agentToneOf, titleAgent, type AgentPalette } from "@/lib/use-cases/agents";
import { SCREEN_SEPARATOR, keepTogether } from "@/lib/use-cases/line-breaks";
import type { NeedUseCaseRef } from "@/lib/use-cases/needs";
import { cn } from "@/lib/utils";
import { AgentTag } from "./agent-tag";
import { Disclosure } from "./disclosure";

// Al telefono un bersaglio da dito (44 px); dal tablet almeno 24 px.
const TARGET = "min-h-11 sm:min-h-6";

/**
 * Uno use case di un'esigenza: «RD-0012 · Smistamento», il titolo solo senza codice. Sottolineato come
 * gli altri link dell'area: nel tema scuro --primary è chiaro come il testo e sta dentro righe grigie
 * («Ufficio IT · 30/11 · RD-0012 · …»), dove il solo colore non basta a dire dove inizia il link.
 * (Rilascio 10, §3.4) Con `agentTag` (la vista «Cosa serve») un titolo con l'agente ha il tag nel suo colore al posto
 * del prefisso, come le card della Panoramica: «[LIBRA L1] Smistamento»; il prefisso resta per i lettori di schermo.
 */
export function NeedUseCaseLink({
  useCase,
  href,
  scroll = true,
  agentTag = false,
  palette = null,
}: {
  useCase: NeedUseCaseRef;
  href: string;
  scroll?: boolean;
  /** (Rilascio 10) Il tag dell'agente al posto del prefisso e del codice. */
  agentTag?: boolean;
  /** I colori degli agenti del workspace, per il tag. */
  palette?: AgentPalette | null;
}) {
  const agent = agentTag ? titleAgent(useCase.title) : null;
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
        {agent ? (
          <>
            <AgentTag label={agent.label} tone={agentToneOf(palette, agent.agent)} decorative className="mr-1.5 align-[1px]" />
            <span className="sr-only">{agent.prefix}</span>
            {agent.rest}
          </>
        ) : useCase.code ? (
          <>
            <span className="font-mono">{useCase.code}</span>
            {SCREEN_SEPARATOR}
            {useCase.title}
          </>
        ) : (
          useCase.title
        )}
      </span>
    </Link>
  );
}

/**
 * Gli use case di un'esigenza dietro un titolo chiuso: «Per 3 use case», «Serve anche ad altri 2
 * use case». Il `<details>` nativo si apre con Invio o Spazio e si annuncia come pulsante chiuso o
 * aperto; i suoi link entrano nell'ordine del Tab solo da aperto. `context` (il titolo
 * dell'esigenza) lo leggono solo i lettori di schermo: «Per 3 use case: Accesso al gestionale».
 * Con `contextId` (l'id del titolo già in pagina, la vista «Cosa serve») il titolo non si ripete:
 * i lettori di schermo lo leggono come descrizione del riassunto (`aria-describedby`).
 * Aperto, prende tutta la riga (`open:basis-full`). Senza stato: si rende sul server (la vista
 * «Cosa serve») e nel client (il capitolo della scheda).
 */
export function NeedUseCasesDisclosure({
  summary,
  context,
  contextId,
  useCases,
  hrefOf,
  scroll = true,
  className,
  agentTag = false,
  palette = null,
}: {
  summary: string;
  /** Il titolo dell'esigenza, solo per i lettori di schermo; con `contextId` non serve. */
  context?: string;
  /** L'id del titolo dell'esigenza già in pagina: la descrizione del riassunto, senza ripeterlo. */
  contextId?: string;
  useCases: readonly NeedUseCaseRef[];
  hrefOf: (id: string) => string;
  scroll?: boolean;
  className?: string;
  /** (Rilascio 10) I link con il tag dell'agente (`NeedUseCaseLink`). */
  agentTag?: boolean;
  palette?: AgentPalette | null;
}) {
  return (
    <Disclosure
      slot="need-use-cases"
      className={cn("min-w-0 open:basis-full", className)}
      summaryClassName={cn("text-xs", TARGET)}
      summaryDescribedBy={contextId}
      summary={
        <>
          {keepTogether(summary)}
          {!contextId && context ? <span className="sr-only">: {context}</span> : null}
        </>
      }
    >
      <ul className="space-y-1 border-l pl-3">
        {useCases.map((useCase) => (
          <li key={useCase.id}>
            <NeedUseCaseLink useCase={useCase} href={hrefOf(useCase.id)} scroll={scroll} agentTag={agentTag} palette={palette} />
          </li>
        ))}
      </ul>
    </Disclosure>
  );
}
