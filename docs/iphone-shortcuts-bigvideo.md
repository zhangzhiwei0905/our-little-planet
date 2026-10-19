# 大视频直传（三步上传）

单个几百 MB 的长视频不要塞进 multipart 表单：表单要把整个请求读进服务器内存，
会把小服务器的内存和 CPU 打趴（也会超时）。改用「直传」三步：
**prepare 拿地址 → 手机直接把文件 PUT 上去 → quick 登记**。
配置了 OSS 的服务器，上传的文件主体不经过本子的服务器。
实际速度还受客户端到 OSS 的链路、网络代理和 OSS 服务响应影响，不能只凭架构承诺速度。
登记后的后台封面任务是另一阶段，仍需单独测量 CPU、内存和回源流量（见文末）。

本文对应 `POST /api/quick/prepare`、`PUT /api/quick/file`（本地存储模式）
和 `POST /api/quick` 的 `media[]` 字段。先部署新版接口再配置。

## 什么时候用直传

- **普通照片、实况照片（ZIP / livp）、HEIC**：继续用原来的 multipart 表单指令，不用改。
- **视频**：建议一律走直传（哪怕只有几十 MB），省服务器内存；
  尤其单个 ≥100MB 的视频，multipart 会被 150MB 上限直接拒绝。
- 一次最多 9 项媒体、18 个文件的规则不变；同名「照片 + 视频」的 Live Photo
  配对规则也不变（直传一样生效，但实况的静态图多是 HEIC，实况仍建议走 ZIP 老通道）。

## 快捷指令动作链（单视频版）

### 1. 选文件、记名目

1. 「选择照片」：不开启多选（或开启多选后逐项重复，见下）。
2. 对当前文件分别执行「获取名称」和「获取文件扩展名」。
   「名称」可能只是 `item-1`，不能单独发给 prepare。先在文本动作中将名称、
   句点和扩展名拼成完整文件名，例如 `item-1.mov`。
3. MIME 要与扩展名对应：`mov` → `video/quicktime`，
   `mp4`、`m4v` → `video/mp4`。不要把 `application/octet-stream` 传给 prepare。
4. 「获取文件大小」：设为变量 `大小`（仅用于 prepare 的预检，可不填）。

### 2. prepare：拿直传地址

「获取 URL 内容」：

- URL：`https://你的域名/api/quick/prepare`
- 方法 `POST`，「请求体」→ JSON：
  `{ "files": [{ "name": "文件名变量", "size": 大小变量 }] }`
- 「展开」→ 请求头：`Authorization: Bearer 你的 SHORTCUT_TOKEN`

成功返回（示例）：

```json
{ "mode": "oss", "files": [ { "name": "IMG_1234.mov", "direct": true,
  "mediaId": "3378d60fc7be", "key": "media/3378d60fc7be.mov",
  "mime": "video/quicktime",
  "uploadUrl": "https://bucket.oss-.../media/3378d60fc7be.mov?..." } ] }
```

「获取词典值」依次取出：`files` → 第 1 项 → `uploadUrl`、`key`、`mime`，分别设为变量。
若 `direct` 为 `false`（误选了 HEIC / ZIP），提示后改走老的表单指令。

### 3. PUT：手机直传文件（关键设置）

「获取 URL 内容」：

- URL：`上传地址` 变量，方法 `PUT`
- 「请求体」→ 文件：选中的那个视频
- 「展开」→ 请求头：
  - **只在 `mode=local` 时**设置 `Authorization: Bearer 你的 SHORTCUT_TOKEN`。
    `mode=oss` 使用签名 URL 自带的授权，**不要再把网站令牌发送给 OSS**。
  - `Content-Type: <prepare 返回的 mime 变量>`——**必须一字不差**，
    签名和这个类型绑定，写成别的会 403
