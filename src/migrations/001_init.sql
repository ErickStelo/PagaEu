CREATE TABLE configuracao (
  id integer PRIMARY KEY CHECK (id = 1),
  usuario_painel text NOT NULL,
  senha_painel_hash text NOT NULL,
  email_dono text NOT NULL,
  mp_access_token text,
  mp_webhook_secret text,
  smtp_host text,
  smtp_porta integer,
  smtp_usuario text,
  smtp_senha text,
  smtp_remetente_nome text,
  smtp_remetente_email text,
  smtp_criptografia text,
  evolution_teste_em timestamptz,
  evolution_teste_ok boolean,
  evolution_teste_motivo text,
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT configuracao_smtp_criptografia CHECK (
    smtp_criptografia IS NULL OR smtp_criptografia IN ('nenhuma', 'starttls', 'tls_implicito')
  )
);

CREATE TABLE codigo_login (
  id uuid PRIMARY KEY,
  codigo_hash text NOT NULL,
  expira_em timestamptz NOT NULL,
  usado_em timestamptz,
  criado_em timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE sessao (
  id uuid PRIMARY KEY,
  csrf text NOT NULL,
  ultimo_uso_em timestamptz NOT NULL,
  criado_em timestamptz NOT NULL DEFAULT now(),
  flash text
);

CREATE TABLE pessoa (
  id uuid PRIMARY KEY,
  nome text NOT NULL CHECK (char_length(nome) BETWEEN 1 AND 120),
  whatsapp text NOT NULL,
  email text NOT NULL,
  cpf text,
  dia_cobranca integer NOT NULL CHECK (dia_cobranca BETWEEN 1 AND 31),
  dia_cobranca_pendente integer CHECK (dia_cobranca_pendente BETWEEN 1 AND 31),
  dia_pendente_ano integer,
  dia_pendente_mes integer,
  validade_pix_dias integer NOT NULL DEFAULT 10 CHECK (validade_pix_dias BETWEEN 1 AND 30),
  dias_aviso_inadimplencia integer NOT NULL DEFAULT 5 CHECK (dias_aviso_inadimplencia BETWEEN 1 AND 60),
  canal_email boolean NOT NULL DEFAULT true,
  canal_whatsapp boolean NOT NULL DEFAULT true,
  ativa boolean NOT NULL DEFAULT true,
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pessoa_dia_pendente CHECK (
    (
      dia_cobranca_pendente IS NULL
      AND dia_pendente_ano IS NULL
      AND dia_pendente_mes IS NULL
    ) OR (
      dia_cobranca_pendente IS NOT NULL
      AND dia_pendente_ano IS NOT NULL
      AND dia_pendente_mes BETWEEN 1 AND 12
    )
  )
);

CREATE TABLE item (
  id uuid PRIMARY KEY,
  pessoa_id uuid NOT NULL REFERENCES pessoa (id),
  descricao text NOT NULL CHECK (char_length(descricao) BETWEEN 1 AND 200),
  valor_centavos integer NOT NULL CHECK (valor_centavos BETWEEN 1 AND 99999999),
  inicio_ano integer NOT NULL CHECK (inicio_ano BETWEEN 2000 AND 2100),
  inicio_mes integer NOT NULL CHECK (inicio_mes BETWEEN 1 AND 12),
  fim_ano integer NOT NULL CHECK (fim_ano BETWEEN 2000 AND 2100),
  fim_mes integer NOT NULL CHECK (fim_mes BETWEEN 1 AND 12),
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT item_intervalo CHECK (
    (inicio_ano < fim_ano) OR (inicio_ano = fim_ano AND inicio_mes <= fim_mes)
  )
);

CREATE TABLE cobranca (
  id uuid PRIMARY KEY,
  pessoa_id uuid NOT NULL REFERENCES pessoa (id),
  competencia_ano integer NOT NULL CHECK (competencia_ano BETWEEN 2000 AND 2100),
  competencia_mes integer NOT NULL CHECK (competencia_mes BETWEEN 1 AND 12),
  anterior_id uuid REFERENCES cobranca (id),
  origem_geracao text NOT NULL CHECK (origem_geracao IN ('job', 'manual', 'lote')),
  status text NOT NULL CHECK (status IN ('aberta', 'paga', 'cancelada')),
  paga_em timestamptz,
  origem_baixa text CHECK (origem_baixa IN ('pagamento', 'manual', 'cascata')),
  quitada_por_id uuid REFERENCES cobranca (id),
  cancelada_em timestamptz,
  motivo_cancelamento text,
  canal_email_selecionado boolean NOT NULL,
  canal_whatsapp_selecionado boolean NOT NULL,
  alerta_itens_ja_pagos boolean NOT NULL DEFAULT false,
  criado_em timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cobranca_status_ok CHECK (
    (
      status = 'aberta'
      AND paga_em IS NULL
      AND origem_baixa IS NULL
      AND cancelada_em IS NULL
      AND motivo_cancelamento IS NULL
    ) OR (
      status = 'paga'
      AND paga_em IS NOT NULL
      AND origem_baixa IS NOT NULL
      AND cancelada_em IS NULL
    ) OR (
      status = 'cancelada'
      AND cancelada_em IS NOT NULL
      AND motivo_cancelamento IS NOT NULL
      AND paga_em IS NULL
      AND origem_baixa IS NULL
    )
  ),
  CONSTRAINT cobranca_cascata_ok CHECK (
    (origem_baixa = 'cascata' AND quitada_por_id IS NOT NULL)
    OR (origem_baixa IS DISTINCT FROM 'cascata')
  )
);

CREATE UNIQUE INDEX cobranca_ativa_unica
  ON cobranca (pessoa_id, competencia_ano, competencia_mes)
  WHERE status IN ('aberta', 'paga');

CREATE INDEX cobranca_pessoa_competencia
  ON cobranca (pessoa_id, competencia_ano, competencia_mes);

CREATE TABLE linha_cobranca (
  id uuid PRIMARY KEY,
  cobranca_id uuid NOT NULL REFERENCES cobranca (id),
  item_id uuid NOT NULL REFERENCES item (id),
  origem_cobranca_id uuid NOT NULL REFERENCES cobranca (id),
  competencia_origem_ano integer NOT NULL,
  competencia_origem_mes integer NOT NULL,
  descricao text NOT NULL,
  valor_centavos integer NOT NULL CHECK (valor_centavos BETWEEN 1 AND 99999999),
  UNIQUE (cobranca_id, item_id, competencia_origem_ano, competencia_origem_mes)
);

CREATE TABLE pix (
  id uuid PRIMARY KEY,
  cobranca_id uuid NOT NULL REFERENCES cobranca (id),
  mp_payment_id text,
  idempotency_key uuid NOT NULL UNIQUE,
  valor_centavos integer NOT NULL CHECK (valor_centavos > 0),
  validade_dias integer NOT NULL CHECK (validade_dias BETWEEN 1 AND 30),
  vence_em timestamptz NOT NULL,
  copia_e_cola text,
  ticket_url text,
  status_local text NOT NULL CHECK (
    status_local IN (
      'emitindo',
      'pendente',
      'aprovado',
      'cancelado',
      'expirado',
      'falha_emissao',
      'falha_cancelamento'
    )
  ),
  mp_status text,
  mp_status_detail text,
  verificado_em timestamptz,
  aviso_inadimplencia_em timestamptz,
  motivo text,
  criado_em timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX pix_mp_id_unico ON pix (mp_payment_id) WHERE mp_payment_id IS NOT NULL;

CREATE UNIQUE INDEX pix_aberto_unico ON pix (cobranca_id)
  WHERE status_local IN ('emitindo', 'pendente', 'falha_cancelamento');

CREATE TABLE envio (
  id uuid PRIMARY KEY,
  cobranca_id uuid NOT NULL REFERENCES cobranca (id),
  tipo text NOT NULL CHECK (tipo IN ('cobranca', 'confirmacao', 'inadimplencia')),
  canal text NOT NULL CHECK (canal IN ('email', 'whatsapp')),
  tentado_em timestamptz NOT NULL,
  resultado text NOT NULL CHECK (resultado IN ('enviado', 'falha')),
  motivo text
);

CREATE INDEX envio_cobranca ON envio (cobranca_id, tipo, canal, tentado_em DESC);

CREATE TABLE template (
  canal text NOT NULL CHECK (canal IN ('email', 'whatsapp')),
  tipo text NOT NULL CHECK (tipo IN ('cobranca', 'confirmacao', 'inadimplencia')),
  assunto text,
  corpo text NOT NULL,
  PRIMARY KEY (canal, tipo)
);

CREATE TABLE evento_pagamento (
  id uuid PRIMARY KEY,
  mp_payment_id text NOT NULL,
  efeito text NOT NULL CHECK (efeito IN ('baixa', 'excedente', 'divergencia_valor')),
  cobranca_id uuid NOT NULL REFERENCES cobranca (id),
  valor_centavos integer NOT NULL,
  recebido_em timestamptz NOT NULL,
  UNIQUE (mp_payment_id, efeito)
);

CREATE TABLE agendamento (
  nome text PRIMARY KEY,
  ultima_chave text NOT NULL,
  atualizado_em timestamptz NOT NULL
);
