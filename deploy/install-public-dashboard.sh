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
default_enabled=${enabled_dir}/default
cache_dir=/var/cache/nginx/manga-public-dashboard
backup=
default_link_target=

install -d -o root -g root -m 0755 "${available_dir}" "${enabled_dir}"
install -d -o www-data -g www-data -m 0750 "${cache_dir}"
if [[ ${cache_dir} != /var/cache/nginx/manga-public-dashboard ]]; then
  echo "refusing to clear an unexpected dashboard cache path" >&2
  exit 1
fi
find "${cache_dir}" -mindepth 1 -delete
if [[ -f ${target} ]]; then
  backup=${target}.pre-public-dashboard
  cp --preserve=mode,ownership,timestamps "${target}" "${backup}"
fi
if [[ -L ${default_enabled} ]]; then
  default_link_target=$(readlink "${default_enabled}")
  rm -f "${default_enabled}"
fi

rollback() {
  if [[ -n ${backup} && -f ${backup} ]]; then
    mv "${backup}" "${target}"
  else
    rm -f "${target}" "${enabled}"
  fi
  if [[ -n ${default_link_target} && ! -e ${default_enabled} ]]; then
    ln -s "${default_link_target}" "${default_enabled}"
  fi
}

install -o root -g root -m 0644 "${source_config}" "${target}"
ln -sfn "${target}" "${enabled}"
if ! nginx -t; then
  rollback
  nginx -t || true
  exit 1
fi

systemctl enable nginx >/dev/null
if systemctl is-active --quiet nginx; then
  systemctl reload nginx
else
  systemctl start nginx
fi

static_ready=0
for attempt in {1..10}; do
  if curl \
    --fail \
    --silent \
    --show-error \
    --max-time 2 \
    --header 'Host: unrestricted-public-host.invalid' \
    http://127.0.0.1/ >/dev/null; then
    static_ready=1
    break
  fi
  sleep 1
done

if ((static_ready != 1)); then
  rollback
  if nginx -t; then
    systemctl reload nginx || true
  fi
  echo "public dashboard failed its catch-all static readback" >&2
  exit 1
fi

for endpoint in healthz api/v1/overview api/v1/opportunities api/v1/opportunities/chains api/v1/sources api/v1/system api/v1/business api/v1/profit/daily; do
  endpoint_ready=0
  for attempt in {1..10}; do
    if curl \
      --fail \
      --silent \
      --show-error \
      --max-time 10 \
      --header 'Host: unrestricted-public-host.invalid' \
      "http://127.0.0.1/${endpoint}" >/dev/null; then
      endpoint_ready=1
      break
    fi
    sleep 1
  done
  if ((endpoint_ready != 1)); then
    rollback
    if nginx -t; then
      systemctl reload nginx || true
    fi
    echo "public dashboard failed to warm ${endpoint}" >&2
    exit 1
  fi
done

if ! curl \
  --fail \
  --silent \
  --show-error \
  --max-time 2 \
  --dump-header - \
  --output /dev/null \
  --header 'Host: unrestricted-public-host.invalid' \
  http://127.0.0.1/api/v1/overview | grep --quiet --ignore-case '^X-Dashboard-Cache: HIT'; then
  rollback
  if nginx -t; then
    systemctl reload nginx || true
  fi
  echo "public dashboard API cache did not serve the warmed overview" >&2
  exit 1
fi

if [[ -n ${backup} ]]; then
  rm -f "${backup}"
fi
