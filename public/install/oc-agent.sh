#!/usr/bin/env bash
set -Eeuo pipefail

usage() {
  cat <<'USAGE'
OC Agent installer for Ubuntu Server

Usage:
  curl -fsSL https://CONTROL-PLANE/install/oc-agent.sh | \
    sudo bash -s -- --url https://CONTROL-PLANE

Options:
  --url URL       HTTPS URL of the OC control plane (required)
  --token TOKEN   One-time enrollment token (optional; prompt is safer)
  --allow-insecure-http
                  Allow plain HTTP to a non-loopback address (development only)
  --install-docker Install Docker Engine with Docker's official convenience
                  script when Docker is missing (development only)
  --help          Show this help
USAGE
}

control_plane_url="${OC_CONTROL_PLANE_URL:-}"
enrollment_token="${OC_ENROLLMENT_TOKEN:-}"
allow_insecure_http="${OC_ALLOW_INSECURE_HTTP:-false}"
install_docker="false"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --url)
      control_plane_url="${2:-}"
      shift 2
      ;;
    --token)
      enrollment_token="${2:-}"
      shift 2
      ;;
    --allow-insecure-http)
      allow_insecure_http="true"
      shift
      ;;
    --install-docker)
      install_docker="true"
      shift
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

if [[ "${EUID}" -ne 0 ]]; then
  echo "Installer must run as root. Use sudo as shown in the command." >&2
  exit 1
fi

if [[ ! -r /etc/os-release ]]; then
  echo "/etc/os-release was not found." >&2
  exit 1
fi

# shellcheck disable=SC1091
source /etc/os-release
if [[ "${ID:-}" != "ubuntu" ]]; then
  echo "OC Agent only supports Ubuntu Server." >&2
  exit 1
fi

if [[ -z "${control_plane_url}" ]]; then
  echo "--url is required." >&2
  usage >&2
  exit 2
fi
control_plane_url="${control_plane_url%/}"

