#!/usr/bin/env bash
set -euo pipefail

set -a
source <(
  aws secretsmanager get-secret-value \
    --secret-id garage-copilot/prod \
    --region us-east-1 \
    --query SecretString --output text \
  | jq -r 'to_entries | .[] | "\(.key)=\"\(.value)\""'
)
set +a

docker compose up -d --build