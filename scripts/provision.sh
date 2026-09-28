#!/bin/bash
# ============================================================================
# Q11 Freedom - one-shot node provisioning.
#
# Takes a freshly factory-reset Motorola Q11 (MH7601/02/03) that already has
# SSH enabled (via the Minim backdoor, see README step 1) and turns it into a
# fully Q11 Freedom-controlled node: Minim off, hardened, SPA + API deployed,
# persistence guaranteed across reboots.
#
# Usage:
#   bash scripts/provision.sh <ip> <root-password> [--role master|slave] [--lan-ip 192.168.50.N]
#        [--uplink-ssid SSID --uplink-key KEY --master-ip IP]   (optional WiFi backhaul)
#
# Examples:
#   bash scripts/provision.sh 192.168.1.1 '<label-password>' --role master --lan-ip 192.168.50.1
#   bash scripts/provision.sh 192.168.1.1 '<label-password>' --role slave  --lan-ip 192.168.50.2
#
# IDEMPOTENT: safe to re-run on an already-provisioned node (re-deploys/updates).
# ============================================================================
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
. "$HERE/lib/ssh-common.sh"

# ---- args ------------------------------------------------------------------
IP="${1:?Usage: provision.sh <ip> <password> [--role master|slave] [--lan-ip IP] [--uplink-ssid S --uplink-key K --master-ip IP]}"
PASS="${2:?Missing root password}"
shift 2
ROLE="master"; LAN_IP=""; UP_SSID=""; UP_KEY=""; MASTER_IP="192.168.50.1"
while [ $# -gt 0 ]; do
    case "$1" in
        --role)         ROLE="$2"; shift 2 ;;
        --lan-ip)       LAN_IP="$2"; shift 2 ;;
        --uplink-ssid)  UP_SSID="$2"; shift 2 ;;   # master SSID (WET backhaul)
        --uplink-key)   UP_KEY="$2"; shift 2 ;;    # master WPA2 key
        --master-ip)    MASTER_IP="$2"; shift 2 ;; # master IP (default route)
        *) echo "Unknown argument: $1" >&2; exit 1 ;;
    esac
done

echo "=================================================="
echo "  Q11 Freedom - node provisioning"
echo "=================================================="
echo "  Node   : $IP"
echo "  Role   : $ROLE"
echo "  LAN IP : ${LAN_IP:-(unchanged)}"
echo ""

qf_require_sshpass

# ---- [1/6] verify access ---------------------------------------------------
echo "[1/6] Verifying SSH..."
qf_ssh "$IP" "$PASS" 'echo "  connected: $(cat /proc/sys/kernel/hostname 2>/dev/null || echo node)"'

# ---- [2/6] disable Minim / MotoSync ----------------------------------------
echo "[2/6] Disabling Minim/MotoSync..."
qf_ssh "$IP" "$PASS" '
for svc in unum unum-support unum-updater minim_inits; do
    if [ -x "/etc/init.d/$svc" ]; then
        /etc/init.d/$svc stop 2>/dev/null
        /etc/init.d/$svc disable 2>/dev/null
        echo "  off: $svc"
    fi
done'

# ---- [3/6] hardening: remove unauthenticated surface -----------------------
echo "[3/6] Hardening (unauthenticated CGIs + ttyd)..."
qf_ssh "$IP" "$PASS" '
mkdir -p /data/cgi-backup
for f in router.sh admin.sh; do
    [ -f "/www/cgi-bin/$f" ] && cp "/www/cgi-bin/$f" /data/cgi-backup/ && rm -f "/www/cgi-bin/$f" && echo "  removed: $f"
done
if [ -x /etc/init.d/ttyd ]; then
    uci -q set ttyd.@ttyd[0].enable=0 2>/dev/null; uci -q commit ttyd 2>/dev/null
    /etc/init.d/ttyd stop 2>/dev/null; /etc/init.d/ttyd disable 2>/dev/null
    echo "  ttyd off"
fi'

# ---- [4/6] install router files --------------------------------------------
echo "[4/6] Installing router scripts..."
bash "$ROOT/scripts/deploy-router-files.sh" "$IP" "$PASS"

