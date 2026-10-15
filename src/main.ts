import { criarAplicacao } from './app.ts';
import { criarServidor } from './http.ts';
import { agendar } from './job.ts';
import { mensagemErro } from './texto.ts';

async function main(): Promise<void> {
  try {
    const app = await criarAplicacao();
    const servidor = criarServidor(app);
    servidor.listen(app.env.port);
    agendar(app);
    process.on('SIGTERM', () => {
      servidor.close(() => {
        void app.pool.end().finally(() => process.exit(0));
      });
    });
  } catch (erro) {
    console.error(mensagemErro(erro));
    process.exit(1);
  }
}

process.on('unhandledRejection', (erro) => {
  console.error(`Falha não tratada: ${mensagemErro(erro)}`);
});

void main();
