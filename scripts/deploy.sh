#!/usr/bin/env bash
# 部署「我们的小星球」到你自己的服务器（~/.ssh/config 里配好的主机别名）
#
# 默认模式（本地构建）：Mac 上构建好 .next，把产物传上去换名重启。
#      服务器不再执行 npm ci / next build——这台 2核3.5G 的机器上还跑着
#      一堆别的服务，之前在服务器全量构建会把内存打满、负载飙到 9+，
#      线上抢不到资源直接卡死。产物排除 dev/cache 后只有 ~70MB，上传很快。
#      依赖只在 package-lock.json 变化时才在服务器装（nice + 限内存）。
#
# 老模式：SERVER_BUILD=1 bash scripts/deploy.sh 仍可在服务器构建（低配机
#      不建议），已加 nice 降优先级 + Node 堆内存上限，尽量不挤别的服务。
#
# 服务器上需要先手动准备好一次：~/$DEPLOY_DIR 目录（含 .env.local）、Node 20+、pm2 里名为
# $PM2_NAME 的进程（如 pm2 start "npm run start" --name journal）、~/backups 目录、Nginx 反代。
#
# 用法：
#   DEPLOY_HOST=myserver DOMAIN=example.com bash scripts/deploy.sh   # 默认：本地构建 → 传产物上线
#   SKIP_LOCAL_BUILD=1 bash scripts/deploy.sh  # 跳过本地构建（刚构建过时）
#   SERVER_BUILD=1 bash scripts/deploy.sh      # 强制在服务器构建（不推荐）
set -euo pipefail
cd "$(dirname "$0")/.."

HOST="${DEPLOY_HOST:?请用 DEPLOY_HOST=主机别名 指定服务器（~/.ssh/config 里的 Host）}"
DIR="${DEPLOY_DIR:-our-little-planet}"  # 服务器上应用目录（家目录下）
PM2_NAME="${PM2_NAME:-journal}"    # pm2 里的应用名
DOMAIN="${DOMAIN:?请用 DOMAIN=你的域名 指定站点域名（健康检查用）}"
# 服务器上 Node 的 bin 目录（不在 PATH 里时用；默认兼容 ~/apps/node22 这种手动安装的位置）
REMOTE_NODE_BIN="${REMOTE_NODE_BIN:-\$HOME/apps/node22/bin}"

step() { printf "\n\033[1;35m==> %s\033[0m\n" "$*"; }

step "0/6 预检"
ssh -o BatchMode=yes "$HOST" 'echo "服务器连通 ok"' || {
  echo "连不上服务器，先解决再部署" >&2
  exit 1
}

if [[ "${SKIP_LOCAL_BUILD:-0}" != "1" ]]; then
  step "1/6 本地构建（把编译错误挡在本机）"
  npm run build
else
  step "1/6 跳过本地构建（SKIP_LOCAL_BUILD=1）"
  # 防陈旧产物上线：源码比构建产物新就拒绝继续
  if [[ -n "$(find src package.json next.config.ts -newer .next/BUILD_ID -print -quit 2>/dev/null)" ]]; then
    echo "源码比 .next/BUILD_ID 新：产物是旧的，去掉 SKIP_LOCAL_BUILD 重新构建" >&2
    exit 1
  fi
fi
[[ -f .next/BUILD_ID ]] || {
  echo ".next/BUILD_ID 不存在：本地构建没跑过？" >&2
  exit 1
}

step "2/6 同步源码到 $HOST:~/${DIR}（不碰 data / .env.local / node_modules）"
# COPYFILE_DISABLE=1：macOS 的 tar 默认把扩展属性打包成 ._* AppleDouble 垃圾文件，
# 解到服务器就是一地 ._route.ts（以点开头不影响构建，但脏），从源头掐掉
# --no-xattrs：新版 macOS 给文件打 com.apple.provenance 溯源属性，bsdtar 会把它
# 写成 LIBARCHIVE.xattr.* 扩展头，服务器 GNU tar 不认识，每 个文件刷一句
# "Ignoring unknown extended header keyword" 警告——打包时不带 xattr 就清净了
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
  step "3/6 依赖没变化，跳过服务器 npm ci"
else
  step "3/6 依赖有变化：服务器安装依赖（nice + 限内存，不挤爆同机的其他服务）"
  ssh "$HOST" "
set -e
cd ~/$DIR
export PATH=$REMOTE_NODE_BIN:\$PATH
nice -n 19 env NODE_OPTIONS=--max-old-space-size=640 npm ci --no-audit --no-fund
echo '$LOCK_HASH' > .deploy-lock
echo '依赖安装完成'
"
fi

if [[ "${SERVER_BUILD:-0}" == "1" ]]; then
  step "4/6 服务器构建（SERVER_BUILD=1；nice + 限内存，构建期间网站可能略卡）"
  ssh "$HOST" "
set -e
cd ~/$DIR
export PATH=$REMOTE_NODE_BIN:\$PATH
rm -rf .next-new
NEXT_DIST_DIR=.next-new nice -n 19 env NODE_OPTIONS=--max-old-space-size=768 npm run build
test -f .next-new/BUILD_ID
"
else
  step "4/6 上传本地构建产物（服务器零构建；排除 dev/cache/trace 后约 70MB）"
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
fi

step "5/6 备份 → 换上新构建 → 重启（停机只有换名+重启那几秒）"
ssh "$HOST" "
set -e
cd ~/$DIR
export PATH=$REMOTE_NODE_BIN:\$PATH
ts=\$(date +%Y%m%d-%H%M)
tar -czf ~/backups/$DIR-pre-deploy-\$ts.tar.gz --exclude node_modules --exclude .next --exclude .next-new --exclude .next-old --exclude data .
pm2 stop $PM2_NAME
rm -rf .next-old
mv .next .next-old
mv .next-new .next
pm2 start $PM2_NAME
pm2 save
# 只留最新一份备份（回退用上一份就够），旧的清掉
ls -1t ~/backups/$DIR-pre-deploy-*.tar.gz 2>/dev/null | tail -n +2 | xargs -r rm -f
echo \"备份：~/backups/$DIR-pre-deploy-\$ts.tar.gz（旧备份已清理）\"
"

step "6/6 健康检查"
sleep 3
ssh "$HOST" "
curl -s -m 5 -o /dev/null -w 'app   /lock  -> %{http_code}\n' http://127.0.0.1:3000/lock || {
  echo '!! 健康检查失败，回退到上一版'
  cd ~/$DIR && export PATH=$REMOTE_NODE_BIN:\$PATH
  pm2 stop $PM2_NAME
  rm -rf .next && mv .next-old .next
  pm2 start $PM2_NAME
  exit 1
}
curl -sk -m 5 --resolve $DOMAIN:443:127.0.0.1 -o /dev/null -w 'https /quotes -> %{http_code}\n' https://$DOMAIN/quotes
export PATH=$REMOTE_NODE_BIN:\$PATH
pm2 list | grep $PM2_NAME || true
"
ssh "$HOST" "rm -rf ~/$DIR/.next-old" && echo "旧构建已清理"
echo
echo "部署完成：https://$DOMAIN"
