#!/usr/bin/env bash
# Bootstrap a fresh Ubuntu host for Jira++ UAT deployment.
# Usage: ./infra/scripts/bootstrap-host.sh
set -euo pipefail

if [ "${EUID}" -ne 0 ]; then
  echo "Please run this script as root (or with sudo)." >&2
  exit 1
fi

APP_DIR=${APP_DIR:-/opt/jira-plus-plus}
BACKUP_DIR=${BACKUP_DIR:-/opt/jira-plus-plus/backups}

log() {
  echo "[bootstrap] $1"
}

log "Updating package index"
apt-get update -y

log "Installing base packages"
apt-get install -y ca-certificates curl gnupg lsb-release git

log "Setting up Docker repository"
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
chmod a+r /etc/apt/keyrings/docker.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(lsb_release -cs) stable" \
  > /etc/apt/sources.list.d/docker.list
apt-get update -y

log "Installing Docker & Compose"
apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
systemctl enable docker
systemctl start docker

log "Creating application directories"
mkdir -p "$APP_DIR" "$BACKUP_DIR"
chown -R ${SUDO_USER:-root}:${SUDO_USER:-root} "$APP_DIR" "$BACKUP_DIR"

log "Bootstrap complete. Clone repository and use infra/deploy.sh for deployments."
