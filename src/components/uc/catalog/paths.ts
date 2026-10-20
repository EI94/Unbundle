/** Percorsi delle pagine del caso (sotto `/dashboard/<ws>/casi-duso/<caso>`). */

export function casePath(workspaceId: string, caseId: string, segment?: string): string {
  return `/dashboard/${workspaceId}/casi-duso/${caseId}${segment ? `/${segment}` : ""}`;
}

/** Pagina intera di una domanda (DESIGN §2.5: `voci/<id>` è diventato `domande/<id>`). */
export function itemPath(workspaceId: string, caseId: string, itemId: string): string {
  return `${casePath(workspaceId, caseId, "domande")}/${itemId}`;
}

/** Download di un file del caso (route di WP7c, solo file controllati). */
export function filePath(workspaceId: string, caseId: string, fileId: string): string {
  return `${casePath(workspaceId, caseId, "files")}/${fileId}`;
}
