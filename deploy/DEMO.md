# 我们的小星球 · 演示站部署（子域名）

把开源版部署成公开演示站：**任何人都能玩，但谁都改不坏**。

- 整本手账跑在内存里，每 `DEMO_RESET_MINUTES` 分钟（默认 5）自动重置回种子内容，磁盘数据库只读；
- 上传的照片 / 视频 / 实况 / 语音 / GIF 一律换成 `scripts/seed-assets` 里的内置样例（访客传的文件字节直接丢弃，不落盘）；
- 删除操作删得掉内存里的行，动不了磁盘上的样例文件；
- 锁页 / 写作页 / 左下角徽标会显示演示密码，访客不用猜。

普通部署不受影响：不设 `NEXT_PUBLIC_DEMO_MODE` 时一切照旧。

## 一、准备

- 一台能跑 Node 20+ 的 Linux 服务器（演示站不需要 ffmpeg，因为上传都换样例了）；
- 一个子域名，比如 `demo.example.com`，DNS 加一条 A 记录指向服务器 IP；
- 服务器上装好 nginx（`apt install nginx`；用别的反代也行，参考下面的配置改）。

## 二、服务器上安装

```bash
# 1. 拉代码（main 分支）
sudo mkdir -p /opt && sudo chown $USER /opt
git clone -b main https://github.com/zhangzhiwei0905/our-little-planet.git /opt/our-little-planet-demo
cd /opt/our-little-planet-demo

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

# 3. 安装依赖、种样例内容、构建
npm ci
npm run seed
NEXT_PUBLIC_DEMO_MODE=1 npm run build   # 或直接 npm run build（.env.local 里已有该变量）
```

> `NEXT_PUBLIC_` 开头的变量是构建时写进前端代码的，改它必须重新 `npm run build`。

## 三、systemd 常驻

```bash
sudo cp deploy/our-little-planet-demo.service /etc/systemd/system/
# 按需改里面的路径 / 用户 / 端口（默认 /opt/our-little-planet-demo、端口 3100）
sudo systemctl daemon-reload
sudo systemctl enable --now our-little-planet-demo
curl -s localhost:3100/lock | grep 演示   # 能看到「演示站：解锁密码」就成功了
```

## 四、nginx 子域名 + HTTPS

```bash
sudo cp deploy/demo.nginx.conf.example /etc/nginx/sites-available/our-little-planet-demo
sudo sed -i 's/demo.example.com/你的子域名/g' /etc/nginx/sites-available/our-little-planet-demo
sudo ln -s /etc/nginx/sites-available/our-little-planet-demo /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo apt install certbot python3-certbot-nginx   # 签证书 + 自动改写 ssl 配置
sudo certbot --nginx -d 你的子域名
```

演示配置里做了一件额外的事：对写接口（POST/PUT/PATCH/DELETE）按 IP 限速（每分钟 15 次加突发），
请求体上限也降到 12MB——反正上传都换样例，没必要放大文件口子。

## 五、以后怎么更新

```bash
cd /opt/our-little-planet-demo
git pull
npm ci
npm run seed        # 样例内容有更新时重新种
npm run build
sudo systemctl restart our-little-planet-demo
```

磁盘上的 `data/` 永远只有 `npm run seed` 写进去的东西；服务重启后内存数据也会重新从快照恢复。

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
