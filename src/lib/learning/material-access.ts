/**
 * Chi può vedere e scaricare un materiale del corso.
 *
 * Funzione pura: la rotta di download e la pagina del corso la usano entrambe,
 * così ciò che la pagina mostra come scaricabile è esattamente ciò che la rotta
 * concede. L'autorizzazione all'oggetto (workspace, programma) resta a carico
 * del chiamante.
 */

export type MaterialRules = {
  audience: string;
  availableAfterSession: boolean;
};

export type MaterialViewer = {
  /** Ruolo di avvio nel workspace o permesso attivo sul corso. */
  trainer: boolean;
  /** Iscrizione attiva al corso. */
  enrolled: boolean;
  /** Il corso è visibile ai partecipanti. */
  featureEnabled: boolean;
  /** Il turno del partecipante, se ne ha uno. */
  session: { endsAt: Date | string; status: string } | null;
};

export type MaterialAccess =
  | { visible: false }
  | { visible: true; downloadable: true; reason: null; availableFrom: null }
  | { visible: true; downloadable: false; reason: string; availableFrom: string | null };

function timeLabel(value: Date) {
  return new Intl.DateTimeFormat("it-IT", {
    timeZone: "Europe/Rome",
    weekday: "long",
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
  }).format(value);
}

export function materialAccess(
  rules: MaterialRules,
  viewer: MaterialViewer,
  now: number
): MaterialAccess {
  // I formatori vedono tutto, comprese le slide con le note di regia.
  if (viewer.trainer) return { visible: true, downloadable: true, reason: null, availableFrom: null };

  // Un materiale di regia non esiste, per chi non forma: nemmeno il titolo.
  if (rules.audience !== "learners") return { visible: false };
  if (!viewer.enrolled || !viewer.featureEnabled) return { visible: false };

  if (!rules.availableAfterSession) {
    return { visible: true, downloadable: true, reason: null, availableFrom: null };
  }

  // Materiale che contiene le soluzioni: si apre a lezione conclusa.
  if (!viewer.session) {
    return {
      visible: true,
      downloadable: false,
      reason: "Disponibile a fine lezione.",
      availableFrom: null,
    };
  }
  const ends = new Date(viewer.session.endsAt);
  const validEnd = Number.isFinite(ends.getTime());
  const ended = viewer.session.status === "closed" || (validEnd && now >= ends.getTime());
  if (ended) return { visible: true, downloadable: true, reason: null, availableFrom: null };
  // Una data illeggibile non deve aprire il materiale, né far fallire la pagina.
  if (!validEnd) {
    return { visible: true, downloadable: false, reason: "Disponibile a fine lezione.", availableFrom: null };
  }
  return {
    visible: true,
    downloadable: false,
    reason: `Disponibile a fine lezione, da ${timeLabel(ends)}.`,
    availableFrom: ends.toISOString(),
  };
}

/** Nome di file sicuro per l'intestazione Content-Disposition. */
export function contentDisposition(fileName: string) {
  const ascii = fileName
    .normalize("NFKD")
    .replace(/[^\x20-\x7e]/g, "")
    .replace(/["\\/]/g, "_")
    .trim() || "materiale";
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}
