# 开发指南

[返回项目首页](../README.md) · [架构说明](ARCHITECTURE.md) · [贡献指南](../CONTRIBUTING.md)

## 环境

- Node.js 22 或以上
- npm
- 本地开发使用 Wrangler / Miniflare 提供 D1 与 R2 模拟环境
- 线上部署需要自己的 Cloudflare 账号和 R2

## 启动完整应用

```sh
git clone https://github.com/wangmancang520/ciphermemo.git
cd ciphermemo
npm ci
npm run setup:local
npm run build
npm run dev:api
```

打开 Wrangler 输出的本机 8787 地址。首次初始化时，从生成的 `.dev.vars` 复制 `SETUP_TOKEN`。初始化工具只在文件不存在时生成随机口令，不会覆盖已有配置。

本地 D1、R2 与其他运行状态保存在被忽略的 `.wrangler/` 目录，与线上独立。不要删除需要保留的本地测试数据。

## 前端热更新

在第二个终端运行：

```sh
npm run dev
```

Vite 监听 `127.0.0.1`，并将 `/api` 代理到 8787。完整端到端验证以 Wrangler 的 8787 同源入口为准；初始化、登录和保存请求须通过现有 Origin 校验。避免在 `localhost` 和 `127.0.0.1` 间混用会话。

## 常用脚本

| 命令                            | 作用                                 |
| ------------------------------- | ------------------------------------ |
| `npm run setup:local`           | 首次生成本机初始化口令文件           |
| `npm run dev`                   | Vite 前端热更新                      |
| `npm run dev:api`               | 启动本地 Worker / D1 / R2            |
| `npm run check`                 | TypeScript 类型检查                  |
| `npm run build`                 | 类型检查并构建到 `dist/`             |
| `npm test`                      | 运行 Vitest 回归测试                 |
| `npm run format`                | 格式化现有脚本配置指定的文件与目录   |
| `npx wrangler deploy --dry-run` | 校验 Worker 打包和资源声明           |
| `npm run deploy:local`          | 构建并部署到已登录的 Cloudflare 账号 |

`deploy:local` 会修改线上部署，不是本地预览命令。

## 验证范围

测试使用 Miniflare 的本地 D1 / R2 实现，数据均为虚构内容。

| 文件                                                        | 范围                                                                    |
| ----------------------------------------------------------- | ----------------------------------------------------------------------- |
| [`tests/crypto.test.ts`](../tests/crypto.test.ts)           | 派生一致性、密码包装、上下文绑定、篡改检测、分块与 Web Crypto 可用性    |
| [`tests/server.test.ts`](../tests/server.test.ts)           | 初始化、鉴权、会话、来源检查、HTTPS、回收站、并发、上传、个人信息和清理 |
| [`tests/preferences.test.ts`](../tests/preferences.test.ts) | 系统语言与主题、手动偏好、存储容错和跨标签页同步                        |
| [`tests/motion.test.ts`](../tests/motion.test.ts)           | 动画中断、连续切换、减少动态效果、浏览器降级与监听清理                  |

UI 变更还应检查：桌面与窄屏、浅色与深色、中英文、长邮箱与长昵称，以及保存失败时的反馈。交互动效还需检查快速连续切换、弹窗关闭后焦点恢复、编辑草稿保留、退出后私人内容卸载，以及系统“减少动态效果”启用时跳过动画。Logo 与文档图片检查见[品牌规范](BRANDING.md)。

## 目录结构

```text
.github/workflows/        GitHub Actions 验证流程
docs/                     部署、架构、安全与开发文档
  images/                 使用演示数据生成的界面截图
public/                   静态资源
  brand/                  SVG Logo、字标与 README 横幅
src/client/               React 界面、加密、可信设备与文件处理
  Brand.tsx               共用 Logo 与应用品牌组件
  ProfileEditor.tsx       个人信息编辑与头像预览
  Modal.tsx               共用弹窗与焦点管理
src/server/               Worker API、权限、D1 / R2 与定时清理
src/shared/               前后端共享协议类型
migrations/               幂等建表 SQL
scripts/                  本地初始化工具
tests/                    加密、存储与偏好测试
wrangler.jsonc            Cloudflare 资源与部署声明
```

## 配置与提交

- 不提交 `.dev.vars`、`.env`、`.wrangler/`、空间备份、私人内容或真实凭证。
- 不修改已有部署绑定，除非你明确计划迁移其数据。
- 新表通过幂等初始化兼容已存在的空间，不要用重置数据库代替升级。
- 上传与下载改动需保留加密上下文、长度校验和失败清理；不能只验证正常路径。
