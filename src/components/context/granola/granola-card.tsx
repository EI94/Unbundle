/**
 * Il blocco «Granola» delle Impostazioni (rilascio 9a, docs/contesto/RILASCIO-9a-COSTRUZIONE.md §8.9).
 *
 * Questo file è lo **stub** della fondazione: il componente c'è, con le proprietà del piano, e non mostra niente. Il
 * pacchetto «granola» scrive il corpo. È un componente server asincrono: legge da sé lo stato (`loadGranolaStatus`) e
 * decide da sé che cosa mostrare; a chi non è di Lateral Space niente.
 *
 * È già montato in `settings/page.tsx`, dentro «Integrazioni», in un contenitore con `id="granola"` (l'ancora a cui
 * tornano il collegamento e il link dalla pagina «Contesto»): il blocco non mette un altro `id`.
 */
export interface GranolaCardProps {
  workspaceId: string;
  workspaceName: string;
  userId: string;
  role: string;
  /** `?granola=…` dell'indirizzo, dopo il ritorno da Granola (§8.2): `collegato`, `annullato`, `scaduto`, `errore`. */
  flash?: string;
}

export async function GranolaCard(props: GranolaCardProps): Promise<null> {
  void props;
  return null;
}
