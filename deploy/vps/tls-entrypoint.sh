#!/usr/bin/env bash
set -euo pipefail
install -o postgres -g postgres -m 600 /run/tranche-tls/server.key /var/lib/postgresql/server.key
install -o postgres -g postgres -m 644 /run/tranche-tls/server.crt /var/lib/postgresql/server.crt
exec /usr/local/bin/docker-entrypoint.sh "$@"
