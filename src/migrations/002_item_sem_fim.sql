ALTER TABLE item ALTER COLUMN fim_ano DROP NOT NULL;
ALTER TABLE item ALTER COLUMN fim_mes DROP NOT NULL;
ALTER TABLE item DROP CONSTRAINT item_intervalo;
ALTER TABLE item ADD CONSTRAINT item_fim_par CHECK (
  (fim_ano IS NULL AND fim_mes IS NULL) OR (fim_ano IS NOT NULL AND fim_mes IS NOT NULL)
);
ALTER TABLE item ADD CONSTRAINT item_intervalo CHECK (
  fim_ano IS NULL OR inicio_ano < fim_ano OR (inicio_ano = fim_ano AND inicio_mes <= fim_mes)
);
