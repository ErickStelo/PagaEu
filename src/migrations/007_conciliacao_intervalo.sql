ALTER TABLE configuracao
  ADD COLUMN IF NOT EXISTS conciliacao_intervalo_minutos integer NOT NULL DEFAULT 60
  CHECK (conciliacao_intervalo_minutos IN (0, 15, 30, 60, 360, 1440));
