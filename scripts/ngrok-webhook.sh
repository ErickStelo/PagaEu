#!/usr/bin/env bash
set -euo pipefail

raiz="$(cd "$(dirname "$0")/.." && pwd)"
ngrok="${NGROK_BIN:-$raiz/.tools/ngrok}"
config="${NGROK_CONFIG:-$raiz/scripts/ngrok-pagaeu.yml}"
porta="${PAGAEU_PORT:-3010}"

if [[ ! -x "$ngrok" ]]; then
  echo "Binário não encontrado: $ngrok" >&2
  echo "Baixe com: curl -fsSL https://bin.ngrok.com/c/bNyj1mQVY4c/ngrok-v3-stable-linux-amd64.tgz | tar -xz -C $raiz/.tools" >&2
  exit 1
fi

if [[ -z "${NGROK_AUTHTOKEN:-}" && -f "$raiz/.tools/ngrok-authtoken" ]]; then
  NGROK_AUTHTOKEN="$(tr -d '[:space:]' < "$raiz/.tools/ngrok-authtoken")"
  export NGROK_AUTHTOKEN
fi

if [[ -z "${NGROK_AUTHTOKEN:-}" ]]; then
  echo "Defina NGROK_AUTHTOKEN ou grave o token em .tools/ngrok-authtoken (arquivo ignorado pelo git)." >&2
  echo "Token: https://dashboard.ngrok.com/get-started/your-authtoken" >&2
  exit 1
fi

if ! grep -q "addr:.*${porta}" "$config" 2>/dev/null; then
  echo "Aviso: o túnel em $config pode não usar a porta $porta (PAGAEU_PORT)." >&2
fi

echo "Túnel ngrok → http://127.0.0.1:${porta}" >&2
echo "Painel local da API ngrok: http://127.0.0.1:4040" >&2
echo "Depois de subir, rode: ./scripts/ngrok-url.sh" >&2
echo "" >&2

exec "$ngrok" start pagaeu --config="$config" --log=stdout
