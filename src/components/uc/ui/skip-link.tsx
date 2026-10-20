/**
 * «Salta al contenuto» (DESIGN §5.4, §7.2): invisibile finché non ha il focus,
 * porta all'elemento con `id={targetId}`, che deve avere `tabIndex={-1}` per
 * ricevere il focus.
 *
 * Il dossier lo monta in cima al suo layout, prima della testata: salta
 * percorso, pulsante, menu e schede. Non è ancora il primo elemento che si
 * raggiunge con il tasto Tab: il layout del workspace mette prima la barra
 * laterale e la barra in alto, e chi usa la tastiera le attraversa tutte prima
 * di arrivarci.
 *
 * Il layout del workspace (`[workspaceId]/layout.tsx`) e la barra laterale
 * sono dell'hub (H4i, `docs/use-case/PIANO-LAVORI.md` §4): qui non si toccano.
 * Consegna a H4i (regola 1 di §8.1): `<SkipLink />` come primo figlio di
 * `<SidebarProvider>`, prima di `<AppSidebar>`, con lo stesso bersaglio
 * (`#uc-contenuto`) nelle pagine del dossier, o un bersaglio generico sul
 * contenuto principale nelle altre. Il link del dossier può restare come
 * secondo salto. Finché non arriva, l'accettazione «prima della barra
 * laterale» (DESIGN §5.4) resta aperta.
 */
export const UC_CONTENT_ID = "uc-contenuto";

export function SkipLink({ targetId = UC_CONTENT_ID, label = "Salta al contenuto" }: { targetId?: string; label?: string }) {
  return (
    <a
      href={`#${targetId}`}
      className="sr-only focus-visible:not-sr-only focus-visible:fixed focus-visible:top-3 focus-visible:left-3 focus-visible:z-50 focus-visible:inline-flex focus-visible:min-h-11 focus-visible:items-center focus-visible:rounded-md focus-visible:bg-background focus-visible:px-4 focus-visible:text-sm focus-visible:font-medium focus-visible:text-foreground focus-visible:shadow-md focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
    >
      {label}
    </a>
  );
}
