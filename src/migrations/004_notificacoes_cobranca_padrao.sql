ALTER TABLE pessoa ALTER COLUMN cobranca_notificacoes_qtd SET DEFAULT 3;
ALTER TABLE pessoa ALTER COLUMN cobranca_notificacoes_intervalo_dias SET DEFAULT 2;
ALTER TABLE pessoa ALTER COLUMN cobranca_notificacoes_apos_vencimento_dias SET DEFAULT 2;

UPDATE pessoa
SET cobranca_notificacoes_qtd = 3,
    cobranca_notificacoes_intervalo_dias = 2,
    cobranca_notificacoes_apos_vencimento_dias = 2
WHERE cobranca_notificacoes_qtd = 1
  AND cobranca_notificacoes_intervalo_dias = 2
  AND cobranca_notificacoes_apos_vencimento_dias = 0;
