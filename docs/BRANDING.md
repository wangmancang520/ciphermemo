# 品牌与 Logo

[返回项目首页](../README.md)

## 设计概念

CipherMemo 的标识由**折角纸页与钥孔**组成：纸页对应记录、文件与备忘录；钥孔对应私人保存。背景沿用界面青绿色，折角使用浅薄荷色，建立与现有产品配色的联系。

标识不依赖文字，在登录页、侧栏、登录过渡与 favicon 中使用同一套几何图形。全部核心资源为 SVG，可清晰缩放。

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="../public/brand/ciphermemo-wordmark-dark.svg">
  <img src="../public/brand/ciphermemo-wordmark-light.svg" alt="CipherMemo Logo 与字标" width="420">
</picture>

## 资源清单

| 资源     | 位置                                                                             | 用途                                    |
| -------- | -------------------------------------------------------------------------------- | --------------------------------------- |
| 主标识   | [`ciphermemo-mark.svg`](../public/brand/ciphermemo-mark.svg)                     | 应用图标、品牌入口、展示图              |
| 浅色字标 | [`ciphermemo-wordmark-light.svg`](../public/brand/ciphermemo-wordmark-light.svg) | 浅色背景的完整品牌展示                  |
| 深色字标 | [`ciphermemo-wordmark-dark.svg`](../public/brand/ciphermemo-wordmark-dark.svg)   | 深色背景的完整品牌展示                  |
| 浅色横幅 | [`readme-hero-light.svg`](../public/brand/readme-hero-light.svg)                 | README 首屏                             |
| 深色横幅 | [`readme-hero-dark.svg`](../public/brand/readme-hero-dark.svg)                   | README 深色主题首屏                     |
| 网站图标 | [`favicon.svg`](../public/favicon.svg)                                           | 与主标识内容保持一致，兼容原有图标路径  |
| 应用组件 | [`Brand.tsx`](../src/client/Brand.tsx)                                           | 统一引用标识，避免在页面中重画独立 Logo |

## 颜色与尺寸

| 角色       | 色值                       |
| ---------- | -------------------------- |
| 标识浅色   | `#53A99A`                  |
| 标识深色   | `#287E79`                  |
| 折角薄荷   | `#A9DBCA`                  |
| 界面强调色 | `#2F7A70` / 夜间 `#6DB0A5` |
| 界面文字   | `#1D1F21` / 夜间 `#E7E8E9` |

界面以中性灰为底，只用一种青绿强调色；分类颜色仅用于小图标。

主标识画布为 **96 × 96**，保持正方形比例。常用显示尺寸：favicon 16–32px、侧栏与登录页顶栏 26px、登录过渡 90px。周围保留至少约标识宽度四分之一的留白。

不要拉伸、旋转正式应用中的主标识，或给同一图标叠加第二个不匹配的圆角底板。字标按背景选择深浅色版本。应用中的通用锁定、密码或权限图标仍用于操作语义，不全部替换为品牌 Logo。

## 维护方式

1. 修改主标识时，同步更新 favicon、两种字标和 README 横幅中使用的标识几何。
2. 应用只通过 `Brand` / `LogoMark` 组件展示品牌，保持所有入口一致。
3. 检查 16px 小尺寸、登录过渡的大尺寸，以及浅色和夜间背景。
4. 重新生成文档截图；截图仅使用演示内容，不包含真实账号、密码、恢复密钥或私人文件。

`Powered by GPT-6.1 Sol` 是项目的 AI 生成与辅助开发署名，保留在 README、登录页底部与设置弹窗；不表示第三方官方背书。
