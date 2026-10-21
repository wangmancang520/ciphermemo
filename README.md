# CipherMemo

一个只属于自己的在线加密备忘录 / 轻量保险箱。使用账号密码访问，支持 Markdown、账号密码、激活密钥、图片和文件。前后端、数据库、对象存储全部运行在 Cloudflare，无需 VPS。

**当前版本：0.1.0。单账号，不开放注册，无应用层单文件或空间容量配额，显示实际内容用量。**

## 功能

- 浏览器端 Argon2id + AES-256-GCM 加密，正文、凭据、文件名和文件内容上传前加密。
- 单账号初始化；正常页面只有登录与恢复入口，初始化完成后无法再创建账号。
- 临时设备：不持久保存解锁材料，5 分钟无操作锁定；服务端临时会话 30 分钟无请求失效，最长 24 小时。
- 可信设备：主动勾选后固定 14 天免输密码，支持列出和远程撤销设备。
- Markdown 编辑、净化后的预览、标签、置顶、本地全文搜索、自动保存。
- 乐观并发控制：遇到其他设备修改时拒绝覆盖，允许另存副本。
- 图片粘贴、拖拽与文件附件；按需预览图片；下载时本地解密。
- 文件按 4 MiB 明文分块独立加密，上传重试不会重复计费字节；不设置整个文件的产品配额。
- 回收站默认保留 30 天，支持恢复与永久删除。
- 空间用量展示，包含回收站、附件密文与待处理上传；不显示虚构的配额百分比。
- 恢复密钥、修改密码、加密备份导出与导入。

## 部署到自己的 Cloudflare

项目使用 Workers Static Assets + Workers API + D1 + 私有 R2。数据库表在首次 API 请求时幂等初始化；无需手动运行建表 SQL。资源声明位于 `wrangler.jsonc`。

### 当前私有仓库的推荐方式

1. 在 Cloudflare Dashboard → Workers & Pages → 创建应用 → 从 Git 仓库导入，选择此私有仓库。需要让 Cloudflare 的 GitHub 集成访问这个仓库。
2. 构建命令设为 `npm run build`，部署命令设为 `npm run cf:deploy`，根目录保持仓库根目录。
3. 配置运行时 Secret **`SETUP_TOKEN`**：至少 32 个字符的独立随机口令。它只用于首次初始化，不是你的登录密码。若导入流程只设置了构建变量，请在 Worker 的 Settings → Variables and Secrets 中另行添加运行时 Secret。
4. 部署会根据 Wrangler 声明创建 / 绑定 D1 与 R2。账号需先开通 R2；如果有同名资源冲突，请修改资源名，或在配置中填写已有资源的数据库 ID / 存储桶名称。
5. 打开 Worker 地址，输入初始化口令、用户名和至少 14 字符的登录密码。保存离线恢复密钥后进入空间。
6. 初始化成功后可以删除运行时 `SETUP_TOKEN`。数据库已存在时初始化入口会关闭。

Cloudflare 账号授权、R2 服务开通、可能的支付资料以及自定义域名由部署者在自己的账号完成。R2 桶不要开启公共访问。

### 官方部署按钮

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https%3A%2F%2Fgithub.com%2Fwangmancang520%2Fciphermemo)

Cloudflare 官方按钮的文档面向**公开模板仓库**。本项目当前为私有仓库，不保证按钮能直接读取；请使用上面的私有 Git 导入流程。若以后发布公开模板，可直接复用该按钮，自动创建 D1、R2 和 Worker。首次仍需设置初始化 Secret。

### 命令行备选方式

需要 Node.js 22 或以上，以及能够访问 Cloudflare 的环境：

```sh
npm ci
npx wrangler login
npm run deploy
npx wrangler secret put SETUP_TOKEN
```

运行时密钥通过 Wrangler 的交互输入设置，不要写进仓库、命令参数或 GitHub issue。自动资源创建会更新本机 Wrangler 配置，注意保存生成的资源 ID。

## 本地开发

```sh
npm ci
npm run setup:local
npm run build
npm run dev:api
```

打开 Wrangler 输出的 `http://localhost:8787`。本地 D1 / R2 数据位于被忽略的 `.wrangler/`，与线上完全分离。首次从 `.dev.vars` 复制本地生成的初始化口令；该文件不会提交到 Git。

需要前端热更新时，在第二个终端执行 `npm run dev`。Vite 将 `/api` 代理到 8787；初始化或登录时固定使用同一个主机名，避免 Cookie 被分到 localhost 和 127.0.0.1 两个站点。

## 验证

```sh
npm run build
npm test
npx wrangler deploy --dry-run
```

测试使用 Cloudflare Miniflare 的真实本地 D1 / R2 实现，覆盖加解密、错误密码、来源检查、会话过期 / 撤销、密码恢复、并发编辑、分块幂等与文件清理。测试数据全部是虚构数据。

