#!/usr/bin/env bash
set -euo pipefail

if [[ ${EUID} -ne 0 ]]; then
  echo "verify-release.sh must run as root" >&2
  exit 1
fi

cd /opt/manga-chan-arbitrage/current
set -a
source /etc/manga-chan-arbitrage/live.env
source /etc/manga-chan-arbitrage/release.env
set +a
export MANGA_RUN_DIR=/var/lib/manga-chan-arbitrage
if systemctl is-active --quiet manga-chan-watcher.service || systemctl is-enabled --quiet manga-chan-watcher.service; then
  runuser -u manga-chan-arb --preserve-environment -- /usr/bin/env npm run runtime:verify
else
  echo "fixed-route runtime verification skipped: service is inactive and disabled"
fi
if [[ -f /var/lib/manga-chan-arbitrage/generic-state.json ]]; then
  runuser -u manga-chan-arb --preserve-environment -- /usr/bin/env npm run generic:runtime-verify
fi
systemctl --no-pager --full status manga-chan-watcher.service || true
systemctl --no-pager --full status manga-generic-watcher.service || true

if [[ -f /etc/manga-opportunity-board/live.env ]]; then
  runuser -u manga-board -- /usr/bin/env -i \
    HOME=/var/lib/manga-opportunity-board \
    PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin \
    MANGA_BOARD_RUN_DIR=/var/lib/manga-opportunity-board \
    npm run board:status
  curl --fail --silent --show-error --max-time 5 http://127.0.0.1:8788/healthz
fi
