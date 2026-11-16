/**
 * Granola nella pagina «Contesto» (rilascio 9a, docs/contesto/RILASCIO-9a-COSTRUZIONE.md §8.9): la riga «Aggiorna da
 * Granola» e «Da smistare».
 *
 * Questo file è lo **stub** della fondazione: il componente c'è, con le proprietà del piano, e non mostra niente. Il
 * pacchetto «granola» scrive il corpo; il pacchetto «pagina» lo monta. È un componente server asincrono: legge da sé
 * lo stato e non mostra niente a chi non è di Lateral Space.
 */
export interface GranolaInboxProps {
  workspaceId: string;
  workspaceName: string;
  /** Vista «Memoria»: una riga sola, e solo se c'è qualcosa da dire. Senza: il blocco intero della vista «Appunti». */
  compact?: boolean;
}

export async function GranolaInbox(props: GranolaInboxProps): Promise<null> {
  void props;
  return null;
}
