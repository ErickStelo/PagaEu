import { criarAplicacao } from '../src/app.ts';
import { carregarTokenMp, janelaConciliacaoPix } from '../src/configuracao.ts';
import { conciliarPixNativos } from '../src/conciliacaoPix.ts';
import { casarPixNativos } from '../src/domain/conciliacao.ts';
import { partesNoFuso } from '../src/domain/calendar.ts';
import { formatarCentavos } from '../src/domain/money.ts';
import { txidCobranca } from '../src/domain/pix.ts';
import { consultar } from '../src/db.ts';

const aplicar = process.argv.includes('--aplicar');

const app = await criarAplicacao();
try {
  const token = await carregarTokenMp(app.pool);
  if (!token) {
    console.error('Access token do Mercado Pago não está gravado em Configuração.');
    process.exit(1);
  }

  const agora = app.clock();
  const { inicio, fim } = await janelaConciliacaoPix(app.pool, agora);
  console.log(`Janela: ${inicio.toISOString()} → ${fim.toISOString()}`);

  const busca = await app.mp.buscarPixRecebidos(token, inicio, fim);
  if (!busca.ok) {
    console.error(`Busca no Mercado Pago falhou: ${busca.motivo}`);
    process.exit(1);
  }
  console.log(`PIX aprovados retornados pelo MP: ${busca.entradas.length}`);
  for (const entrada of busca.entradas.slice(0, 15)) {
    console.log(
      `  · id=${entrada.id} valor=R$ ${formatarCentavos(entrada.valorCentavos)} txid=${entrada.txid ?? '—'} em ${entrada.dateApproved.toISOString()}`,
    );
  }
  if (busca.entradas.length > 15) console.log(`  … e mais ${busca.entradas.length - 15}`);

  const pendentes = await consultar<{
    pix_id: string;
    cobranca_id: string;
    pessoa_id: string;
    nome: string;
    valor_centavos: number;
    competencia_ano: number;
    competencia_mes: number;
    txid: string | null;
  }>(
    app.pool,
    `SELECT px.id AS pix_id, c.id AS cobranca_id, c.pessoa_id, p.nome, px.valor_centavos,
            c.competencia_ano, c.competencia_mes, px.txid
     FROM pix px
     JOIN cobranca c ON c.id = px.cobranca_id
     JOIN pessoa p ON p.id = c.pessoa_id
     WHERE px.provedor = 'nativo'
       AND px.status_local IN ('pendente', 'falha_cancelamento')
       AND c.status = 'aberta'`,
  );
  console.log(`PIX nativos pendentes no banco: ${pendentes.length}`);
  for (const linha of pendentes) {
    const txid = linha.txid ?? txidCobranca(linha.nome, linha.competencia_ano, linha.competencia_mes);
    console.log(
      `  · ${linha.nome} R$ ${formatarCentavos(linha.valor_centavos)} txid=${txid} pix=${linha.pix_id}`,
    );
  }

  const idsMp = busca.entradas.map((e) => e.id);
  const jaUsados =
    idsMp.length
      ? await consultar<{ mp_payment_id: string }>(
          app.pool,
          'SELECT mp_payment_id FROM evento_pagamento WHERE mp_payment_id = ANY($1::text[])',
          [idsMp],
        )
      : [];
  const vistos = new Set(jaUsados.map((r) => r.mp_payment_id));
  const entradasNovas = busca.entradas.filter((e) => !vistos.has(e.id));
  console.log(`Entradas ainda não usadas em evento_pagamento: ${entradasNovas.length}`);

  const pares = casarPixNativos(
    pendentes.map((linha) => ({
      pixId: linha.pix_id,
      cobrancaId: linha.cobranca_id,
      pessoaId: linha.pessoa_id,
      valorCentavos: linha.valor_centavos,
      competenciaAno: linha.competencia_ano,
      competenciaMes: linha.competencia_mes,
      txid: linha.txid ?? txidCobranca(linha.nome, linha.competencia_ano, linha.competencia_mes),
    })),
    entradasNovas.map((entrada) => ({
      mpPaymentId: entrada.id,
      valorCentavos: entrada.valorCentavos,
      txid: entrada.txid,
      aprovadoEm: entrada.dateApproved,
    })),
    (data) => {
      const partes = partesNoFuso(data);
      return { ano: partes.year, mes: partes.month };
    },
  );
  console.log(`Casamentos possíveis agora: ${pares.length}`);
  for (const par of pares) {
    console.log(
      `  · ${par.criterio}: pix ${par.pendente.pixId} ↔ MP ${par.entrada.mpPaymentId} (R$ ${formatarCentavos(par.entrada.valorCentavos)})`,
    );
  }

  if (!aplicar) {
    console.log('\nModo leitura. Para baixar cobranças casadas, rode com --aplicar');
    process.exit(0);
  }

  if (!pares.length) {
    console.log('\nNada a aplicar.');
    process.exit(0);
  }

  const resultado = await conciliarPixNativos(app, agora);
  console.log('\nConciliação aplicada:', JSON.stringify(resultado, null, 2));
} finally {
  await app.pool.end();
}
