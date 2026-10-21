ALTER TABLE pix
  ADD COLUMN IF NOT EXISTS txid text;

ALTER TABLE configuracao
  ADD COLUMN IF NOT EXISTS pix_conciliacao_ate timestamptz;
