# PagaEu

Painel de um único dono para cadastrar quem deve, gerar a cobrança do mês e receber por PIX do Mercado Pago. As mensagens de cobrança, confirmação e inadimplência saem por e-mail (SMTP), WhatsApp (Evolution Go) ou pelos dois, conforme o cadastro de cada pessoa.

## Subir com Docker Compose

O Compose sobe só a aplicação. Não há serviço de Postgres. O banco já precisa existir e ser alcançável pela rede Docker informada em `PAGAEU_DOCKER_NETWORK`.

```bash
cp .env.example .env
```

Preencha o `.env` e suba:

```bash
docker compose up --build
```

Na partida o processo espera o banco, com novas tentativas se a conexão falhar, aplica as migrações e só então passa a escutar. Se a migração falhar, o processo encerra. `GET /health` responde 200 quando o banco atende `SELECT 1` e 503 quando não atende. O contêiner reinicia sozinho, salvo parada manual.

O `.env` fica de fora do Git.

## Variáveis

Os nomes são os do `.env.example`. Nenhum valor secreto vem no repositório.

| Variável | Uso |
| --- | --- |
| `DATABASE_URL` | URL do Postgres. Obrigatória. Sem ela a aplicação não sobe. |
| `PAGAEU_DOCKER_NETWORK` | Nome da rede Docker externa em que o Postgres pode ser alcançado. O Compose entra nessa rede e não cria um banco. |
| `PAGAEU_PORT` | Porta publicada no host. Se ficar vazia, o Compose publica `3000`. Dentro do contêiner a aplicação escuta `3000`. |
| `PAGAEU_PUBLIC_URL` | URL pública do painel, com esquema. A barra final é ignorada. Entra na URL de notificação do PIX. |
| `PAGAEU_ADMIN_USER` | Usuário do painel na primeira subida. |
| `PAGAEU_ADMIN_PASSWORD` | Senha do painel na primeira subida. |
| `PAGAEU_ADMIN_EMAIL` | E-mail que recebe o código de acesso na primeira subida. |
| `PAGAEU_LOGIN_CODE_DISABLED` | `1`, `true` ou `sim` entram só com usuário e senha. Qualquer outro valor pede o código de 6 dígitos. |
| `EVOLUTION_GO_URL` | URL do Evolution Go, com esquema. A barra final é ignorada. |
| `EVOLUTION_GO_API_KEY` | Chave global, usada só para listar instâncias. |
| `EVOLUTION_GO_INSTANCE` | Nome da instância já existente no Evolution Go. |

## Admin da primeira subida

Se ainda não existe a linha de configuração, a aplicação grava usuário, senha e e-mail a partir de `PAGAEU_ADMIN_USER`, `PAGAEU_ADMIN_PASSWORD` e `PAGAEU_ADMIN_EMAIL`. Os três precisam estar preenchidos nessa primeira partida. Uma subida seguinte não troca essa senha.

Na primeira partida o SMTP ainda não está gravado. Com o código de acesso ligado, esse e-mail não sai e o login não abre. Para entrar, use `PAGAEU_LOGIN_CODE_DISABLED`. Depois de gravar o SMTP, desligar a variável volta a exigir o código. O código vale 10 minutos e um uso. A sessão cai depois de mais de 12 horas sem uso.

## Porta

`PAGAEU_PORT` é a porta do host. O valor padrão do Compose é `3000`. O painel fica em `http://HOST:PAGAEU_PORT`.

## Job

O agendador olha o relógio a cada 10 segundos, no fuso `America/Sao_Paulo`. Uma trava no banco impede que duas réplicas rodem o mesmo ciclo.

Às 09:00, no minuto zero, o ciclo do dia faz quatro passos, nesta ordem: confere os PIX ainda ativos, gera a cobrança de quem tem o dia efetivo igual a hoje, envia o aviso de inadimplência devido e aplica a troca de dia de cobrança que estava pendente para este mês. O dia cadastrado 31 usa o último dia do mês quando o mês é mais curto.

Nas outras horas, também no minuto zero, o ciclo só confere PIX ativos e inadimplência. Não gera cobrança.

Se o ciclo falha antes de gravar que aquele minuto já rodou, a tentativa seguinte no mesmo minuto repete o ciclo. Um minuto perdido não é refeito mais tarde.

Quem está inativo não entra no job. Cobrança de outro mês, ou de pessoa inativa, continua disponível na tela da pessoa.

## O que configurar no painel

Em **Configuração**, campo de segredo em branco mantém o valor já gravado. A tela mostra se o segredo está definido e não devolve o valor. Trocar a senha do painel ou o e-mail do código exige a senha atual.

**Mercado Pago.** Grave o access token e o segredo do webhook. Cada PIX é criado com a URL `{PAGAEU_PUBLIC_URL}/webhooks/mercadopago?source_news=webhooks`, também exibida nessa tela. O aviso que chega nessa URL só é aceito se a assinatura bater com o segredo gravado.

**Evolution Go.** Não se edita no painel. URL, instância e a indicação de chave definida vêm do `.env`. O botão de teste procura a instância em `GET /instance/all`. O envio de WhatsApp usa o token dessa instância em `POST /send/text`. A instância precisa já estar conectada no Evolution Go. O painel não cria nem pareia instância.

**SMTP.** Host, porta, usuário, senha, nome e e-mail do remetente, e a criptografia: STARTTLS, TLS implícito ou sem criptografia. É o canal do código de acesso e das mensagens por e-mail. Sem host e e-mail de remetente, o e-mail não sai.
