#!/usr/bin/env bash
set -euo pipefail

if [ "$EUID" -ne 0 ]; then
  echo "This script must be run as root."
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONF_TEMPLATE="$SCRIPT_DIR/intelligent-sync.conf"

ENV_FILE="${ENV_FILE:-$SCRIPT_DIR/.env}"
if [ -f "$ENV_FILE" ]; then
  set -a
  . "$ENV_FILE"
  set +a
fi

: "${PUBLIC_HOST:?PUBLIC_HOST environment variable is required}"
: "${PUBLIC_PORT:?PUBLIC_PORT environment variable is required}"
: "${EMAIL:?EMAIL environment variable is required}"
: "${PRIVATE_HOST:?PRIVATE_HOST environment variable is required}"
: "${PRIVATE_PORT:?PRIVATE_PORT environment variable is required}"

apt-get update
apt-get install -y nginx snapd

if ! command -v snap >/dev/null 2>&1; then
  apt-get install -y snapd
fi

snap install core --classic || true
snap install --classic certbot || true
ln -sf /snap/bin/certbot /usr/bin/certbot

rm -f /etc/nginx/sites-enabled/default /etc/nginx/sites-available/default

cat >/etc/nginx/sites-available/"$PUBLIC_HOST" <<EOF
server {
    listen 80;
    server_name $PUBLIC_HOST;

    location /.well-known/acme-challenge/ {
        root /var/www/html;
    }

    location / {
        proxy_pass http://$PRIVATE_HOST:$PRIVATE_PORT;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
}
EOF

ln -sf /etc/nginx/sites-available/"$PUBLIC_HOST" /etc/nginx/sites-enabled/"$PUBLIC_HOST"

nginx -t
systemctl restart nginx

certbot --nginx -d "$PUBLIC_HOST" --email "$EMAIL" --agree-tos --no-eff-email --redirect --noninteractive

sed -e "s|{PUBLIC_PORT}|$PUBLIC_PORT|g" \
    -e "s|{PUBLIC_DNS}|$PUBLIC_HOST|g" \
    -e "s|{PUBLIC_HOST}|$PUBLIC_HOST|g" \
    -e "s|{PRIVATE_HOST}|$PRIVATE_HOST|g" \
    -e "s|{PRIVATE_PORT}|$PRIVATE_PORT|g" \
    "$CONF_TEMPLATE" >/etc/nginx/sites-available/"$PUBLIC_HOST"

nginx -t
systemctl restart nginx

if systemctl list-units --full -all | grep -q snap.certbot.renew.timer; then
  systemctl enable --now snap.certbot.renew.timer
fi

certbot renew --dry-run