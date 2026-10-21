# 部署指南

[返回项目首页](../README.md) · [安全设计](SECURITY.md) · [本地开发](DEVELOPMENT.md)

CipherMemo 使用 Cloudflare Workers Static Assets、Workers API、D1 和私有 R2，无需 VPS。部署前准备 GitHub、Cloudflare 账号，并在 Cloudflare 开通 R2。开通 R2 可能需要支付资料，平台费用以自己的 Cloudflare 账号为准。

## 一键部署

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https%3A%2F%2Fgithub.com%2Fwangmancang520%2Fciphermemo)

官方模板流程会将本项目复制到部署者的 GitHub 账号下并创建仓库，再部署到自己的 Cloudflare 账号，无需预先 Fork。

| 配置               | 值                                               |
| ------------------ | ------------------------------------------------ |
| 应用 / Worker 名称 | `ciphermemo`，与 `wrangler.jsonc` 的 `name` 一致 |
| 项目根目录         | 仓库根目录                                       |
| 构建命令           | `npm run build`                                  |
| 部署命令           | `npm run deploy`                                 |
| 数据库             | D1，绑定名称 `DB`                                |
| 文件存储           | 私有 R2，绑定名称 `FILES`                        |
| 运行时 Secret      | `SETUP_TOKEN`                                    |

Cloudflare 根据 `wrangler.jsonc` 的资源声明创建并绑定资源；首次 API 请求会幂等初始化数据表。无需手动执行建表 SQL。

## 初始化口令设置

部署完成后，打开：

**Workers & Pages → 你的 Worker → Settings → Variables and Secrets → Add**。

| 字段                 | 内容                                                 |
| -------------------- | ---------------------------------------------------- |
| 类型 / Type          | **Secret**                                           |
| 名称 / Variable name | **`SETUP_TOKEN`**                                    |
| 值 / Value           | 自行生成并安全保存的、至少 **32 字符**的独立随机口令 |

选择 **Deploy / 保存并部署** 使配置生效，再刷新网站。

- 这是 **Worker 运行时 Secret**。Settings → Builds 中的构建变量不能替代它。
- 部署流程没有口令输入框时，可以先完成部署，再添加 Secret。
- 不要把真实口令写进仓库、`wrangler.jsonc`、构建日志、截图或 Issue。
- 此口令仅用于创建唯一账号，不是日常登录密码。

然后通过 HTTPS 打开网站，填写同一初始化口令，设置邮箱和至少 14 字符的登录密码，下载并离线保存恢复密钥。恢复密钥应放在这个空间之外。

初始化成功后，可删除运行时 `SETUP_TOKEN`；正常登录、保存和解密不依赖它。

## HTTPS 与自定义域名

线上访问必须使用 **HTTPS**。Web Crypto 在非安全连接下不可用，无法完成登录和解密。自定义域名需要先配置有效证书。

应用会将非本机 HTTP 请求跳转到同域 HTTPS；如果在 Cloudflare 控制台配置跳转或 TLS，请避免让边缘 HTTPS 请求被上游配置重新降回 HTTP。

本地 `http://localhost`、`http://127.0.0.1` 与 IPv6 回环地址可用于开发；局域网 IP 的 HTTP 地址不享受安全上下文例外。

## 升级现有部署

1. 升级前下载一份加密空间备份，并记录导出时使用的密码。
2. 将项目更新到需要的提交，保持现有 Worker、D1 和 R2 的绑定。
3. 按原有流程重新构建、部署，通过 HTTPS 刷新页面。
4. 验证登录、原有内容、附件、个人信息和保存状态。

数据表会幂等创建，包括新增的个人信息表。升级现有空间无需重新初始化、重新建库或删除数据。请保留部署后实际使用的 D1 / R2 资源标识，避免意外切换到新建的空数据库或存储桶。

## 命令行部署

需要 Node.js 22+、npm，以及能访问 Cloudflare 的网络环境。

```sh
npm ci
npx wrangler login
npm run deploy:local
npx wrangler secret put SETUP_TOKEN
```

通过最后一个命令的交互输入设置口令，不要将真实值写入命令参数或提交历史。Wrangler 自动创建资源后可能更新本机配置，请保留生成的资源信息。

## 常见问题

### 提示“未配置初始化口令”

检查 Secret 是否添加到了**当前 Worker 的运行时**，名称是否为 `SETUP_TOKEN`，值是否至少 32 字符，并确认保存后已重新部署。无需重新 Fork 或创建另一个空间。

### 报错 `Cannot read properties of undefined (reading 'importKey')`

先确认地址以 `https://` 开头，并且证书有效。若已使用 HTTPS，请使用最新版 Chrome、Edge、Firefox 或 Safari 独立打开页面，避免从不安全网页内嵌访问。新版界面会提前给出兼容性提示。

### 旧账号不是邮箱，还能登录吗

可以。登录表单使用“邮箱”作为标识，但已初始化账号仍以原账号值校验，不会自动迁移、修改或清空旧账号。修改空间昵称也不会改变登录账号。

### 进度条满了就不能上传吗

不会。**5GB 是显示基准**，不作为应用层存储上限。平台存储、行大小、请求、账单和浏览器内存仍有约束；头像单独限制为 5MB。

### 更换头像会保存到哪里

头像在浏览器内加密，复用附件分块上传，写入私有 R2；昵称与个人信息密文保存在 D1。头像计入用量，替换后的旧图会清理，当前使用中的头像有删除保护。

### 忘记登录密码

通过登录页的恢复入口，使用离线恢复密钥重设密码。恢复密钥保持在本空间之外。如果密码与恢复密钥同时丢失，项目没有绕过加密的恢复通道。

### 换了密码，旧备份无法打开

旧备份需要**导出时的密码**。修改当前密码不会重新加密已经下载的备份。

### 导入备份后出现重复条目

导入会创建副本，不覆盖已有内容。中断后重试可能重复导入，先查看已完成部分。个人信息仅在当前空间尚未设置时恢复，已有昵称和头像保持不变。

## 参考

- [Deploy to Cloudflare](https://developers.cloudflare.com/workers/platform/deploy-buttons/)
- [Workers 自动创建资源](https://developers.cloudflare.com/workers/wrangler/configuration/#automatic-provisioning)
- [运行时 Secret](https://developers.cloudflare.com/workers/configuration/secrets/#via-the-dashboard)
- [Cloudflare 构建配置](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/)
