ALTER TABLE configuracao
  ADD COLUMN IF NOT EXISTS evolution_url text,
  ADD COLUMN IF NOT EXISTS evolution_instance text,
  ADD COLUMN IF NOT EXISTS evolution_api_key text;