- 本次检查的 Mac 版「获取 URL 内容」没有可编辑的超时项，不能依赖“展开后改成 5 分钟”
  这一设置，也不要假定已验证默认超时为 30 秒。必须在实际运行设备上验证大文件耗时和超时行为。

### 4. quick：登记进本子

「获取 URL 内容」：

- URL：`https://你的域名/api/quick`
- 方法 `POST`，JSON 请求体：

```json
{ "type": "photo", "text": "一句话备注（可空）", "date": "2026-10-12",
  "media": [ { "key": "key 变量", "name": "文件名变量", "mime": "mime 变量" } ] }
```

`type` 也可以是 `journal`（写一篇手帐）。`date` 可省略（默认今天）。
返回 `path` 同老通道：`/album` 或 `/journal`。视频的时长、尺寸、封面
由服务器在后台几秒内自动补齐，不用等。

### 5. 显示通知

「显示通知」：成功 / 失败 + 返回的 `path`，方便确认。

## 多个视频

把第 1–3 步包进「重复每一项」：每项单独 prepare、单独 PUT，
把每次的 `key / name / mime` 用「添加到变量」攒进列表；
循环结束后把列表填进第 4 步的 `media` 数组一次登记。

**单文件陷阱：**原生「设定字典值」接收只有一个字典的变量列表时，
会将它保存为字典，而不是单元素数组。本机离线实测已确认这一行为。
只传一个文件时应显式构造 `media: [{ key, name, mime }]`；多个文件时再使用累积列表。
传给 prepare 和登记的 `name` 必须是拼接后的完整文件名，不能是「获取名称」返回的
无扩展名主名，否则服务器会拒绝为它签发直传地址。
正文、日期和媒体数据使用原生字典序列化为 JSON，不要手拼包含用户正文的 JSON 字符串。

仓库不附带签名好的 `.shortcut` 文件（签名里带着签名者的身份信息）。
可以照上面的步骤手动搭，也可以用 `scripts/build-direct-shortcut.py --template <你导出的旧流程 plist> --base https://你的域名 --output 记手帐直传.plist`
从自己导出的旧流程生成原生动作，再用 `shortcuts sign` 签名，令牌位置是占位符 `SHORTCUT_TOKEN_PLACEHOLDER`，导入后换成你的令牌。
普通视频保留原文件，不重新编码或打 ZIP；原流程的 JPEG 转换及实况同名配对逻辑保留。
签名后使用 `scripts/audit-shortcut.py` 比对实际归档中的全部动作与 unsigned 输入，
通过后再导入或执行；签名操作串行执行，不能假定两个同时签名的输出互相独立。

## 限制与说明

- 单次 PUT 没有断点续传：中途失败就整个重来（重新 prepare 拿新地址）。
  未登记成功的直传对象会留在存储里，无害但占空间，可在 OSS 控制台定期清理。
- 上传速度 = 手机到 OSS（或服务器）的直连带宽，通常远快于经服务器中转。
- 服务器是本地存储模式（没配 OSS）时，`uploadUrl` 会指向 `/api/quick/file`，
  服务器边收边落盘、内存占用恒定，同样不会被大文件打趴；动作链完全一样。
- 别把 SHORTCUT_TOKEN 分享给别人；泄露后在 `.env.local` 换一个即可作废。

## 性能验证边界

当前 `src/lib/media.ts` 的 `thumbAfterUpload` 在 OSS 视频分支中仍使用
`res.arrayBuffer()` 将整段视频读进内存，再写临时文件、探测元信息和抽封面。
因此三步上传解决了**上传请求**的中转问题，但没有消除**登记后的后台任务**
对服务器的内存、下载流量及 CPU 影响。并发登记多个视频还会同时启动后台任务。

验证应分开记录 prepare、PUT、quick 登记和后台封面完成的时间，
并采样 Next.js 进程及其 ffmpeg 子进程的 CPU、RSS、服务器可用内存和网站响应时间。
单次无并发测试正常，也不能证明多视频并发或多用户同时上传时不会影响线上。
