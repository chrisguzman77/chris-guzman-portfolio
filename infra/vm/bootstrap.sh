#!/usr/bin/env bash
# One-time, re-runnable setup for the portfolio VM (Ubuntu 24.04).
#
#   cd /opt/portfolio && sudo ./infra/vm/bootstrap.sh
#
# Installs Docker, a deny-by-default firewall, automatic security updates, sops
# and age; creates the VM's age key; hands /opt/portfolio to the runner's uid;
# adds a 2 GB swapfile.
set -euo pipefail

if [[ ${EUID} -ne 0 ]]; then
  echo "run with sudo" >&2
  exit 1
fi

LAN_CIDR="${LAN_CIDR:-192.168.1.0/24}"
ADMIN_USER="${SUDO_USER:-chris}"
RUNNER_UID=1001
REPO_DIR=/opt/portfolio
KEY_FILE=/etc/portfolio/age.key
SOPS_VERSION=v3.13.3
SOPS_SHA256=e5bec3346a873ae91d871550f3e698c1aad962aff462a080e40f25fde17fef6b
AGE_VERSION=v1.3.2
AGE_SHA256=cbe24006683f8eb669266162894b9a522a1af52f2665fbc63a4bb032ed26ac10

step() { printf '\n==> %s\n' "$*"; }
export DEBIAN_FRONTEND=noninteractive

step "Base packages"
apt-get update -q
apt-get install -y -q ca-certificates curl git ufw unattended-upgrades

step "Docker Engine and Compose plugin (Docker's apt repository)"
if ! docker compose version >/dev/null 2>&1; then
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
  # shellcheck disable=SC1091
  . /etc/os-release
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu ${VERSION_CODENAME} stable" \
    >/etc/apt/sources.list.d/docker.list
  apt-get update -q
  apt-get install -y -q docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
fi
usermod -aG docker "${ADMIN_USER}"

step "Docker log rotation"
daemon_json='{ "log-driver": "json-file", "log-opts": { "max-size": "10m", "max-file": "3" } }'
if [[ "$(cat /etc/docker/daemon.json 2>/dev/null || true)" != "${daemon_json}" ]]; then
  echo "${daemon_json}" >/etc/docker/daemon.json
  systemctl restart docker
fi

step "Firewall: deny all inbound (IPv4 and IPv6) except SSH from ${LAN_CIDR}"
# Docker bypasses ufw for published ports; the production stack publishes none.
sed -i 's/^IPV6=.*/IPV6=yes/' /etc/default/ufw
ufw default deny incoming
ufw default allow outgoing
ufw allow from "${LAN_CIDR}" to any port 22 proto tcp comment 'ssh from LAN'
# Never lock out the session running this script, whatever LAN_CIDR says.
while read -r peer; do
  [[ -n "${peer}" ]] || continue
  ufw allow from "${peer}" to any port 22 proto tcp comment 'ssh from bootstrap session'
done < <(ss -Htn state established '( sport = :22 )' | awk '{print $4}' | sed -E 's/^\[?([^]]*)\]?:[0-9]+$/\1/' | sed 's/^::ffff://' | sort -u)
ufw --force enable

step "Automatic security updates (reboot at 04:30 when required)"
cat >/etc/apt/apt.conf.d/20auto-upgrades <<'CONF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
CONF
cat >/etc/apt/apt.conf.d/52portfolio-reboot <<'CONF'
Unattended-Upgrade::Automatic-Reboot "true";
Unattended-Upgrade::Automatic-Reboot-Time "04:30";
CONF

step "sops ${SOPS_VERSION} and age ${AGE_VERSION}"
tmp="$(mktemp -d)"
trap 'rm -rf "${tmp}"' EXIT
curl -fsSLo "${tmp}/sops" "https://github.com/getsops/sops/releases/download/${SOPS_VERSION}/sops-${SOPS_VERSION}.linux.amd64"
echo "${SOPS_SHA256}  ${tmp}/sops" | sha256sum -c -
install -m 0755 "${tmp}/sops" /usr/local/bin/sops
curl -fsSLo "${tmp}/age.tgz" "https://github.com/FiloSottile/age/releases/download/${AGE_VERSION}/age-${AGE_VERSION}-linux-amd64.tar.gz"
echo "${AGE_SHA256}  ${tmp}/age.tgz" | sha256sum -c -
tar -xzf "${tmp}/age.tgz" -C "${tmp}"
install -m 0755 "${tmp}/age/age" "${tmp}/age/age-keygen" /usr/local/bin/

step "VM age key at ${KEY_FILE} (readable by root and the runner uid only)"
install -d -m 0750 -o root -g "${RUNNER_UID}" /etc/portfolio
if [[ ! -s "${KEY_FILE}" ]]; then
  rm -f "${KEY_FILE}"
  age-keygen -o "${KEY_FILE}"
fi
chown "root:${RUNNER_UID}" "${KEY_FILE}"
chmod 0440 "${KEY_FILE}"

step "Repository at ${REPO_DIR}, owned by the runner uid ${RUNNER_UID}"
if [[ ! -d "${REPO_DIR}/.git" ]]; then
  git clone https://github.com/chrisguzman77/chris-guzman-portfolio.git "${REPO_DIR}"
fi
chown -R "${RUNNER_UID}:${RUNNER_UID}" "${REPO_DIR}"
if ! git config --system --get-all safe.directory 2>/dev/null | grep -qx "${REPO_DIR}"; then
  git config --system --add safe.directory "${REPO_DIR}"
fi

step "Swap: 2 GB /swapfile, vm.swappiness=10"
# Safety net for memory spikes; every container also has a mem_limit.
if [[ ! -f /swapfile ]]; then
  fallocate -l 2G /swapfile
  chmod 0600 /swapfile
  mkswap /swapfile >/dev/null
fi
if ! swapon --show=NAME --noheadings | grep -qx /swapfile; then
  swapon /swapfile
fi
if ! grep -qE '^/swapfile[[:space:]]' /etc/fstab; then
  echo '/swapfile none swap sw 0 0' >>/etc/fstab
fi
echo 'vm.swappiness=10' >/etc/sysctl.d/99-portfolio-swap.conf
sysctl -q -p /etc/sysctl.d/99-portfolio-swap.conf

step "Done"
echo "VM age public key (add it to .sops.yaml, then run sops updatekeys; safe to share):"
age-keygen -y "${KEY_FILE}"
echo
echo "Log out and back in so '${ADMIN_USER}' can use docker without sudo."
