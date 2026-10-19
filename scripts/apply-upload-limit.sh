#!/usr/bin/env bash
set -euo pipefail

# 用法：DOMAIN=example.com bash scripts/apply-upload-limit.sh
# 把 deploy/nginx.conf.example 里的 example.com 换成 $DOMAIN，安装到 /etc/nginx/conf.d/$DOMAIN.conf
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DOMAIN="${DOMAIN:?请用 DOMAIN=你的域名 指定站点域名}"
TEMPLATE="$ROOT/deploy/nginx.conf.example"
TARGET="/etc/nginx/conf.d/$DOMAIN.conf"
BACKUP="$TARGET.before-500m-$(date +%Y%m%d-%H%M%S)"

if [[ ! -f "$TEMPLATE" ]]; then
  printf 'Missing config: %s\n' "$TEMPLATE" >&2
  exit 1
fi
SOURCE="$(mktemp)"
trap 'rm -f "$SOURCE"' EXIT
sed "s/example\.com/$DOMAIN/g" "$TEMPLATE" > "$SOURCE"

sudo -v
if sudo test -f "$TARGET"; then
  sudo cp -p "$TARGET" "$BACKUP"
else
  BACKUP=""
fi

restore() {
  if [[ -n "$BACKUP" ]]; then
    sudo cp -p "$BACKUP" "$TARGET"
    printf 'Restored config from %s\n' "$BACKUP" >&2
  else
    sudo rm -f "$TARGET"
    printf 'Removed new config %s\n' "$TARGET" >&2
  fi
}

if ! sudo install -m 644 "$SOURCE" "$TARGET"; then
  restore
  exit 1
fi

if ! sudo nginx -t; then
  restore
  exit 1
fi

if ! sudo systemctl reload nginx; then
  restore
  sudo nginx -t
  sudo systemctl reload nginx
  exit 1
fi

printf 'Nginx reloaded. File limit: 500 MiB; multipart allowance: 1 MiB.\n'
if [[ -n "$BACKUP" ]]; then
  printf 'Backup: %s\n' "$BACKUP"
fi
