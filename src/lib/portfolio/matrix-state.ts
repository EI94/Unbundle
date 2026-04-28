export type MatrixServerItem = {
  id: string;
  updatedAt?: Date | string | null;
};

export type MatrixScoreOverride = {
  updatedAt?: Date | string | null;
  [key: string]: unknown;
};

function timestamp(value: Date | string | null | undefined) {
  if (!value) return null;
  const time = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isFinite(time) ? time : null;
}

/**
 * Gli override ottimistici servono per muovere subito il punto dopo un save.
 * Appena il Server Component torna con dati almeno altrettanto freschi,
 * l'override va eliminato: altrimenti può bloccare la matrice su vecchi valori.
 */
export function reconcileScoreOverridesWithServerItems<
  TOverride extends MatrixScoreOverride,
>(
  overrides: Record<string, TOverride>,
  serverItems: MatrixServerItem[]
) {
  let changed = false;
  const next = { ...overrides };

  for (const item of serverItems) {
    const override = next[item.id];
    if (!override) continue;

    const serverUpdatedAt = timestamp(item.updatedAt);
    const overrideUpdatedAt = timestamp(override.updatedAt);
    if (
      serverUpdatedAt !== null &&
      overrideUpdatedAt !== null &&
      serverUpdatedAt >= overrideUpdatedAt
    ) {
      delete next[item.id];
      changed = true;
    }
  }

  return changed ? next : overrides;
}
