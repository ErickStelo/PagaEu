# PagaEu

Painel de um único dono para cadastrar quem deve, gerar a cobrança do mês e receber por PIX do Mercado Pago. As mensagens de cobrança, confirmação e inadimplência saem por e-mail (SMTP), WhatsApp (Evolution Go) ou pelos dois, conforme o cadastro de cada pessoa.

## Subir com Docker Compose

O Compose sobe só a aplicação. Não há serviço de Postgres. O banco já precisa existir e ser alcançável pela rede Docker informada em `PAGAEU_DOCKER_NETWORK`.

```bash
cp .env.example .env
```

Preencha o `.env` e escolha o arquivo de compose:

**Desenvolvimento** (Postgres na rede Docker, Mailpit para e-mail de teste, código montado no contêiner):

```bash
npm run docker:dev
# equivalente: docker compose -f docker-compose.dev.yml up -d --build
```

O compose de dev sobrescreve `DATABASE_URL` para `postgres:5432` e entra também na rede `mailpit_default`. Use host SMTP `mailpit` e porta `1025` na configuração do painel.

**Produção**:

```bash
npm run docker:prod
# equivalente: docker compose -f docker-compose.prod.yml up -d --build
```

Na partida o processo espera o banco, com novas tentativas se a conexão falhar, aplica as migrações e só então passa a escutar. Se a migração falhar, o processo encerra. `GET /health` responde 200 quando o banco atende `SELECT 1` e 503 quando não atende. O contêiner reinicia sozinho (em produção, `restart: always`), salvo parada manual.

Sem Docker, na máquina local:

```bash
npm start
```

O `.env` fica de fora do Git.

## Variáveis

Os nomes são os do `.env.example`. Nenhum valor secreto vem no repositório.

| Variável | Uso |
| --- | --- |
| `DATABASE_URL` | URL do Postgres. Obrigatória. Sem ela a aplicação não sobe. No compose de dev o valor do `.env` é substituído pelo host `postgres` na rede Docker. |
| `PAGAEU_DOCKER_NETWORK` | Nome da rede Docker externa em que o Postgres pode ser alcançado. O Compose entra nessa rede e não cria um banco. |
| `PAGAEU_PORT` | Porta publicada no host. Padrão `3010` no exemplo de dev; em produção costuma ser `3000`. Dentro do contêiner a aplicação escuta `3000`. |
| `PAGAEU_PUBLIC_URL` | URL pública do painel, com esquema. A barra final é ignorada. Entra na URL de notificação do PIX. |
| `PAGAEU_ADMIN_USER` | Usuário do painel na primeira subida. |
| `PAGAEU_ADMIN_PASSWORD` | Senha do painel na primeira subida. |
| `PAGAEU_ADMIN_EMAIL` | E-mail que recebe o código de acesso na primeira subida. |
| `PAGAEU_LOGIN_CODE_DISABLED` | `1`, `true` ou `sim` entram só com usuário e senha. Qualquer outro valor pede o código de 6 dígitos. |
| `EVOLUTION_GO_URL` | Opcional. Se o painel ainda não tem Evolution gravado, a primeira subida importa URL, instância e chave a partir destas três variáveis. |
| `EVOLUTION_GO_API_KEY` | Opcional. Chave global usada para listar instâncias no Evolution Go. |
| `EVOLUTION_GO_INSTANCE` | Opcional. Nome da instância já existente no Evolution Go. |

Mercado Pago (access token e segredo do webhook) e SMTP ficam só no banco, pela tela **Configuração**. Só a troca da **senha do painel** exige informar a senha atual.

O login limita tentativas falhas por IP (bloqueio temporário após várias falhas) e o reenvio do código de acesso é limitado por janela de tempo. O webhook do Mercado Pago exige assinatura HMAC e timestamp recente (10 minutos).

## Admin da primeira subida

Se ainda não existe a linha de configuração, a aplicação grava usuário, senha e e-mail a partir de `PAGAEU_ADMIN_USER`, `PAGAEU_ADMIN_PASSWORD` e `PAGAEU_ADMIN_EMAIL`. Os três precisam estar preenchidos nessa primeira partida. Uma subida seguinte não troca essa senha.

Na primeira partida o SMTP ainda não está gravado. Com o código de acesso ligado, esse e-mail não sai e o login não abre. Para entrar, use `PAGAEU_LOGIN_CODE_DISABLED`. Depois de gravar o SMTP, desligar a variável volta a exigir o código. O código vale 10 minutos e um uso. A sessão cai depois de mais de 12 horas sem uso.

