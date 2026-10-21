# 参与贡献

感谢你帮助改进 CipherMemo。请先阅读[项目首页](README.md)、[开发指南](docs/DEVELOPMENT.md)和[安全设计](docs/SECURITY.md)，了解单账号空间的产品范围与数据兼容约束。

## 报告问题

在 [Issues](https://github.com/wangmancang520/ciphermemo/issues) 中说明：

- 预期行为、实际行为与最小复现步骤。
- 浏览器、操作系统、项目提交或版本。
- 是否使用 HTTPS；本地问题注明 Wrangler / Vite 入口。
- 已脱敏的截图或错误信息。

不要提供密码、恢复密钥、初始化口令、Cookie、空间备份或私人文件。可能涉及安全的问题请阅读 [SECURITY.md](SECURITY.md)。

## 提交代码

1. 从需要修改的版本创建自己的分支，先阅读相关实现和测试。
2. 保持变更聚焦；数据和协议调整需兼容已初始化的空间。
3. 为有行为变化的功能添加必要验证；UI 检查桌面 / 手机、深浅色和中英文。
4. 更新相关文档，运行适合该变更的检查。

```sh
npm run build
npm test
npx wrangler deploy --dry-run
```

Pull Request 描述应说明具体问题、变更后的行为、验证结果和影响。涉及图片或布局时使用演示数据截图；涉及数据结构时说明如何兼容现有空间。

格式遵循仓库现有 Prettier 配置。文档和品牌资源也需检查相对链接、SVG 显示和移动端比例。
