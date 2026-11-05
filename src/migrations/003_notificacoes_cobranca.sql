ALTER TABLE pessoa
  ADD COLUMN cobranca_notificacoes_qtd integer NOT NULL DEFAULT 3
    CHECK (cobranca_notificacoes_qtd BETWEEN 1 AND 10),
  ADD COLUMN cobranca_notificacoes_intervalo_dias integer NOT NULL DEFAULT 2
    CHECK (cobranca_notificacoes_intervalo_dias BETWEEN 1 AND 60),
  ADD COLUMN cobranca_notificacoes_apos_vencimento_dias integer NOT NULL DEFAULT 2
    CHECK (cobranca_notificacoes_apos_vencimento_dias BETWEEN 0 AND 60);

ALTER TABLE pix
  ADD COLUMN cobranca_notificacoes_auto integer NOT NULL DEFAULT 0
    CHECK (cobranca_notificacoes_auto >= 0);