## Porta

`PAGAEU_PORT` é a porta do host. O painel fica em `http://HOST:PAGAEU_PORT` (ou HTTPS em produção).

## Webhook em desenvolvimento

Para receber notificações do Mercado Pago na máquina local:

```bash
npm run tunnel        # ngrok apontando para PAGAEU_PORT (padrão 3010)
npm run tunnel:url    # mostra PAGAEU_PUBLIC_URL e a URL do webhook
```

Coloque a URL HTTPS do túnel em `PAGAEU_PUBLIC_URL`, reinicie o painel e configure o mesmo segredo no Mercado Pago e em **Configuração**.

Para simular pagamento no sandbox (order com payer `APRO`, webhook assinado):

```bash
node --env-file-if-exists=.env --experimental-strip-types scripts/simular-webhook-pagamento.ts [cobranca-id]
```

## Job

O agendador olha o relógio a cada 10 segundos, no fuso `America/Sao_Paulo`. Uma trava no banco impede que duas réplicas rodem o mesmo ciclo.

Às 09:00, no minuto zero, o ciclo do dia faz três passos, nesta ordem: gera a cobrança de quem tem o dia efetivo igual a hoje, envia o aviso de inadimplência devido e aplica a troca de dia de cobrança que estava pendente para este mês. O dia cadastrado 31 usa o último dia do mês quando o mês é mais curto.

Nas outras horas, também no minuto zero, o ciclo só envia inadimplência devida. Não gera cobrança.

A **consulta de cobranças em aberto** (PIX nativo no extrato + PIX pendentes no Mercado Pago) roda em intervalo configurável em **Configuração** (padrão: 1 hora). Desligada, só o botão do Dashboard, o webhook do MP e o script `npm run testar:conciliacao` consultam.

Se o ciclo falha antes de gravar que aquele minuto já rodou, a tentativa seguinte no mesmo minuto repete o ciclo. Um minuto perdido não é refeito mais tarde.

Quem está inativo não entra no job. Cobrança de outro mês, ou de pessoa inativa, continua disponível na tela da pessoa.

## O que configurar no painel

Em **Configuração**, campo de segredo em branco mantém o valor já gravado. A tela mostra se o segredo está definido e não devolve o valor. Para definir uma senha nova, informe a senha atual e a nova senha.

**Mercado Pago.** Grave o access token e o segredo do webhook. Cada PIX é criado com a URL `{PAGAEU_PUBLIC_URL}/webhooks/mercadopago?source_news=webhooks`, também exibida nessa tela. O aviso que chega nessa URL só é aceito se a assinatura bater com o segredo gravado. Em **Quem deve**, o botão **Consultar cobranças abertas** pergunta ao Mercado Pago o status dos PIX pendentes e quita os que já constam como pagos.

**PIX.** Escolha se o PIX é gerado pelo Mercado Pago ou pelo PIX nativo, e informe chave, recebedor e cidade. Defina também o **intervalo da consulta automática** de cobranças em aberto. A escolha vale para os próximos PIX; cada PIX guarda o provedor que o emitiu. No PIX nativo o copia e cola estático (BR Code) é gerado sem gateway, com o valor da cobrança e o identificador `PRIMEIRONOME` + `MMAAAA` (ex.: `ANA032026`), e segue nas mesmas mensagens de e-mail e WhatsApp. A baixa automática consulta o Mercado Pago (`/v1/payments/search`) por PIX **aprovados** recebidos na conta e concilia pelo **TxId** ou, se for único no mês, pelo **valor exato**. O access token do Mercado Pago precisa estar configurado. Invalidar um PIX nativo só o tira das mensagens; o código estático continua pagável no banco.

**Evolution Go.** URL, instância e chave da API são editáveis no painel (e persistidos no banco). Na primeira subida, se ainda não houver dados gravados, valores opcionais de `EVOLUTION_GO_*` no `.env` são importados uma vez. O botão de teste procura a instância em `GET /instance/all`. O envio de WhatsApp usa o token dessa instância em `POST /send/text`. A instância precisa já estar conectada no Evolution Go. O painel não cria nem pareia instância.

**SMTP.** Host, porta, usuário, senha, nome e e-mail do remetente, e a criptografia: STARTTLS, TLS implícito ou sem criptografia. É o canal do código de acesso e das mensagens por e-mail. Sem host e e-mail de remetente, o e-mail não sai. Há botão de teste na mesma tela.

**Templates.** O corpo não precisa incluir todas as variáveis; o painel só valida o que for necessário para salvar.
