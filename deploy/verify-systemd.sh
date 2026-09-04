#!/usr/bin/env bash
set -euo pipefail

if ! command -v systemd-analyze >/dev/null 2>&1; then
  if [[ ${CI:-} == true ]]; then
    echo "systemd-analyze is required in CI" >&2
    exit 1
  fi
  echo "systemd-analyze unavailable; skipping Linux-only unit verification"
  exit 0
fi

systemd-analyze verify deploy/systemd/*.service
