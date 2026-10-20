#!/usr/bin/env bash
# 部署演示站（公开样例站）：全程本机构建、只传产物，不需要 root。
# 路线同 deploy.sh——2 核小机严禁在线构建（会把整机打满，见 deploy.sh 头注释）。
#
# 服务器上一次性准备（首次部署前做一次，见 deploy/DEMO.md）：
#   ~/our-little-planet-demo 目录，含 .env.local（NEXT_PUBLIC_DEMO_MODE=1）、
#   node_modules、npm run seed 种好的 data/。本仓库默认主机别名 aliyun、端口 3100。
#
# nginx 子域名 + HTTPS 证书需要 root，本脚本最后会把配置样例放到服务器家目录
# 并打印需要 sudo 执行的几条命令。
#
# 用法：bash scripts/deploy-demo.sh
#   SKIP_LOCAL_BUILD=1 bash scripts/deploy-demo.sh   # 刚本地构建过时跳过第 1 步
set -euo pipefail
cd "$(dirname "$0")/.."

HOST="${DEPLOY_HOST:-aliyun}"
DIR="${DEPLOY_DIR:-our-little-planet-demo}"
PM2_NAME="${PM2_NAME:-journal-demo}"
PORT="${DEMO_PORT:-3100}"
DOMAIN="${DEMO_DOMAIN:-journal.amazingzz.xyz}"
# 服务器上 Node 的 bin 目录（不在 PATH 里时用；默认兼容 ~/apps/node22 这种手动安装的位置）
REMOTE_NODE_BIN="${REMOTE_NODE_BIN:-\$HOME/apps/node22/bin}"

step() { printf "\n\033[1;35m==> %s\033[0m\n" "$*"; }

step "0/7 预检：服务器连通"
ssh -o BatchMode=yes -o ConnectTimeout=10 "$HOST" 'echo "服务器连通 ok"' || {
  echo "连不上 ${HOST}：服务器恢复了吗？" >&2
  exit 1
}

if [[ "${SKIP_LOCAL_BUILD:-0}" != "1" ]]; then
  step "1/7 本地构建（演示模式 NEXT_PUBLIC_DEMO_MODE=1）"
  NEXT_PUBLIC_DEMO_MODE=1 npm run build
else
  step "1/7 跳过本地构建（SKIP_LOCAL_BUILD=1）"
  if [[ -n "$(find src package.json next.config.ts -newer .next/BUILD_ID -print -quit 2>/dev/null)" ]]; then
    echo "源码比 .next/BUILD_ID 新：产物是旧的，去掉 SKIP_LOCAL_BUILD 重新构建" >&2
    exit 1
  fi
fi
[[ -f .next/BUILD_ID ]] || { echo ".next/BUILD_ID 不存在：本地构建没跑过？" >&2; exit 1; }

step "2/7 同步源码到 $HOST:~/${DIR}（不碰 data / .env.local / node_modules）"
COPYFILE_DISABLE=1 tar --no-xattrs -czf - --exclude .DS_Store --exclude '._*' \
  src public scripts \
  package.json package-lock.json next.config.ts tsconfig.json postcss.config.mjs \
  eslint.config.mjs README.md DESIGN.md \
  | ssh "$HOST" "
set -e
cd ~/$DIR
rm -rf src public scripts
tar -xzf -
echo '源码已同步'
"

# 依赖：package-lock 没变化就完全不碰 node_modules（省掉 npm ci 的内存/CPU 尖峰）
LOCK_HASH=$(shasum -a 256 package-lock.json | cut -d' ' -f1)
REMOTE_HASH=$(ssh "$HOST" "cat ~/$DIR/.deploy-lock 2>/dev/null" || true)
REMOTE_MODULES=$(ssh "$HOST" "test -d ~/$DIR/node_modules && echo yes || echo no")

if [[ "$REMOTE_HASH" == "$LOCK_HASH" && "$REMOTE_MODULES" == "yes" ]]; then
  step "3/7 依赖没变化，跳过服务器 npm ci"
else
  step "3/7 依赖有变化：服务器安装依赖（nice + 限内存，不挤同机其他服务）"
  ssh "$HOST" "
