# Mobile Native Template

For React Native, Flutter, SwiftUI, Kotlin/Android, Expo. Picks up frontend-web philosophy but adds platform-specific rules.

---

## Core philosophy additions

- **平台差异感知**
  - iOS / Android 行为差异：键盘、安全区、返回手势、权限模型
  - 同一组件在两平台的表现要主动验证，禁止假设一致
  - 平台特定代码使用 `Platform.OS` / `if (Platform.isIOS)` 显式分支，注释说明原因

- **原生能力边界**
  - 相机、定位、通知、文件等系统能力使用平台 SDK 包装层
  - 权限请求必须有理由文案（iOS Info.plist / Android Manifest）
  - 后台运行、电量、内存约束远比 Web 严格

- **离线与状态**
  - 默认假设网络不可靠，关键操作必须支持离线缓存 + 同步
  - App 切换前后台时的状态保存与恢复

---

## Red-line additions

```markdown
#### 平台与构建（强制）
- {{RN / Expo / Flutter}} 版本：{{version}}，升级走单独 PR + 全量回归
- 原生依赖（pods / gradle）变更必须同步更新 lockfile，禁止只改 package.json
- 调试构建禁止合入生产 — `__DEV__` / `kReleaseMode` 边界明确

#### 性能与资源
- 列表必须使用 {{FlatList / SectionList / ListView.builder}}，禁止 map 渲染长列表
- 图片：远程图使用 {{FastImage / cached_network_image}}，本地图按需引用避免全量打包
- 动画优先使用原生驱动（`useNativeDriver: true` / Flutter 内置 Animation）

#### 安全与隐私（强制）
- 敏感数据（Token / 用户信息）使用 {{Keychain / Keystore / SecureStorage}}，
  禁止 AsyncStorage / SharedPreferences 明文存储
- 网络请求强制 HTTPS，证书 pinning 在生产开启
- 应用截图防护、剪贴板敏感内容清理按合规要求开启
```

---

## Section: 目录结构

```markdown
src/
├── screens/             # 页面（按业务域聚合）
├── components/          # 跨页面公共组件
├── navigation/          # 路由 / 导航栈
├── services/            # 接口 / 业务服务
├── store/ (或 contexts/) # 状态管理
├── hooks/
├── utils/
├── assets/              # 图片 / 字体 / 多语言
└── native/              # 平台特定原生模块（如有）
```

---

## Section: 导航与生命周期

```markdown
### 导航
- 统一使用 {{React Navigation / Flutter Navigator 2.0}}
- 路由参数类型必须声明，禁止 `params: any`
- 深链路 / Universal Link 配置在 {{config 文件}}，禁止散落

### 生命周期
- 屏幕聚焦 / 失焦：使用 `useFocusEffect` / `didChangeAppLifecycleState`
- App 前后台：通过 `AppState` / `WidgetsBindingObserver` 统一监听
- 进入后台时停止非必要轮询 / 动画，避免耗电与崩溃
```

---

## Section: 多语言与主题

```markdown
### 多语言
- 文案统一放在 `{{src/locales/}}`，按语言文件拆分
- 禁止组件内硬编码中文 / 英文文案
- 复数 / 性别 / 占位符使用 ICU 格式

### 主题
- 颜色 / 字号 / 间距通过 design token 管理
- 暗色模式：跟随系统 + 应用内手动切换，组件样式使用 token 引用
```

---

## Section: 审查关注点

### 架构
- 是否区分了"展示组件 / 容器组件"？业务逻辑是否在 Hook / Service？
- 跨平台差异是否被隔离？

### 性能
- 列表性能（FPS、滑动卡顿）？
- 启动时间？冷启动是否过重？
- 内存：图片是否释放？大对象是否泄漏？

### 体验
- 网络异常 / 离线 / 权限拒绝是否有兜底 UI？
- 键盘弹起遮挡？输入回弹？
- 横竖屏切换是否处理？
