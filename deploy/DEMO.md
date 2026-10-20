# 我们的小星球 · 演示站部署（子域名）

把开源版部署成公开演示站：**任何人都能玩，但谁都改不坏**。

- 整本手账跑在内存里，每 `DEMO_RESET_MINUTES` 分钟（默认 5）自动重置回种子内容，磁盘数据库只读；
- 上传的照片 / 视频 / 实况 / 语音 / GIF 一律换成 `scripts/seed-assets` 里的内置样例（访客传的文件字节直接丢弃，不落盘）；
- 删除操作删得掉内存里的行，动不了磁盘上的样例文件；
- 锁页 / 写作页 / 左下角徽标会显示演示密码，访客不用猜。

普通部署不受影响：不设 `NEXT_PUBLIC_DEMO_MODE` 时一切照旧。

## 日常更新（一条命令）

`bash scripts/deploy-demo.sh`：本机构建演示模式产物 → 传到服务器 → pm2 拉起 → 健康检查（失败自动回退）。
全程不需要 root；nginx + 证书的 root 步骤只在首次部署时做一次（脚本最后会打印）。

> 小内存服务器（2核3.5G 这类）**不要**在服务器上 `npm run build`——会把整机打满、
> 挤死同机的其他服务。要在线上构建，至少学 `deploy.sh` 那样 `nice -n 19` + 限 Node 堆内存。

## 一、准备

- 一台能跑 Node 20+ 的 Linux 服务器（演示站不需要 ffmpeg，因为上传都换样例了）；
- 一个子域名，比如 `demo.example.com`，DNS 加一条 A 记录指向服务器 IP；
- 服务器上装好 nginx 和 pm2（`apt install nginx` 再 `npm i -g pm2`；用别的反代也行，参考下面的配置改）。

## 二、服务器上安装（一次性）

```bash
# 1. 拉代码（main 分支），放到家目录
git clone -b main https://github.com/zhangzhiwei0905/our-little-planet.git ~/our-little-planet-demo
cd ~/our-little-planet-demo

# 2. 写演示站的 .env.local
cat > .env.local <<'EOF'
# 演示站开关（改了要重新 build）
NEXT_PUBLIC_DEMO_MODE=1
# 多少分钟重置一次内存数据
DEMO_RESET_MINUTES=10
# 演示密码就用在界面上公开提示的那两个
READER_PASSWORD=0520
AUTHOR_PASSWORD=write-for-her
# openssl rand -hex 32 生成一次
AUTH_SECRET=换成随机长字符串
# 快捷指令通道：不填 = 关闭（演示站建议关着；想开就填个演示值）
SHORTCUT_TOKEN=
EOF

# 3. 安装依赖、种样例内容（构建不在服务器上做，见下）
npm ci
npm run seed
```

> `NEXT_PUBLIC_` 开头的变量是构建时写进前端代码的，改它必须重新构建。
> 服务器上不执行 `npm run build`——回本机跑 `bash scripts/deploy-demo.sh`，它会带着
> `NEXT_PUBLIC_DEMO_MODE=1` 构建、上传产物并把服务拉起来。

## 三、本机部署（首次 + 以后每次更新）

```bash
# 本机（项目根目录）
bash scripts/deploy-demo.sh
# 完成后服务器上 http://127.0.0.1:3100/lock 已可见「演示站：解锁密码」
```

脚本会用 pm2 拉起名为 `journal-demo` 的进程（端口 3100，env 里捕获 `PORT=3100`，
不会碰正式站的 3000）。不想用 pm2 的，也可以用仓库里的 systemd 服务文件
（`deploy/our-little-planet-demo.service`，路径端口按需改）：

```bash
sudo cp deploy/our-little-planet-demo.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now our-little-planet-demo
```

## 四、nginx 子域名 + HTTPS（一次性，需要 root）

```bash
sudo cp ~/journal-demo.nginx.conf /etc/nginx/conf.d/你的子域名.conf   # deploy-demo.sh 会把样例放到家目录
sudo sed -i 's/demo.example.com/你的子域名/g' /etc/nginx/conf.d/你的子域名.conf
sudo nginx -t && sudo systemctl reload nginx   # 此时 http://你的子域名 已可访问
sudo certbot --nginx -d 你的子域名             # 没装就先 apt install certbot python3-certbot-nginx
```

> 顺序很重要：配置初始不含 ssl 行（证书没签之前写了证书路径，`nginx -t` 会直接失败）。
> 先 reload 让 HTTP 通，`certbot --nginx` 会自动签发证书、加上 443 监听和 80→443 跳转。

演示配置里做了一件额外的事：对写接口（POST/PUT/PATCH/DELETE）按 IP 限速（每分钟 15 次加突发），
请求体上限也降到 12MB——反正上传都换样例，没必要放大文件口子。

## 五、以后怎么更新

改完代码提交后，本机一条命令：`bash scripts/deploy-demo.sh`。
样例内容（seed 素材/文案）有更新时，登录服务器补一句 `cd ~/our-little-planet-demo && npm run seed`。

磁盘上的 `data/` 永远只有 `npm run seed` 写进去的东西；服务重启后内存数据也会重新从快照恢复。

## 六、看访问量（PV / UV）

配置里已给演示站开了独立日志 `/var/log/nginx/journal-demo.access.log`（nginx 自带的
logrotate 会自动轮转）。内置的「访客记录」页在演示站上只有 10 分钟记忆（随内存库重置），
发帖宣传的访问量以这份日志为准：

```bash
# 今日 PV / UV（按 IP 去重，排除爬虫 UA）
awk -v d="$(date +%d/%b/%Y)" '$4 ~ d' /var/log/nginx/journal-demo.access.log \
  | grep -viE 'bot|crawler|spider|curl' > /tmp/today.log
echo "今日 PV: $(wc -l < /tmp/today.log)"
echo "今日 UV: $(awk '{print $1}' /tmp/today.log | sort -u | wc -l)"

# 哪里来的（来源 referer，看论坛引流效果）
awk -v d="$(date +%d/%b/%Y)" '$4 ~ d' /var/log/nginx/journal-demo.access.log \
  | awk -F'"' '{print $6}' | sort | uniq -c | sort -rn | head -10
```

想要实时仪表盘再装 GoAccess：`goaccess /var/log/nginx/journal-demo.access.log --log-format=COMBINED -o stats.html --real-time-html`。

## 行为速查

| 操作 | 演示站行为 |
|---|---|
| 解锁 / 拿笔 | 正常（密码在界面提示） |
| 写手账 / 语录 / 信 / 拼贴 | 成功返回，内存里可见，重置后消失 |
| 传照片 / 视频 / 实况 / 语音 / GIF | 字节丢弃，显示内置样例素材 |
| 她的印章 / 回话 / 彩蛋涂鸦 | 正常使用，重置后消失 |
| 删内容 | 内存里删得掉（重置又回来），磁盘文件不动 |
| 访客记录 | 照常记，重置清空；不调外部 GeoIP 接口 |
| 快捷指令 `/api/quick` | 默认关闭（没配 `SHORTCUT_TOKEN` 就是 503） |
