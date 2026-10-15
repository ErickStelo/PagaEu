import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import test from 'node:test';
import { criarEvolution } from '../src/evolution.ts';

async function ouvir(rotas: {
  all: (pedido: { apikey?: string }, responder: (status: number, corpo: unknown) => void) => void;
  texto: (pedido: { apikey?: string; corpo: unknown }, responder: (status: number, corpo: unknown) => void) => void;
}): Promise<{ url: string; fechar: () => Promise<void>; chamadas: string[] }> {
  const chamadas: string[] = [];
  const servidor = createServer((req, res) => {
    const pedacos: Buffer[] = [];
    req.on('data', (pedaco) => pedacos.push(Buffer.from(pedaco)));
    req.on('end', () => {
      chamadas.push(`${req.method} ${req.url}`);
      const responder = (status: number, corpo: unknown) => {
        res.statusCode = status;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(corpo));
      };
      const apikey = req.headers.apikey?.toString();
      if (req.url === '/instance/all' && req.method === 'GET') {
        rotas.all({ apikey }, responder);
        return;
      }
      if (req.url === '/send/text' && req.method === 'POST') {
        rotas.texto({ apikey, corpo: JSON.parse(Buffer.concat(pedacos).toString('utf8') || '{}') }, responder);
        return;
      }
      responder(404, { erro: 'rota errada' });
    });
  });
  await new Promise<void>((resolve) => servidor.listen(0, '127.0.0.1', resolve));
  const endereco = servidor.address();
  if (!endereco || typeof endereco === 'string') throw new Error('Sem porta.');
  return {
    url: `http://127.0.0.1:${endereco.port}`,
    chamadas,
    fechar: () => new Promise((resolve, reject) => servidor.close((erro) => (erro ? reject(erro) : resolve()))),
  };
}

test('Evolution Go lista a instância e envia em /send/text', async () => {
  let envios = 0;
  const servidor = await ouvir({
    all: ({ apikey }, responder) => {
      assert.equal(apikey, 'chave-global');
      responder(200, [{ name: 'pagaeu', token: 'token-da-instancia' }, { name: 'outra', token: 'nao' }]);
    },
    texto: ({ apikey, corpo }, responder) => {
      envios += 1;
      assert.equal(apikey, 'token-da-instancia');
      assert.equal((corpo as { number: string }).number, '5511988887777');
      assert.equal((corpo as { text: string }).text, envios === 1 ? 'Olá' : 'de novo');
      responder(200, { ok: true });
    },
  });
  try {
    const cliente = criarEvolution(() => ({ url: servidor.url, apiKey: 'chave-global', instance: 'pagaeu' }));
    const enviado = await cliente.enviarTexto('5511988887777', 'Olá');
    assert.equal(enviado.ok, true);
    const deNovo = await cliente.enviarTexto('5511988887777', 'de novo');
    assert.equal(deNovo.ok, true);
    assert.equal(servidor.chamadas.filter((chamada) => chamada === 'GET /instance/all').length, 1);
    assert.equal(servidor.chamadas.filter((chamada) => chamada === 'POST /send/text').length, 2);
    const semInstancia = criarEvolution(() => ({ url: servidor.url, apiKey: 'chave-global', instance: 'ausente' }));
    const ausente = await semInstancia.testarConexao();
    assert.equal(ausente.ok, false);
    assert.equal(ausente.motivo, 'instância não encontrada');
    const semConfig = criarEvolution(() => ({ url: '', apiKey: '', instance: '' }));
    const vazio = await semConfig.enviarTexto('1', 'oi');
    assert.equal(vazio.ok, false);
    if (!vazio.ok) assert.equal(vazio.motivo, 'Evolution Go não configurado');
    assert.equal(servidor.chamadas.some((chamada) => chamada.includes('/message/sendText')), false);
  } finally {
    await servidor.fechar();
  }
});

test('token rejeitado é renovado uma vez', async () => {
  let leituras = 0;
  const servidor = await ouvir({
    all: (_pedido, responder) => {
      leituras += 1;
      responder(200, { data: [{ Name: 'pagaeu', Token: leituras === 1 ? 'token-velho' : 'token-novo' }] });
    },
    texto: ({ apikey }, responder) => {
      if (apikey !== 'token-novo') {
        responder(401, { segredo: 'token-velho' });
        return;
      }
      responder(200, {});
    },
  });
  try {
    const cliente = criarEvolution(() => ({ url: servidor.url, apiKey: 'chave-global', instance: 'pagaeu' }));
    const enviado = await cliente.enviarTexto('5511999990000', 'texto');
    assert.equal(enviado.ok, true);
    assert.equal(leituras, 2);
    assert.equal(servidor.chamadas.filter((chamada) => chamada === 'GET /instance/all').length, 2);
    assert.equal(servidor.chamadas.filter((chamada) => chamada === 'POST /send/text').length, 2);
  } finally {
    await servidor.fechar();
  }
});
