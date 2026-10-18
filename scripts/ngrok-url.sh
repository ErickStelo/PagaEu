#!/usr/bin/env bash
set -euo pipefail

api="${NGROK_API:-http://127.0.0.1:4040/api/tunnels}"

if ! curl -fsS "$api" -o /tmp/ngrok-tunnels.json 2>/dev/null; then
  echo "ngrok não está rodando ou a API em 4040 não responde." >&2
  echo "Inicie com: ./scripts/ngrok-webhook.sh" >&2
  exit 1
fi

python3 <<'PY'
import json
import sys

with open("/tmp/ngrok-tunnels.json") as f:
    data = json.load(f)

tunnels = data.get("tunnels") or []
https = next((t for t in tunnels if t.get("public_url", "").startswith("https://")), None)
if not https and tunnels:
    https = tunnels[0]
if not https:
    print("Nenhum túnel ativo.", file=sys.stderr)
    sys.exit(1)

public = https["public_url"].rstrip("/")
webhook = f"{public}/webhooks/mercadopago?source_news=webhooks"

print(f"PAGAEU_PUBLIC_URL={public}")
print(f"Webhook Mercado Pago: {webhook}")
print("")
print("Reinicie o painel com PAGAEU_PUBLIC_URL acima e configure o mesmo segredo em Configuração e no painel do MP.")
PY