## 加密设计

1. Argon2id 参数：64 MiB 内存、3 次迭代、并行度 1、随机 16 字节盐，输出 32 字节。盐和参数公开存储。
2. HKDF-SHA-256 使用独立用途标签派生登录凭证与密码包装密钥。登录凭证是可重放的 bearer secret，仅通过 HTTPS 请求体传输；服务端保存其 SHA-256 校验值。此方案不是 PAKE，仍信任首次加载的网页代码和 HTTPS 通道。
3. 随机生成 256 位数据密钥；密码包装密钥用 AES-GCM 加密数据密钥。数据密钥只在浏览器解锁后可用。
4. 另生成独立随机恢复密钥，用不同用途派生恢复凭证和包装密钥，保存第二份数据密钥密文。忘记密码时可在浏览器重新包装数据密钥，不向服务器暴露明文密钥。
5. 内容使用 AES-256-GCM，每次加密随机 96 位 IV。附加认证数据绑定协议版本、对象 ID 和文件分块顺序；文件下载校验分块数量与原始总长度。
6. 可信设备将不可导出的 Web Crypto 设备密钥和被其包装的数据密钥保存在 IndexedDB。只有对应服务器会话仍有效且账号版本匹配时才自动解锁；不保存原始密码。
7. 修改密码递增账号版本，使旧会话立即失效，并撤销所有会话。恢复密钥保持有效。

## 安全与运行边界

- 面向个人使用的第一版，尚未经过独立安全审计。首次上线建议先用非关键测试数据验证备份恢复。
- 浏览器或部署的前端代码被控制时，加密无法保护正在解锁的内容；不可导出 CryptoKey 也不代表硬件保护。
- 可信设备意味着拥有该浏览器配置的人在有效期内可能直接打开空间。远程撤销阻止后续在线访问，不能收回已经下载的内容或擦除离线设备。
- 临时设备不持久保存解锁材料；关闭或退出时仅能尽力释放页面明文与密钥引用，不能保证清除操作系统内存、剪贴板、恶意扩展或浏览器自身的残留。
- 网络失败时的未保存编辑不会静默覆盖。锁定前可在当前页面内暂存加密编辑，重新登录后恢复为副本；关闭页面会丢失这份内存暂存。
- 修改密码只重新包装数据密钥。若旧密码与旧数据包装均已泄露，仅修改密码不能撤回旧密钥；本版尚未实现全空间数据密钥轮换。
- 没有应用层文件或容量配额不等于物理无限：Workers、D1、R2、浏览器内存和账单仍有平台约束。长正文存储在 D1 单行，受其行大小限制；附件通过分块避免整个文件占用 Worker 内存。
- 当前下载和备份在浏览器内组装完整 Blob / JSON；超大文件或大空间受设备内存限制。本版优先小文件存取，尚未提供流式写入本地文件系统、跨刷新断点续传或自动图片缩略图。
- 数据库只保存内容密文，但服务器可见用户名、对象数量、时间、密文长度、置顶 / 回收站状态、会话设备名称等必要元数据。
- 容量为内容负载与加密封装的字节统计，包含附件元数据和回收站；不含数据库索引、R2 孤立对象清理前的短暂开销，不等于完整计费量。
- 每日 Cron 清理过期回收站、未完成上传和会话，并分批核对孤立 R2 分块。删除可重试，但 D1 与 R2 没有跨服务原子事务。
- 全文搜索在浏览器解密后的文本中完成。本版会加载空间内全部文本；附件按需读取。
- 备份包含回收站与附件密文，需要**导出当时的密码**；修改密码不会更新旧备份。导入会创建新副本，可能在网络失败时部分完成，重试前查看已导入内容。
- 本版只支持加密备份，没有一键导出全部明文的功能。文件附件可单独解密下载。
- 默认关闭 Worker 请求日志；若自行开启监控，不要记录请求体、Cookie、登录凭证或文件内容。
- D1 与 R2 的备份需分别考虑。定期下载加密空间备份，不要仅依赖数据库恢复。

## 源码结构

```text
src/client/          React 界面、客户端加密、可信设备、文件处理
src/server/          Worker API、权限校验、D1 / R2 与清理
src/shared/          协议类型
migrations/          首版幂等建表 SQL
scripts/             本地初始化工具
tests/               加密与 Cloudflare 存储集成测试
wrangler.jsonc       Cloudflare 部署与资源声明
```

## 官方参考

- [Deploy to Cloudflare](https://developers.cloudflare.com/workers/platform/deploy-buttons/)
- [Workers 自动创建资源](https://developers.cloudflare.com/workers/wrangler/configuration/#automatic-provisioning)
- [R2 定价与免费额度](https://developers.cloudflare.com/r2/pricing/)
- [D1 平台限制](https://developers.cloudflare.com/d1/platform/limits/)
- [OWASP 密码存储](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html)
