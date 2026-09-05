---
triggers:
  extensions: []
  keywords: ["performance", "optimize", "bundle", "lazy", "memo", "useMemo", "useCallback", "React.memo", "virtual", "virtualize", "split", "chunk", "cache", "debounce", "throttle", "profiler"]
  commands: ["/perf", "/optimize"]
priority: 80
cacheable: true
version: "1.0.1"
---

# 性能优化规范

本规则定义了 React + TypeScript 项目的性能优化策略，涵盖渲染优化、打包优化和运行时优化。

## 核心优化原则

### 1. 渲染优化 - 合理使用 Memo

```typescript
// ✅ React.memo 适用于：Props 不频繁变化的纯展示组件
interface UserCardProps {
  user: { id: string; name: string; avatar: string };
  onSelect: (id: string) => void;
}

// 搭配自定义比较函数，精确控制何时重渲染
const UserCard = React.memo<UserCardProps>(
  ({ user, onSelect }) => {
    return (
      <div onClick={() => onSelect(user.id)}>
        <img src={user.avatar} alt={user.name} />
        <span>{user.name}</span>
      </div>
    );
  },
  // 只有 id 或 name 变化时才重渲染，avatar 的微小变化不触发
  (prev, next) => prev.user.id === next.user.id && prev.user.name === next.user.name
);
```

### 2. useMemo 和 useCallback 的正确使用

```typescript
// useMemo 用于：计算代价高的派生数据
const filteredAndSortedUsers = useMemo(() => {
  // 只有当 users 或 searchQuery 变化时才重新计算
  return users
    .filter(user => user.name.toLowerCase().includes(searchQuery.toLowerCase()))
    .sort((a, b) => a.name.localeCompare(b.name));
}, [users, searchQuery]);

// useCallback 用于：传递给子组件的回调（防止子组件不必要的重渲染）
const handleUserSelect = useCallback((userId: string) => {
  setSelectedId(userId);
  onSelect?.(userId);
}, [onSelect]); // 注意：onSelect 必须也是稳定的引用

// ❌ 不必要的 useMemo/useCallback（过度优化）
// 简单计算不需要 memo
const fullName = useMemo(() => `${firstName} ${lastName}`, [firstName, lastName]);
// 改为：
const fullName = `${firstName} ${lastName}`;
```

### 3. 代码分割与懒加载

```typescript
import { lazy, Suspense } from 'react';

// ✅ 路由级别懒加载（最有效的分割策略）
const HelpCenter = lazy(() => import('../pages/HelpCenter'));
const UserAgreement = lazy(() => import('../pages/UserAgreement'));

// ✅ 搭配合适的 Loading 状态
function AppRoutes() {
  return (
    <Suspense fallback={<PageLoadingSpinner />}>
      <Routes>
        <Route path="/help" element={<HelpCenter />} />
        <Route path="/agreement" element={<UserAgreement />} />
      </Routes>
    </Suspense>
  );
}

// ✅ 组件级懒加载（大型弹窗、重型组件）
const HeavyChart = lazy(() =>
  import('../components/HeavyChart').then(module => ({
    default: module.HeavyChart,
  }))
);
```

### 4. 列表虚拟化

```typescript
// 当列表超过 100 条时，考虑虚拟化渲染
import { useVirtualizer } from '@tanstack/react-virtual';

function VirtualList<T>({
  items,
  estimatedItemHeight = 60,
  renderItem,
}: {
  items: T[];
  estimatedItemHeight?: number;
  renderItem: (item: T, index: number) => React.ReactNode;
}) {
  const parentRef = useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => estimatedItemHeight,
    overscan: 5, // 预渲染屏幕外 5 条，减少滚动白屏
  });

  return (
    <div ref={parentRef} style={{ height: '100%', overflow: 'auto' }}>
      <div style={{ height: virtualizer.getTotalSize() }}>
        {virtualizer.getVirtualItems().map((virtualRow) => (
          <div
            key={virtualRow.index}
            style={{
              position: 'absolute',
              top: virtualRow.start,
              left: 0,
              right: 0,
              height: virtualRow.size,
            }}
          >
            {renderItem(items[virtualRow.index], virtualRow.index)}
          </div>
        ))}
      </div>
    </div>
  );
}
```

### 5. 防抖与节流

```typescript
import { useState, useEffect, useRef, useCallback } from 'react';

// ✅ 搜索输入防抖（避免每次按键都发请求）
function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedValue(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);

  return debouncedValue;
}

// 使用方式
function SearchInput({ onSearch }: { onSearch: (query: string) => void }) {
  const [query, setQuery] = useState('');
  const debouncedQuery = useDebounce(query, 300);

  useEffect(() => {
    if (debouncedQuery) onSearch(debouncedQuery);
  }, [debouncedQuery, onSearch]);

  return <input value={query} onChange={(e) => setQuery(e.target.value)} />;
}

// ✅ 滚动事件节流（避免高频回调卡顿）
function useThrottle<T extends (...args: unknown[]) => void>(
  fn: T,
  interval: number
): T {
  const lastCall = useRef(0);

  return useCallback((...args: Parameters<T>) => {
    const now = Date.now();
    if (now - lastCall.current >= interval) {
      lastCall.current = now;
      fn(...args);
    }
  }, [fn, interval]) as T;
}
```

### 6. Vite 打包优化

```typescript
// vite.config.ts - 生产环境优化配置
import { defineConfig } from 'vite';
import { visualizer } from 'rollup-plugin-visualizer';

export default defineConfig({
  build: {
    rollupOptions: {
      output: {
        // 手动分包：将大型第三方库单独打包，利用浏览器缓存
        manualChunks: {
          'vendor-react': ['react', 'react-dom', 'react-router-dom'],
          'vendor-ui': ['antd-mobile'],
          'vendor-utils': ['axios', 'dayjs', 'lodash-es'],
        },
      },
    },
    // 启用 CSS 代码分割
    cssCodeSplit: true,
    // 压缩选项
    minify: 'esbuild',
    // 超过 500KB 的 chunk 发出警告
    chunkSizeWarningLimit: 500,
  },
  plugins: [
    // 打包分析（仅在 analyze 模式下启用）
    process.env.ANALYZE && visualizer({
      open: true,
      gzipSize: true,
      brotliSize: true,
    }),
  ].filter(Boolean),
});
```

## 性能优化决策树

```
遇到性能问题？
├── 渲染卡顿
│   ├── 组件频繁重渲染 → React.memo + useCallback
│   ├── 计算逻辑重 → useMemo
│   └── 长列表 → 虚拟化（@tanstack/react-virtual）
├── 网络请求慢
│   ├── 请求频繁 → 防抖/节流
│   ├── 数据重复请求 → SWR/React Query 缓存
│   └── 资源大 → 图片懒加载 + CDN
└── 首屏加载慢
    ├── Bundle 太大 → 代码分割 + 懒加载
    ├── 第三方库大 → 按需引入 + 手动分包
    └── 分析工具 → vite build --analyze
```

---

**规则版本**: 1.0.0
**最后更新**: 2026-03-17
**适用**: React 18 + Vite 5
