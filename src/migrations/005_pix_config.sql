ALTER TABLE configuracao
  ADD COLUMN IF NOT EXISTS pix_provedor text NOT NULL DEFAULT 'mercadopago'
    CHECK (pix_provedor IN ('mercadopago', 'nativo')),
  ADD COLUMN IF NOT EXISTS pix_chave text,
  ADD COLUMN IF NOT EXISTS pix_recebedor text NOT NULL DEFAULT 'Erick Vinicius Stelo',
  ADD COLUMN IF NOT EXISTS pix_cidade text NOT NULL DEFAULT 'Passo Fundo';
