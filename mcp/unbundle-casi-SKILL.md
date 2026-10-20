---
name: unbundle-casi
description: Read a validated Unbundle use case catalog (frozen version) through the read-only unbundle-casi MCP tools, to develop models, schemas and rules only from data that Lateral Space and the client have validated.
---

# Unbundle Casi d'uso (read only)

Use this skill when the user develops, specifies or checks a use case that lives in Unbundle «Casi d'uso»: building the model, writing SQL schemas or classes, coding rules and constraints, preparing test cases, or asking what is still missing before development. Trigger also on casual requests such as "leggi il catalogo del caso", "cosa manca per il gate?", "genera lo schema dal dizionario dati", "su quale versione stiamo lavorando?".

## Tools

The `unbundle-casi` MCP server exposes five read-only tools:

- `list_cases`: the case (dossier) this token can read, with status, frozen catalog version and G1 readiness. Call it first to get the `caseId`. The old name `list_use_cases` still works for one release; always use `list_cases`.
- `get_validated_catalog {caseId, version?, kinds?}`: only validated (green) items and approved not-applicable (blue) items of a frozen catalog version, with values, units, sources, answer versions and links. Without `version` it reads the latest frozen version. It never returns the draft.
- `get_open_items {caseId}`: required G1 items that are not ready yet, with module, role label and due date.
- `get_data_dictionary {caseId}`: entities and fields with data type, unit, required flag and privacy class. Structure only.
- `get_gate_status {caseId}`: the live G1 computation and the history of gate decisions (dates and roles).

Nothing here writes to Unbundle. If the user asks to validate, approve, answer or send requests, explain that it happens in Unbundle by Lateral Space and the client, not through Claude.

If the tools are unavailable, say that the Unbundle casi MCP server is not connected. Do not pretend to have read the catalog.

## Rules

- The validated catalog is the only source of truth for development. Build only on the items that `get_validated_catalog` returns.
- Always state the catalog version you used, for example "catalogo v2", in specs, code comments and answers. If the version changes, say what changed before reusing earlier work.
- Items in `excluded` are not validated. Never use their values, never guess them, never fill them with plausible numbers. List them as open questions for Lateral Space.
- `value_hidden` means the value is not available to you:
  - `personale`: personal data never leaves Unbundle. Do not ask the user to paste it.
  - `ambiente_non_approvato`: company-reserved values (costs, prices, thresholds) stay hidden until the AI environment of the case is approved in writing. Work with keys, types and units; use clearly marked synthetic placeholders only if the user asks, and never present them as real.
  - `visibilita`: the value is not visible to this role.
- `text_hidden: "ambiente_non_approvato"` means titles, explanations and rule texts are hidden for the same reason. Do not try to reconstruct them from keys or from memory. Ask the user to read the item in Unbundle if they need the wording.
- Never ask for or record names, emails, phone numbers, health data, or customer preferences about gender, age, origin or religion.
- Open items show role labels, never people. Do not rank people or estimate response times.
- Rules and hard constraints (`regola`, `vincolo_rigido`) must be implemented exactly as validated. If a rule looks wrong, flag it; do not silently change it.

## Typical flow

1. Call `list_cases` and confirm the case code and the frozen catalog version.
2. If there is no frozen version yet (`nessuna_versione_congelata`), call `get_gate_status` and `get_open_items` to explain what is missing for G1, then stop: development starts after the gate.
3. Call `get_data_dictionary` to shape schemas or classes.
4. Call `get_validated_catalog`, optionally filtered by `kinds` (for example `["regola", "vincolo_rigido", "parametro"]`).
5. Develop only on validated items. Keep a short list of excluded or hidden items as questions for Lateral Space.

## Errors

- 401: the token is missing, expired or revoked. A Lateral Space lead creates a new one from the case (menu ⋯ > Sviluppo con Claude).
- 403: the token does not include this read (catalog or case status), or it is not limited to one case.
- 404: the case does not exist, is closed, or the token belongs to another case; or the requested catalog version does not exist.
- Timeout or network error: retry later; do not invent the missing data.

Every read is recorded in the case audit log with the token used.
