# Frontend H5 / Mobile Web Template

Additions on top of `template-frontend-web.md` for H5 / mobile web projects (viewport-adapted, WeChat / Alipay / mobile browser targets).

---

## Core philosophy additions

- **移动端 H5 专项能力**
  - 使用 viewport 适配方案（项目通常配 `postcss-px-to-viewport`），CSS 中写 px，构建时换 vw
  - 理解 1px 边框、高清屏（DPR）、安全区（iPhone X 刘海 / 底部 Home Bar）等移动端特性
  - Touch 事件处理与点击延迟（300ms）规避（FastClick / touch-action）

- **容器环境感知**
  - 微信 / 支付宝 / 飞书 / 手机浏览器，UA 不同、JSBridge 不同
  - 分享、授权、支付、扫码、定位等能力通过容器 SDK 调用，禁止假设 W3C API
  - 弱网 / 离线场景需有降级（Skeleton + 重试 + 缓存）

---

## Red-line additions

```markdown
#### 移动端适配（强制）
- 样式单位：CSS 中统一使用 px（由 `postcss-px-to-viewport` 转换为 vw）；
  禁止手写 vw / rem / em，除非注释说明无法用 px 表达的场景
- 安全区：底部固定按钮 / Tab 必须使用 `env(safe-area-inset-bottom)`
- 1px 边框：使用项目封装的 hairline 类，禁止直接 `border: 1px solid` 在高 DPR 屏上失真
```

```markdown
#### 导航栏使用约定（NavHeader 类组件）
- 项目使用 {{NavHeader 路径，例：src/components/NavHeader/NavHeader.tsx}}
- 微信环境下自动隐藏，无需在页面内额外判断
- 页面根节点必须添加 `data-nav-header` 属性，由全局样式处理顶部占位；
  禁止在页面样式中手动加 `padding-top` 解决导航栏遮挡 — 重复实现导致样式漂移
- 不同页面可调整 `title` / `textColor` / `borderColor`，但禁止派生出多个导航组件
```

(Only include if the project actually has a NavHeader-equivalent. Otherwise drop.)

---

## Section: H5 容器适配

```markdown
### 容器判断与桥接

| 容器 | UA 关键字 | JSBridge / SDK |
|------|----------|---------------|
| 微信 | `MicroMessenger` | `wx.ready` / JSSDK |
| 支付宝 | `AlipayClient` | `ap.ready` / my.* |
| 飞书 / 钉钉 | `Lark` / `DingTalk` | 各自 SDK |
| 普通浏览器 | 无 | W3C API |

- 容器检测统一通过 `{{src/utils/env.ts}}` 中的 `isWechat()` / `isAlipay()`；
  禁止散落 `navigator.userAgent.includes(...)` 判断
- 容器 API 调用必须 try/catch 并提供降级路径
```

```markdown
### 分享 / 授权 / 支付
- 分享：通过 `{{share util}}`，参数包括 title / desc / link / imgUrl
- 授权：在容器 SDK ready 之后再调用，处理用户拒绝授权的回退
- 支付：调用前确认订单号已生成；回调 success / fail / cancel 三态都要处理
```

---

## Section: 性能与弱网

Add to review checklist:

- 图片是否压缩 + 懒加载？是否提供 WebP 兜底？
- 首屏接口是否合并 / 并行？是否有骨架屏？
- 关键资源是否预加载？体积是否在 H5 首屏预算内（建议 < 200KB gzip）？
- 弱网 / 离线时是否有降级 UI？接口失败是否有重试 + 用户可手动重试？

---

## Section: 调试与远程定位

```markdown
### 调试约定
- 开发期使用 vConsole / Eruda，构建时通过环境变量剔除
- 真机调试通过 {{微信开发者工具 / 抓包工具 / 远程调试方案}}
- 生产环境错误上报使用 {{Sentry / 自建}}，包含容器 UA、页面 URL、用户 ID
```
