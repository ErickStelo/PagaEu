ALTER TABLE pix
  ADD COLUMN provedor text NOT NULL DEFAULT 'mercadopago'
  CHECK (provedor IN ('mercadopago', 'nativo'));
