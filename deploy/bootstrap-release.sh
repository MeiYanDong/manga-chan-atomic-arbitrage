#!/usr/bin/env bash
set -euo pipefail

if [[ ${EUID} -ne 0 ]]; then
  echo "bootstrap-release.sh must run as root" >&2
  exit 1
fi
if [[ $# -ne 3 ]]; then
  echo "usage: bootstrap-release.sh <release.tar.gz> <40-char-commit-sha> <64-char-archive-sha256>" >&2
  exit 1
fi

archive=$(realpath "$1")
release_sha=$2
expected_archive_sha256=$3
if [[ ! -f ${archive} || ! ${release_sha} =~ ^[0-9a-f]{40}$ || ! ${expected_archive_sha256} =~ ^[0-9a-f]{64}$ ]]; then
  echo "invalid release archive, commit sha or archive sha256" >&2
  exit 1
fi

actual_archive_sha256=$(sha256sum "${archive}" | awk '{print $1}')
if [[ ${actual_archive_sha256} != "${expected_archive_sha256}" ]]; then
  echo "release archive checksum mismatch" >&2
  exit 1
fi

bootstrap_dir=$(mktemp -d /tmp/manga-release-bootstrap.XXXXXX)
cleanup() {
  if [[ ${bootstrap_dir} == /tmp/manga-release-bootstrap.* && -d ${bootstrap_dir} ]]; then
    rm -rf -- "${bootstrap_dir}"
  fi
}
trap cleanup EXIT

tar -xzf "${archive}" --strip-components=1 -C "${bootstrap_dir}"
candidate_installer=${bootstrap_dir}/deploy/install-release.sh
if [[ ! -f ${candidate_installer} || -L ${candidate_installer} ]]; then
  echo "candidate release installer is missing or unsafe" >&2
  exit 1
fi
bash -n "${candidate_installer}"
bash "${candidate_installer}" "${archive}" "${release_sha}"
