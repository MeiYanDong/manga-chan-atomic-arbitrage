#!/usr/bin/env bash
set -euo pipefail

if [[ ${EUID} -ne 0 ]]; then
  echo "install-public-dashboard.sh must run as root" >&2
  exit 1
fi
if ! command -v nginx >/dev/null 2>&1; then
  echo "nginx must be installed before publishing the dashboard" >&2
  exit 1
fi

source_config=${1:-deploy/nginx/manga-public-dashboard.conf}
if [[ ! -f ${source_config} ]]; then
  echo "public dashboard nginx config not found: ${source_config}" >&2
  exit 1
fi

available_dir=/etc/nginx/sites-available
enabled_dir=/etc/nginx/sites-enabled
target=${available_dir}/manga-public-dashboard.conf
enabled=${enabled_dir}/manga-public-dashboard.conf
backup=

install -d -o root -g root -m 0755 "${available_dir}" "${enabled_dir}"
if [[ -f ${target} ]]; then
  backup=${target}.pre-public-dashboard
  cp --preserve=mode,ownership,timestamps "${target}" "${backup}"
fi

rollback() {
  if [[ -n ${backup} && -f ${backup} ]]; then
    mv "${backup}" "${target}"
  else
    rm -f "${target}" "${enabled}"
  fi
}

install -o root -g root -m 0644 "${source_config}" "${target}"
ln -sfn "${target}" "${enabled}"
if ! nginx -t; then
  rollback
  nginx -t || true
  exit 1
fi

if [[ -n ${backup} ]]; then
  rm -f "${backup}"
fi
systemctl enable nginx >/dev/null
if systemctl is-active --quiet nginx; then
  systemctl reload nginx
else
  systemctl start nginx
fi

curl --fail --silent --show-error --max-time 35 http://127.0.0.1/healthz >/dev/null
