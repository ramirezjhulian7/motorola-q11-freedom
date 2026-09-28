#!/bin/bash
# ============================================================================
# Q11 Freedom - back up a node's config before touching it.
# Usage: bash scripts/backup-node.sh <ip> <root-password> [label]
#
# Pulls /etc/config, dropbear keys, passwd/shadow, mtd layout and system info
# into backups/<label-or-ip>/ . Backups are gitignored (they contain secrets:
# shadow, host keys).
# ============================================================================
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
. "$HERE/lib/ssh-common.sh"

IP="${1:?Usage: backup-node.sh <ip> <password> [label]}"
PASS="${2:?Missing root password}"
LABEL="${3:-$IP}"
DEST="$ROOT/backups/$LABEL"

qf_require_sshpass
mkdir -p "$DEST"

echo "Backing up $IP to backups/$LABEL/ ..."
qf_ssh "$IP" "$PASS" '
rm -rf /tmp/qfbk && mkdir -p /tmp/qfbk
cp -r /etc/config /tmp/qfbk/config 2>/dev/null
cp -r /etc/dropbear /tmp/qfbk/dropbear 2>/dev/null
cp /etc/passwd /etc/shadow /etc/rc.local /tmp/qfbk/ 2>/dev/null
cat /proc/mtd > /tmp/qfbk/mtd_layout.txt 2>/dev/null
{ uname -a; cat /etc/openwrt_release; } > /tmp/qfbk/system_info.txt 2>/dev/null
ls -la /etc/init.d/ > /tmp/qfbk/initd_list.txt 2>/dev/null
nvram show 2>/dev/null | grep -iE "^wl[01]_" > /tmp/qfbk/nvram_wifi.txt
cd /tmp && tar czf /tmp/qfbk.tar.gz qfbk'
sshpass -p "$PASS" scp -O $QF_SSH_ALGOS "root@$IP:/tmp/qfbk.tar.gz" "$DEST/" >/dev/null
( cd "$DEST" && tar xzf qfbk.tar.gz --strip-components=1 && rm -f qfbk.tar.gz )
qf_ssh "$IP" "$PASS" 'rm -f /tmp/qfbk.tar.gz; rm -rf /tmp/qfbk' 2>/dev/null || true

echo "OK: backup saved in backups/$LABEL/"
ls "$DEST"
