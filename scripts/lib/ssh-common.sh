#!/bin/bash
# ============================================================================
# Q11 Freedom - shared SSH/SCP helpers.
# Source this from any provisioning/deploy script:
#     . "$(dirname "$0")/lib/ssh-common.sh"
#
# The Motorola Q11 runs an OLD Dropbear (kernel 4.19). Modern OpenSSH clients
# (macOS, Linux, WSL) refuse its key exchange/ciphers by default, so we
# explicitly re-enable the legacy algorithms. Auth is by password via sshpass.
# ============================================================================

# Legacy algorithms required by the router's old Dropbear.
QF_SSH_ALGOS="-o StrictHostKeyChecking=no \
-o HostKeyAlgorithms=+ssh-rsa \
-o PubkeyAcceptedAlgorithms=+ssh-rsa \
-o KexAlgorithms=+diffie-hellman-group14-sha1,diffie-hellman-group1-sha1 \
-o Ciphers=+aes128-cbc,3des-cbc,aes256-cbc \
-o PreferredAuthentications=password \
-o ConnectTimeout=15"

# Require sshpass once.
qf_require_sshpass() {
    command -v sshpass >/dev/null 2>&1 && return 0
    {
        echo "ERROR: 'sshpass' is not installed. Install it with:"
        echo "  macOS:              brew install hudochenkov/sshpass/sshpass"
        echo "  Debian/Ubuntu/WSL:  sudo apt install sshpass"
    } >&2
    return 1
}

# qf_ssh <ip> <password> <remote-command>
qf_ssh() {
    local ip="$1" pass="$2"; shift 2
    sshpass -p "$pass" ssh $QF_SSH_ALGOS "root@$ip" "$@"
}

# qf_scp <ip> <password> <local> <remote>
qf_scp() {
    local ip="$1" pass="$2" src="$3" dst="$4"
    sshpass -p "$pass" scp -O $QF_SSH_ALGOS "$src" "root@$ip:$dst"
}

# qf_wait_ssh <ip> <password> [timeout_s]  - wait until SSH answers (post-reboot)
qf_wait_ssh() {
    local ip="$1" pass="$2" timeout="${3:-120}" waited=0
    while [ "$waited" -lt "$timeout" ]; do
        if qf_ssh "$ip" "$pass" 'echo ok' 2>/dev/null | grep -q ok; then
            return 0
        fi
        sleep 5; waited=$((waited + 5))
    done
    return 1
}
