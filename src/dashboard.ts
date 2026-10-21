import type { App } from './app.ts';
import { consultar } from './db.ts';
import type { StatusCobranca, StatusPix } from './domain/acoes.ts';
import { diasInteirosDesde, formatarCompetencia } from './domain/calendar.ts';
import {
  indiceCompetencia,
  mesesDoGrafico,
  situacaoCobranca,
  type Competencia,
  type Periodo,
  type SituacaoCobranca,
} from './domain/painel.ts';

export type TotalSituacao = { valorCentavos: number; quantidade: number };

export type MesGrafico = { competencia: Competencia } & Record<SituacaoCobranca, number>;

export type CobrancaAtrasada = {
  cobrancaId: string;
  pessoa: string;
  competencia: string;
  venceEm: Date;
  diasAtraso: number;
  valorCentavos: number;
};

export type Dashboard = {
  periodo: Periodo;
  totais: Record<SituacaoCobranca, TotalSituacao>;
  taxaRecebimento: number | null;
  meses: MesGrafico[];
  atrasadas: CobrancaAtrasada[];
};

type LinhaDashboard = {
  id: string;
  nome: string;
  competencia_ano: number;
  competencia_mes: number;
  status: StatusCobranca;
  origem_baixa: string | null;
  total: number;
  superada: boolean;
  pix_status: StatusPix | null;
  pix_vence_em: Date | null;
};

const LIMITE_ATRASADAS = 20;

function zerado(): Record<SituacaoCobranca, TotalSituacao> {
  return {
    aberta: { valorCentavos: 0, quantidade: 0 },
    atrasada: { valorCentavos: 0, quantidade: 0 },
    paga: { valorCentavos: 0, quantidade: 0 },
  };
}

function situacaoContavel(linha: LinhaDashboard, agora: Date): SituacaoCobranca | null {
  if (linha.status === 'paga' && linha.origem_baixa === 'cascata') return null;
  if (linha.status === 'aberta' && linha.superada) return null;
  return situacaoCobranca({ status: linha.status, pixStatus: linha.pix_status, pixVenceEm: linha.pix_vence_em }, agora);
}

export async function montarDashboard(app: App, periodo: Periodo, agora = app.clock()): Promise<Dashboard> {
  const meses = mesesDoGrafico(periodo);
  const inicioPeriodo = indiceCompetencia(periodo.inicio);
  const fimPeriodo = indiceCompetencia(periodo.fim);
  const inicioConsulta = Math.min(inicioPeriodo, indiceCompetencia(meses[0] ?? periodo.inicio));
  const linhas = await consultar<LinhaDashboard>(
    app.pool,
    `SELECT c.id, p.nome, c.competencia_ano, c.competencia_mes, c.status, c.origem_baixa,
            COALESCE((SELECT SUM(l.valor_centavos) FROM linha_cobranca l WHERE l.cobranca_id = c.id), 0)::int AS total,
            EXISTS (
              SELECT 1 FROM cobranca posterior
              WHERE posterior.pessoa_id = c.pessoa_id
                AND posterior.status IN ('aberta', 'paga')
                AND (posterior.competencia_ano, posterior.competencia_mes) > (c.competencia_ano, c.competencia_mes)
            ) AS superada,
            ultimo.status_local AS pix_status, ultimo.vence_em AS pix_vence_em
     FROM cobranca c
     JOIN pessoa p ON p.id = c.pessoa_id
     LEFT JOIN LATERAL (
       SELECT status_local, vence_em FROM pix
       WHERE pix.cobranca_id = c.id
       ORDER BY pix.criado_em DESC
       LIMIT 1
     ) ultimo ON true
     WHERE c.status IN ('aberta', 'paga')
       AND (c.competencia_ano * 12 + c.competencia_mes - 1) BETWEEN $1 AND $2`,
    [inicioConsulta, fimPeriodo],
  );

  const totais = zerado();
  const porMes = new Map<number, MesGrafico>(
    meses.map((competencia) => [indiceCompetencia(competencia), { competencia, aberta: 0, atrasada: 0, paga: 0 }]),
  );
  const atrasadas: CobrancaAtrasada[] = [];

  for (const linha of linhas) {
    const situacao = situacaoContavel(linha, agora);
    if (!situacao) continue;
    const indice = indiceCompetencia({ ano: linha.competencia_ano, mes: linha.competencia_mes });
    const mes = porMes.get(indice);
    if (mes) mes[situacao] += linha.total;
    if (indice < inicioPeriodo) continue;
    totais[situacao].valorCentavos += linha.total;
    totais[situacao].quantidade += 1;
    if (situacao === 'atrasada' && linha.pix_vence_em) {
      atrasadas.push({
        cobrancaId: linha.id,
        pessoa: linha.nome,
        competencia: formatarCompetencia(linha.competencia_ano, linha.competencia_mes),
        venceEm: linha.pix_vence_em,
        diasAtraso: Math.max(0, diasInteirosDesde(linha.pix_vence_em, agora)),
        valorCentavos: linha.total,
      });
    }
  }

  const geral = totais.aberta.valorCentavos + totais.atrasada.valorCentavos + totais.paga.valorCentavos;
  atrasadas.sort((a, b) => b.diasAtraso - a.diasAtraso || a.pessoa.localeCompare(b.pessoa, 'pt-BR'));
  return {
    periodo,
    totais,
    taxaRecebimento: geral > 0 ? totais.paga.valorCentavos / geral : null,
    meses: [...porMes.values()],
    atrasadas: atrasadas.slice(0, LIMITE_ATRASADAS),
  };
}
