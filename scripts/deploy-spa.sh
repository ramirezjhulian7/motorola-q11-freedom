#!/bin/bash
# ============================================================================
# Q11 Freedom - build the SPA and deploy it to /www/app on a node.
# Usage: bash scripts/deploy-spa.sh <ip> <root-password>
#
# Standalone (re-deploy just the UI) or called by provision.sh.
# Requires Node.js/npm locally; the router has no node, only the built files
# (frontend/dist) are uploaded.
# ============================================================================
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
. "$HERE/lib/ssh-common.sh"

IP="${1:?Usage: deploy-spa.sh <ip> <password>}"
PASS="${2:?Missing root password}"
FRONTEND="$ROOT/frontend"
PKG="/tmp/qf-spa.tar.gz"

qf_require_sshpass

echo "  - building..."
( cd "$FRONTEND" && npm run build >/dev/null )

echo "  - packaging..."
tar --no-mac-metadata -czf "$PKG" -C "$FRONTEND/dist" . 2>/dev/null \
  || tar -czf "$PKG" -C "$FRONTEND/dist" .

echo "  - uploading to ${IP}..."
qf_scp "$IP" "$PASS" "$PKG" /tmp/qf-spa.tar.gz >/dev/null

echo "  - extracting..."
qf_ssh "$IP" "$PASS" \
  'rm -rf /www/app && mkdir -p /www/app && cd /www/app && \
   tar xzf /tmp/qf-spa.tar.gz && rm -f /tmp/qf-spa.tar.gz /www/app/._* && \
   echo "    done: $(ls /www/app | wc -l) entries"'

rm -f "$PKG"
echo "  OK: SPA deployed at http://$IP/app/"
