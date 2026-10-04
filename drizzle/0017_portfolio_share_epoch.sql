-- Contatore di revoca dei link pubblici al portfolio (src/lib/portfolio/share-link.ts).
-- Alzarlo invalida tutti i link già condivisi su Slack e via webhook.
ALTER TABLE "workspaces" ADD COLUMN IF NOT EXISTS "portfolio_share_epoch" integer NOT NULL DEFAULT 0;
