#!/usr/bin/env bash
set -euo pipefail

if [[ ${EUID} -ne 0 ]]; then
  echo "install-release.sh must run as root" >&2
  exit 1
fi
if [[ $# -ne 2 ]]; then
  echo "usage: install-release.sh <release.tar.gz> <40-char-commit-sha>" >&2
  exit 1
fi

archive=$1
release_sha=$2
if [[ ! -f ${archive} || ! ${release_sha} =~ ^[0-9a-f]{40}$ ]]; then
  echo "invalid release archive or commit sha" >&2
  exit 1
fi

service_user=manga-chan-arb
service_group=manga-chan-arb
board_user=manga-board
board_group=manga-board
prefix=/opt/manga-chan-arbitrage
release_dir=${prefix}/releases/${release_sha}
runtime_dir=/var/lib/manga-chan-arbitrage
config_dir=/etc/manga-chan-arbitrage
board_runtime_dir=/var/lib/manga-opportunity-board
board_config_dir=/etc/manga-opportunity-board
credential_dir=/etc/credstore.encrypted

getent group "${service_group}" >/dev/null || groupadd --system "${service_group}"
id "${service_user}" >/dev/null 2>&1 || useradd --system --gid "${service_group}" --home-dir "${runtime_dir}" --shell /usr/sbin/nologin "${service_user}"
getent group "${board_group}" >/dev/null || groupadd --system "${board_group}"
id "${board_user}" >/dev/null 2>&1 || useradd --system --gid "${board_group}" --home-dir "${board_runtime_dir}" --shell /usr/sbin/nologin "${board_user}"
install -d -o root -g root -m 0755 "${prefix}/releases"
install -d -o "${service_user}" -g "${service_group}" -m 0700 "${runtime_dir}"
install -d -o root -g "${service_group}" -m 0750 "${config_dir}"
install -d -o "${board_user}" -g "${board_group}" -m 0750 "${board_runtime_dir}"
install -d -o root -g "${board_group}" -m 0750 "${board_config_dir}"
install -d -o root -g root -m 0700 "${credential_dir}"

if [[ -e ${release_dir} ]]; then
  echo "release already exists: ${release_dir}" >&2
  exit 1
fi
install -d -o root -g root -m 0755 "${release_dir}"
tar -xzf "${archive}" --strip-components=1 -C "${release_dir}"
cd "${release_dir}"
npm ci --no-audit --no-fund
npm run check

printf 'MANGA_RELEASE_SHA=%s\n' "${release_sha}" > "${config_dir}/release.env.tmp"
chown root:"${service_group}" "${config_dir}/release.env.tmp"
chmod 0640 "${config_dir}/release.env.tmp"
mv "${config_dir}/release.env.tmp" "${config_dir}/release.env"
ln -sfn "${release_dir}" "${prefix}/current.next"
mv -Tf "${prefix}/current.next" "${prefix}/current"
install -o root -g root -m 0644 deploy/systemd/manga-chan-watcher.service /etc/systemd/system/manga-chan-watcher.service
install -o root -g root -m 0644 deploy/systemd/manga-generic-arm.service /etc/systemd/system/manga-generic-arm.service
install -o root -g root -m 0644 deploy/systemd/manga-generic-deploy.service /etc/systemd/system/manga-generic-deploy.service
install -o root -g root -m 0644 deploy/systemd/manga-generic-watcher.service /etc/systemd/system/manga-generic-watcher.service
install -o root -g root -m 0644 deploy/systemd/manga-chan-alert@.service /etc/systemd/system/manga-chan-alert@.service
install -o root -g root -m 0644 deploy/systemd/manga-opportunity-board.service /etc/systemd/system/manga-opportunity-board.service
systemctl daemon-reload

echo "installed ${release_sha}; service was not armed or started"
