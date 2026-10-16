#!/usr/bin/env bash
set -euo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo "Installer harus dijalankan sebagai root." >&2
  exit 1
fi

if [[ ! -r /etc/os-release ]]; then
  echo "/etc/os-release tidak ditemukan." >&2
  exit 1
fi

# shellcheck disable=SC1091
source /etc/os-release
if [[ "${ID:-}" != "ubuntu" ]]; then
  echo "OC Agent hanya mendukung Ubuntu Server." >&2
  exit 1
fi

for command_name in docker systemctl; do
  if ! command -v "${command_name}" >/dev/null 2>&1; then
    echo "Dependency tidak ditemukan: ${command_name}" >&2
    exit 1
  fi
done
docker compose version >/dev/null

agent_source="${1:-./oc-agent}"
service_source="${2:-./deploy/agent/oc-agent.service}"
updater_source="${3:-./deploy/agent/oc-agent-updater}"
update_path_source="${4:-./deploy/agent/oc-agent-update.path}"
update_service_source="${5:-./deploy/agent/oc-agent-update.service}"
if [[ ! -f "${agent_source}" || ! -f "${service_source}" || ! -f "${updater_source}" ||
  ! -f "${update_path_source}" || ! -f "${update_service_source}" ]]; then
  echo "Binary agent, updater, atau unit systemd tidak ditemukan." >&2
  exit 1
fi

if ! getent group docker >/dev/null; then
  echo "Group docker tidak ditemukan." >&2
  exit 1
fi
if ! id oc-agent >/dev/null 2>&1; then
  useradd --system --home-dir /var/lib/oc-agent --create-home --shell /usr/sbin/nologin oc-agent
fi
usermod -aG docker oc-agent

install -d -m 0750 -o root -g oc-agent /etc/oc-agent
install -d -m 0700 -o oc-agent -g oc-agent /var/lib/oc-agent
install -d -m 0700 -o oc-agent -g oc-agent /var/lib/oc-agent/update
install -d -m 0755 -o root -g root /usr/local/libexec
new_agent_version="$("${agent_source}" --version)"
if [[ -x /usr/local/bin/oc-agent ]]; then
  current_agent_version="$(/usr/local/bin/oc-agent --version 2>/dev/null || true)"
  if [[ "${current_agent_version}" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$ ]] &&
    [[ "${current_agent_version}" != "${new_agent_version}" ]]; then
    install -m 0755 -o root -g root /usr/local/bin/oc-agent /usr/local/bin/oc-agent.previous
  fi
fi
install -m 0755 -o root -g root "${agent_source}" /usr/local/bin/oc-agent
install -m 0755 -o root -g root "${updater_source}" /usr/local/libexec/oc-agent-updater
install -m 0644 -o root -g root "${service_source}" /etc/systemd/system/oc-agent.service
install -m 0644 -o root -g root "${update_path_source}" /etc/systemd/system/oc-agent-update.path
install -m 0644 -o root -g root "${update_service_source}" /etc/systemd/system/oc-agent-update.service

if [[ ! -f /etc/oc-agent/agent.env ]]; then
  install -m 0640 -o root -g oc-agent /dev/null /etc/oc-agent/agent.env
  cat >/etc/oc-agent/agent.env <<'ENV'
OC_CONTROL_PLANE_URL=https://billing.example.com
OC_ENROLLMENT_TOKEN=replace-with-one-time-token
OC_HEARTBEAT_SECONDS=30
OC_OPERATION_POLL_SECONDS=2
ENV
fi

systemctl daemon-reload
systemctl enable --now oc-agent-update.path
echo "Edit /etc/oc-agent/agent.env, lalu jalankan: systemctl enable --now oc-agent"
