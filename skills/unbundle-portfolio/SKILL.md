---
name: unbundle-portfolio
description: Share AI use cases and best practices into Unbundle through the Unbundle MCP tools with reliable intake, confirmation, and workspace validation.
---

# Unbundle Portfolio Intake

Use this skill when a user wants to share, submit, save, or send a best practice or AI use case to Unbundle. Trigger even when the user says this casually, for example "segnala a Unbundle", "manda questo use case a Unbundle", "salva questa best practice", or "puoi proporla nel portfolio?".

## Tools

Use the Unbundle MCP server tools:

- `get_workspace_intake_requirements`: read the connected workspace, ESG setting, required fields, and KPI/scoring model.
- `submit_portfolio_contribution`: create the proposed contribution in Unbundle after explicit user confirmation.

If these tools are unavailable, explain that Unbundle MCP is not connected and do not pretend to submit anything.

## Production Rules

- Always call `get_workspace_intake_requirements` before submitting.
- Treat the MCP token as workspace-bound. Never ask the user for a workspace ID if the tool already resolves one.
- Keep the experience lightweight and confident: explain that you will guide the user, ask one useful question at a time, and avoid internal terms such as API, MCP, token, payload, or schema unless troubleshooting a missing connection.
- Never invent financial impact, EUR, revenue, savings, margins, or profitability numbers. If the user has no verified number, keep the impact qualitative.
- Ask only for missing or ambiguous fields. If the user already answered a field naturally earlier in the conversation, reuse it.
- Check that each answer matches the field being filled. Example: for a use case, "tutta Nativa" is a beneficiary answer, not human control. Ask again for who reviews, approves, or validates the AI output.
- Do not submit until the user has explicitly confirmed the final summary.
- If the tool returns an error, report what happened and what the user can do next. Do not claim that the contribution was saved.

## Classify The Contribution

Use `best_practice` when the user describes something already implemented or already working with AI.

Use `use_case_ai` when the user describes an idea, proposal, opportunity, or desired future process.

If unclear, ask:

`È una best practice già in uso, oppure un nuovo use case AI che vorresti proporre?`

## Required Fields

For `use_case_ai`, collect:

- `title`: short clear name.
- `problem`: current situation or friction.
- `flowDescription`: as-is to to-be flow with AI.
- `humanInTheLoop`: who reviews, approves, validates, or controls the output.
- `guardrails`: controls, limits, compliance, escalation, or things AI must not do.
- `expectedImpact`: concrete expected benefit, qualitative unless verified data exists.
- `dataRequirements`: data, documents, systems, accesses, or materials needed.
- `urgency`: optional quick win or structured project.
- `sustainabilityImpact`: required only if the workspace says ESG is enabled.

For `best_practice`, collect:

- `title`: short clear name.
- `problem`: how the process worked before AI.
- `flowDescription`: how it works now with AI.
- `expectedImpact`: observed benefit.
- `humanInTheLoop`: who uses it or benefits from it.
- `dataRequirements`: what is needed to replicate it.
- `sustainabilityImpact`: required only if the workspace says ESG is enabled.

## Conversation Flow

1. Call `get_workspace_intake_requirements`.
2. Determine `contributionKind`.
3. Extract any already-provided fields from the conversation.
4. Ask one focused question at a time for missing fields.
5. If the user gives a vague answer (`ok`, `non so`, `tutto`, `boh`) ask for one concrete sentence.
6. If the answer belongs to a different field than the one being asked, save it in the correct field and ask again for the missing field instead of forcing it into the current slot.
7. Show a concise final summary with all fields that will be sent to Unbundle.
8. Ask: `Confermi che posso inviare questo contributo a Unbundle?`
9. Only after confirmation, call `submit_portfolio_contribution` with `confirmedByUser: true`.

## First Message Style

When the flow starts, respond like a helpful intake partner:

`Perfetto, ti guido io. Raccolgo solo le informazioni utili, poi ti mostro il riepilogo e invio a Unbundle solo dopo tua conferma.`

Then continue with the first missing question.

## Submitter

Fill `submittedBy` with the best available identifier:

- use the user email if they explicitly provide it,
- otherwise use their name,
- otherwise use an external user id if available,
- if none is available, ask `Con quale nome o email vuoi risultare come autore del contributo?`

## Idempotency

The MCP server can derive a stable `idempotencyKey`, so you may omit it. If retrying the exact same final submission manually, reuse the same `idempotencyKey` if you already provided one.

## Final Response After Tool Call

On success, say that the contribution is now in Unbundle and include:

- title,
- type (`best_practice` or `use_case_ai`),
- review status,
- score if returned,
- review link if returned.

On duplicate success, explain that Unbundle recognized the retry and did not create a duplicate.
