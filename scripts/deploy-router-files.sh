#!/bin/bash
# ============================================================================
# Q11 Freedom - install/update the router scripts (router-files/) on a node.
# Uploads EVERYTHING as a single package to /tmp and moves each file into
# place with the daemons stopped (overwriting a running script does not take
# effect).
#
# Usage: bash scripts/deploy-router-files.sh <ip> <password>
# Called by provision.sh; also useful on its own to update a node.
# ============================================================================
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
. "$HERE/lib/ssh-common.sh"

IP="${1:?Usage: deploy-router-files.sh <ip> <password>}"
PASS="${2:?Missing root password}"
RF="$ROOT/router-files"

FILES="freedom-api.sh freedom-role.sh freedom-fw.sh freedom-qos.sh freedom-qos.init \
freedom-led.sh freedom-led.init freedom-boot.init freedom-wet.sh freedom-wet.init freedom-names.hotplug"

qf_require_sshpass

PKG="$(mktemp "${TMPDIR:-/tmp}/qffiles.XXXXXX")"
# shellcheck disable=SC2086
tar --no-mac-metadata -czf "$PKG" -C "$RF" $FILES 2>/dev/null \
  || tar -czf "$PKG" -C "$RF" $FILES

qf_scp "$IP" "$PASS" "$PKG" /tmp/qffiles.tar.gz
rm -f "$PKG"

qf_ssh "$IP" "$PASS" '
set -e
D=/tmp/qffiles; rm -rf $D; mkdir -p $D; tar xzf /tmp/qffiles.tar.gz -C $D; rm -f /tmp/qffiles.tar.gz
[ -x /etc/init.d/freedom-led ] && /etc/init.d/freedom-led stop >/dev/null 2>&1 || true
install_f() { cp "$D/$1" "$2.new" && chmod +x "$2.new" && mv -f "$2.new" "$2"; }
install_f freedom-api.sh     /www/cgi-bin/freedom-api.sh
install_f freedom-role.sh    /usr/sbin/freedom-role.sh
install_f freedom-fw.sh      /usr/sbin/freedom-fw.sh
install_f freedom-qos.sh     /usr/sbin/freedom-qos.sh
install_f freedom-led.sh     /usr/sbin/freedom-led.sh
install_f freedom-wet.sh     /usr/sbin/freedom-wet.sh
install_f freedom-qos.init   /etc/init.d/freedom-qos
install_f freedom-led.init   /etc/init.d/freedom-led
install_f freedom-boot.init  /etc/init.d/freedom-boot
install_f freedom-wet.init   /etc/init.d/freedom-wet
# remembered DHCP names: dnsmasq only enables its hook if a handler already exists
mkdir -p /etc/hotplug.d/dhcp
NEWH=0; [ -f /etc/hotplug.d/dhcp/50-freedom-names ] || NEWH=1
install_f freedom-names.hotplug /etc/hotplug.d/dhcp/50-freedom-names
rm -rf $D
[ -f /etc/config/freedom ] || touch /etc/config/freedom
for s in freedom-qos freedom-led freedom-boot freedom-wet; do /etc/init.d/$s enable 2>/dev/null || true; done
# firewall hook for per-device blocks
grep -q freedom-fw.sh /etc/firewall.user 2>/dev/null || \
    echo "[ -x /usr/sbin/freedom-fw.sh ] && /usr/sbin/freedom-fw.sh" >> /etc/firewall.user
/etc/init.d/freedom-boot start >/dev/null 2>&1 || true
[ "$NEWH" = 1 ] && /etc/init.d/dnsmasq restart >/dev/null 2>&1 || true
echo "  scripts installed and enabled at boot"'