# ---- [4b] HTTPS: self-signed cert with the right CN (for the PWA) ----------
# The factory cert has a generic "OpenWrt" CN and a weak RSA key. We generate
# an RSA-2048 cert valid for 10 years with CN = the node's management IP.
# Idempotent: it only regenerates if the current CN does not match (the cert
# is not rotated on every deploy). uhttpd does NOT regenerate a cert that
# already exists, so it persists across reboots.
echo "[4b] Ensuring HTTPS certificate..."
CERT_CN="${LAN_IP:-$IP}"
# There is no openssl on the router; a marker file keeps us from regenerating
# on every deploy. Only (re)generates when the marker differs from the wanted CN.
qf_ssh "$IP" "$PASS" "
if [ \"\$(cat /etc/uhttpd.crt.cn 2>/dev/null)\" = '$CERT_CN' ] && [ -s /etc/uhttpd.crt ]; then
  echo '  HTTPS cert already correct (CN=$CERT_CN)'
else
  uci set uhttpd.defaults.commonname='$CERT_CN'; uci set uhttpd.defaults.bits='2048'; uci set uhttpd.defaults.days='3650'; uci commit uhttpd
  px5g selfsigned -der -days 3650 -newkey rsa:2048 -keyout /etc/uhttpd.key -out /etc/uhttpd.crt -subj /C=US/ST=Local/L=Mesh/O=Q11Freedom/CN=$CERT_CN >/dev/null 2>&1
  echo '$CERT_CN' > /etc/uhttpd.crt.cn
  /etc/init.d/uhttpd restart >/dev/null 2>&1
  echo '  HTTPS cert regenerated (CN=$CERT_CN, RSA2048, 10 years)'
fi"

# ---- [5/6] deploy the SPA --------------------------------------------------
echo "[5/6] Deploying the Q11 Freedom web app..."
bash "$ROOT/scripts/deploy-spa.sh" "$IP" "$PASS"

# ---- [6/6] role + IP -------------------------------------------------------
echo "[6/6] Applying role '$ROLE'..."
# Store the ROLE in /etc/config/freedom (uci -> persists across reboots).
# freedom-boot re-applies it on every boot, so a power cut never changes the role.
qf_ssh "$IP" "$PASS" "
uci set freedom.node=node 2>/dev/null
uci set freedom.node.role='$ROLE'
[ -n '$LAN_IP' ] && uci set freedom.node.mgmt_ip='$LAN_IP'
uci commit freedom
echo '  role saved: $ROLE'"

if [ "$ROLE" = "master" ]; then
    # Master = DHCP/DNS server of the mesh. Make sure DHCP is ON (in case the
    # device used to be a slave).
    qf_ssh "$IP" "$PASS" "
uci -q delete dhcp.lan.ignore; uci commit dhcp; /etc/init.d/dnsmasq reload 2>/dev/null
echo '  master: DHCP ON'"
fi

if [ "$ROLE" = "slave" ]; then
    # Slave = pure bridge over CABLE. The master centralizes DHCP/DNS (two DHCP
    # servers on the same L2 would clash), so DHCP is OFF here. STP ON avoids
    # loops if the nodes are wired in a ring. The backhaul is the Ethernet
    # CABLE from the master to a LAN port of the slave (standard L2 bridge, no
    # loss).
    #
    # WET (WiFi backhaul) is OPTIONAL and only enabled if you pass --uplink-ssid.
    # It is not used in a cabled mesh.
    qf_ssh "$IP" "$PASS" "
uci set dhcp.lan.ignore=1; uci commit dhcp; /etc/init.d/dnsmasq reload 2>/dev/null
uci set network.lan.stp=1; uci commit network
uci set freedom.mesh=mesh 2>/dev/null; uci set freedom.mesh.master_ip='$MASTER_IP'; uci commit freedom
echo '  slave: DHCP OFF + STP ON (cable backhaul), master=$MASTER_IP'"

    if [ -n "$UP_SSID" ] && [ -n "$UP_KEY" ]; then
        echo "  (optional) configuring WET WiFi backhaul to '$UP_SSID'..."
        qf_ssh "$IP" "$PASS" "
uci set freedom.mesh=mesh 2>/dev/null
uci set freedom.mesh.uplink_ssid='$UP_SSID'
uci set freedom.mesh.uplink_key='$UP_KEY'
uci set freedom.mesh.master_ip='$MASTER_IP'
uci commit freedom
nvram set wl0_ssid='$UP_SSID'; nvram set wl0_wpa_psk='$UP_KEY'
nvram set wl1_ssid='$UP_SSID'; nvram set wl1_wpa_psk='$UP_KEY'
nvram commit 2>/dev/null
echo '  WET configured (it will start at boot via freedom-wet)'"
    fi
fi
# LAN IP change + (on slaves) the full role, in ONE remote command: after the
# network reload the old IP stops answering.
# The slave role joins its WAN port to the bridge (both ports become LAN) and
# uses the master as gateway/DNS, so the master can reach it to adopt it.
if [ -n "$LAN_IP" ] || [ "$ROLE" = "slave" ]; then
    [ -n "$LAN_IP" ] && echo "  WARNING: changing LAN to $LAN_IP. You will lose the connection; reconnect at the new IP."
    qf_ssh "$IP" "$PASS" "
[ -n '$LAN_IP' ] && { uci set network.lan.ipaddr='$LAN_IP'; uci commit network; }
( sleep 1; [ '$ROLE' = slave ] && /usr/sbin/freedom-role.sh; /etc/init.d/network reload ) >/dev/null 2>&1 &
" || true
fi

echo ""
echo "=================================================="
echo "  Provisioning complete"
echo "=================================================="
echo "  Web app: http://${LAN_IP:-$IP}/app/"
echo "  Reminder: if the root password is still the one on the label, change it from System."
