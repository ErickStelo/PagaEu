ALTER TABLE cobranca
  ADD COLUMN modalidade text NOT NULL DEFAULT 'mensal'
    CHECK (modalidade IN ('mensal', 'avulsa')),
  ADD COLUMN vencimento_em date;

ALTER TABLE cobranca
  ADD CONSTRAINT cobranca_avulsa_vencimento CHECK (
    (modalidade = 'mensal' AND vencimento_em IS NULL)
    OR (modalidade = 'avulsa' AND vencimento_em IS NOT NULL)
  );

DROP INDEX cobranca_ativa_unica;
CREATE UNIQUE INDEX cobranca_ativa_unica
  ON cobranca (pessoa_id, competencia_ano, competencia_mes)
  WHERE status IN ('aberta', 'paga') AND modalidade = 'mensal';

ALTER TABLE linha_cobranca ALTER COLUMN item_id DROP NOT NULL;