if [[ ! "${control_plane_url}" =~ ^https:// ]]; then
  if [[ ! "${control_plane_url}" =~ ^http://(localhost|127\.0\.0\.1|\[::1\])(:[0-9]+)?$ ]]; then
    if [[ "${allow_insecure_http}" != "true" ]]; then
      echo "The control plane URL must use HTTPS outside localhost." >&2
      echo "For an isolated development LAN only, add --allow-insecure-http." >&2
      exit 1
    fi
    echo "WARNING: insecure HTTP enabled; credentials are not encrypted in transit." >&2
  elif [[ "${allow_insecure_http}" == "true" ]]; then
    echo "WARNING: insecure HTTP development mode is enabled." >&2
  fi
  if [[ ! "${control_plane_url}" =~ ^http:// ]]; then
    echo "The control plane URL must be HTTP or HTTPS." >&2
    exit 1
  fi
fi

for command_name in curl systemctl sha256sum; do
  if ! command -v "${command_name}" >/dev/null 2>&1; then
    echo "Missing dependency: ${command_name}" >&2
    exit 1
  fi
done

if ! command -v docker >/dev/null 2>&1; then
  if [[ "${install_docker}" != "true" ]]; then
    echo "Missing dependency: docker" >&2
    echo "For a development server, rerun with --install-docker." >&2
    exit 1
  fi

  echo "Docker is missing; installing Docker Engine for development..."
  docker_install_script="$(mktemp)"
  curl --fail --silent --show-error --location https://get.docker.com \
    --output "${docker_install_script}"
  sh "${docker_install_script}"
  rm -f -- "${docker_install_script}"
  systemctl enable --now docker
fi

docker compose version >/dev/null

existing_identity="false"
if [[ -s /var/lib/oc-agent/identity.json ]]; then
  existing_identity="true"
fi

if [[ -z "${enrollment_token}" && "${existing_identity}" != "true" ]]; then
  printf 'Paste the one-time enrollment token: ' >/dev/tty
  IFS= read -r -s enrollment_token </dev/tty
  printf '\n' >/dev/tty
fi
if [[ "${existing_identity}" != "true" && ! "${enrollment_token}" =~ ^oc_enroll_[A-Za-z0-9_-]+$ ]]; then
  echo "The enrollment token format is invalid." >&2
  exit 1
fi

case "$(uname -m)" in
  x86_64) architecture="amd64" ;;
  aarch64|arm64) architecture="arm64" ;;
  *)
    echo "Unsupported architecture: $(uname -m)" >&2
    exit 1
    ;;
esac

temporary_directory="$(mktemp -d)"
trap 'rm -rf -- "${temporary_directory}"' EXIT
binary_name="oc-agent-linux-${architecture}"
binary_url="${control_plane_url}/api/infrastructure/agent/binary?arch=${architecture}"

echo "Downloading OC Agent (${architecture})..."
curl --fail --silent --show-error --location "${binary_url}" \
  --output "${temporary_directory}/${binary_name}"
curl --fail --silent --show-error --location "${binary_url}&checksum=1" \
  --output "${temporary_directory}/${binary_name}.sha256"
(
  cd "${temporary_directory}"
  sha256sum --check "${binary_name}.sha256"
)

if ! getent group docker >/dev/null; then
  echo "The docker group was not found." >&2
  exit 1
fi
if ! id oc-agent >/dev/null 2>&1; then
  useradd --system --home-dir /var/lib/oc-agent --create-home --shell /usr/sbin/nologin oc-agent
fi
usermod -aG docker oc-agent

install -d -m 0750 -o root -g oc-agent /etc/oc-agent
install -d -m 0700 -o oc-agent -g oc-agent /var/lib/oc-agent
install -m 0755 -o root -g root "${temporary_directory}/${binary_name}" /usr/local/bin/oc-agent

install -m 0640 -o root -g oc-agent /dev/null /etc/oc-agent/agent.env
{
  printf 'OC_CONTROL_PLANE_URL=%s\n' "${control_plane_url}"
  if [[ "${existing_identity}" != "true" ]]; then
    printf 'OC_ENROLLMENT_TOKEN=%s\n' "${enrollment_token}"
  fi
  if [[ "${allow_insecure_http}" == "true" ]]; then
    printf 'OC_ALLOW_INSECURE_HTTP=true\n'
  fi
  printf 'OC_HEARTBEAT_SECONDS=30\n'
  printf 'OC_OPERATION_POLL_SECONDS=2\n'
} >/etc/oc-agent/agent.env

cat >/etc/systemd/system/oc-agent.service <<'UNIT'
[Unit]
Description=OC Infrastructure Agent
After=network-online.target docker.service
Wants=network-online.target
Requires=docker.service

[Service]
Type=simple
User=oc-agent
Group=docker
EnvironmentFile=/etc/oc-agent/agent.env
ExecStart=/usr/local/bin/oc-agent
Restart=on-failure
RestartSec=5s
TimeoutStopSec=30s
NoNewPrivileges=true
PrivateTmp=true
ProtectHome=true
ProtectSystem=strict
ReadWritePaths=/var/lib/oc-agent
ProtectKernelTunables=true
ProtectKernelModules=true
ProtectControlGroups=true
RestrictSUIDSGID=true
LockPersonality=true
MemoryDenyWriteExecute=true
SystemCallArchitectures=native

[Install]
WantedBy=multi-user.target
UNIT

systemctl daemon-reload
systemctl enable oc-agent
systemctl restart oc-agent

if [[ "${existing_identity}" == "true" ]]; then
  sleep 2
  if systemctl is-active --quiet oc-agent; then
    echo "OC Agent upgraded and restarted successfully."
    exit 0
  fi
  echo "Agent upgrade was installed, but the service did not stay active." >&2
  echo "Inspect logs with: sudo journalctl -u oc-agent --since '5 minutes ago'" >&2
  exit 1
fi

echo "Waiting for enrollment..."
for _ in $(seq 1 30); do
  if [[ -s /var/lib/oc-agent/identity.json ]]; then
    sed -i '/^OC_ENROLLMENT_TOKEN=/d' /etc/oc-agent/agent.env
    echo "OC Agent installed and enrolled successfully."
    echo "Check status with: sudo systemctl status oc-agent"
    exit 0
  fi
  sleep 1
done

echo "Agent was installed, but enrollment did not finish within 30 seconds." >&2
echo "Inspect logs with: sudo journalctl -u oc-agent --since '5 minutes ago'" >&2
exit 1
