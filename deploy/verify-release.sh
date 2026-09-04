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
runuser -u manga-chan-arb --preserve-environment -- /usr/bin/npm run runtime:verify
systemctl --no-pager --full status manga-chan-watcher.service || true