set -e
cd ~/$DIR
export PATH=$REMOTE_NODE_BIN:\$PATH
nice -n 19 env NODE_OPTIONS=--max-old-space-size=640 npm ci --no-audit --no-fund
echo '$LOCK_HASH' > .deploy-lock
echo '依赖安装完成'
"
fi

step "4/7 上传构建产物到 ~/$DIR/.next-new（排除 dev/cache/trace 后约 70MB）"
ssh "$HOST" "cd ~/$DIR && rm -rf .next-new && mkdir .next-new"
COPYFILE_DISABLE=1 tar --no-xattrs -czf - --exclude .DS_Store --exclude '._*' \
  --exclude dev --exclude cache --exclude trace \
  -C .next . \
  | ssh "$HOST" "
set -e
cd ~/$DIR/.next-new
tar -xzf -
test -f BUILD_ID
echo '构建产物已就位'
"

step "5/7 备份 → 换上新构建 → 拉起 pm2 进程 ${PM2_NAME}（端口 ${PORT}）"
ssh "$HOST" "
set -e
cd ~/$DIR
export PATH=$REMOTE_NODE_BIN:\$PATH
mkdir -p ~/backups
ts=\$(date +%Y%m%d-%H%M)
tar -czf ~/backups/$DIR-pre-deploy-\$ts.tar.gz --exclude node_modules --exclude .next --exclude .next-new --exclude .next-old --exclude data .
rm -rf .next-old
[ -d .next ] && mv .next .next-old || true
mv .next-new .next
if pm2 describe $PM2_NAME >/dev/null 2>&1; then
  # 不带 --update-env：保留创建进程时捕获的 PORT=3100，避免回落到 3000 撞正式站
  pm2 restart $PM2_NAME
else
  PORT=$PORT pm2 start \"npm run start\" --name $PM2_NAME
fi
pm2 save
# 只留最新一份备份
ls -1t ~/backups/$DIR-pre-deploy-*.tar.gz 2>/dev/null | tail -n +2 | xargs -r rm -f
echo \"备份：~/backups/$DIR-pre-deploy-\$ts.tar.gz\"
"

step "6/7 健康检查（失败自动回退）"
sleep 3
if ! ssh "$HOST" "
curl -s -m 8 -o /dev/null -w 'app   /lock  -> %{http_code}\n' http://127.0.0.1:$PORT/lock
curl -s -m 8 http://127.0.0.1:$PORT/lock | grep -q 演示站
"; then
  echo '!! 健康检查失败（/lock 不通或没看到演示提示），回退到上一版' >&2
  ssh "$HOST" "
cd ~/$DIR
export PATH=$REMOTE_NODE_BIN:\$PATH
pm2 stop $PM2_NAME 2>/dev/null || true
rm -rf .next
if [ -d .next-old ]; then mv .next-old .next; fi
if pm2 describe $PM2_NAME >/dev/null 2>&1; then pm2 restart $PM2_NAME; else PORT=$PORT pm2 start \"npm run start\" --name $PM2_NAME; fi
"
  exit 1
fi
echo '演示模式已生效（锁页可见演示密码提示）'

step "7/7 把 nginx 配置样例放到服务器家目录（root 步骤见下）"
scp -q deploy/demo.nginx.conf.example "$HOST:~/journal-demo.nginx.conf"
cat <<TIP

✅ 应用已上线：服务器本机 http://127.0.0.1:$PORT

最后一步——nginx 子域名 + HTTPS（需要 root）。登录服务器执行：

  ssh $HOST
  sudo cp ~/journal-demo.nginx.conf /etc/nginx/conf.d/$DOMAIN.conf
  sudo sed -i 's/demo\\.example\\.com/$DOMAIN/g' /etc/nginx/conf.d/$DOMAIN.conf
  sudo nginx -t && sudo systemctl reload nginx
  sudo certbot --nginx -d $DOMAIN

之后打开 https://$DOMAIN 就是演示站。

提醒：pm2 的开机自启是另一回事（一次性配置）。如果重启服务器后 pm2 进程
没自动回来，执行 pm2 startup 按提示配一次，再 pm2 save。
TIP
