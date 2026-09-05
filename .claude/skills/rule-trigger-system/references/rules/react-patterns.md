---
triggers:
  extensions: [".tsx"]
  keywords: ["component", "props", "hook", "React"]
  commands: ["/react", "/component"]
priority: 95
cacheable: true
version: "1.0.1"
---

# React 组件与 Hooks 模式规范

本规则定义了 React 函数组件和 Hooks 的最佳实践，确保组件的可维护性、可测试性和性能。

---

## 核心原则

### 1. 仅使用函数组件

**禁止**使用 Class Components，所有组件必须是函数组件。

```typescript
// ❌ 禁止: Class Component
class UserCard extends React.Component<UserProps, UserState> {
  render() {
    return <div>{this.props.name}</div>;
  }
}

// ✅ 正确: Function Component
function UserCard({ name, email }: UserProps) {
  return (
    <div>
      <h3>{name}</h3>
      <p>{email}</p>
    </div>
  );
}
```

### 2. Props 接口定义

每个组件必须定义明确的 Props 接口。

```typescript
// ✅ Props 接口定义规范
interface UserCardProps {
  // 必填属性
  id: string;
  name: string;
  
  // 可选属性
  avatarUrl?: string;
  email?: string;
  
  // 回调函数
  onEdit?: (id: string) => void;
  onDelete?: (id: string) => void;
  
  // 自定义样式
  className?: string;
  style?: React.CSSProperties;
}

// ✅ 组件实现
export function UserCard({
  id,
  name,
  avatarUrl,
  email,
  onEdit,
  onDelete,
  className,
  style
}: UserCardProps) {
  return (
    <Card className={className} style={style}>
      {avatarUrl && <Avatar src={avatarUrl} alt={name} />}
      <h3>{name}</h3>
      {email && <p>{email}</p>}
      <div className="actions">
        {onEdit && <Button onClick={() => onEdit(id)}>编辑</Button>}
        {onDelete && <Button onClick={() => onDelete(id)}>删除</Button>}
      </div>
    </Card>
  );
}
```

---

## Hooks 使用规范

### 1. Hooks 顺序规则

```typescript
// ✅ Hooks 调用顺序: 必须在组件顶层按固定顺序调用
function UserDashboard({ userId }: UserDashboardProps) {
  // 1. 状态 Hooks
  const [isLoading, setIsLoading] = useState(true);
  const [user, setUser] = useState<User | null>(null);
  const [error, setError] = useState<Error | null>(null);
  
  // 2. Ref Hooks
  const containerRef = useRef<HTMLDivElement>(null);
  const prevUserId = useRef<string>(userId);
  
  // 3. 派生状态 (useMemo)
  const userDisplayName = useMemo(() => {
    if (!user) return 'Guest';
    return user.nickname || user.fullName || user.email.split('@')[0];
  }, [user]);
  
  // 4. 回调函数 (useCallback)
  const handleRefresh = useCallback(async () => {
    setIsLoading(true);
    try {
      const data = await fetchUser(userId);
      setUser(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Unknown error'));
    } finally {
      setIsLoading(false);
    }
  }, [userId]);
  
  // 5. 副作用 (useEffect)
  useEffect(() => {
    handleRefresh();
  }, [handleRefresh]);
  
  // 监听 userId 变化
  useEffect(() => {
    if (prevUserId.current !== userId) {
      prevUserId.current = userId;
      handleRefresh();
    }
  }, [userId, handleRefresh]);
  
  // 6. 渲染
  return (
    <div ref={containerRef}>
      <h1>Welcome, {userDisplayName}</h1>
      {isLoading && <Spinner />}
      {error && <ErrorMessage error={error} onRetry={handleRefresh} />}
      {user && <UserCard user={user} />}
    </div>
  );
}
```

### 2. 常用 Hooks 模式

#### useState 模式

```typescript
// ✅ 状态分组
interface FormState {
  values: Record<string, string>;
  errors: Record<string, string>;
  touched: Record<string, boolean>;
  isSubmitting: boolean;
  isValid: boolean;
}

function useForm<T extends Record<string, string>>(initialValues: T) {
  const [state, setState] = useState<FormState>({
    values: initialValues,
    errors: {},
    touched: {},
    isSubmitting: false,
    isValid: true
  });
  
  const setValue = useCallback((name: keyof T, value: string) => {
    setState(prev => ({
      ...prev,
      values: { ...prev.values, [name]: value },
      touched: { ...prev.touched, [name]: true }
    }));
  }, []);
  
  return { ...state, setValue };
}
```

#### useEffect 模式

```typescript
// ✅ 数据获取模式
function useData<T>(url: string) {
  const [state, setState] = useState<{
    data: T | null;
    isLoading: boolean;
    error: Error | null;
  }>({
    data: null,
    isLoading: true,
    error: null
  });
  
  useEffect(() => {
    const abortController = new AbortController();
    
    setState(prev => ({ ...prev, isLoading: true }));
    
    fetch(url, { signal: abortController.signal })
      .then(res => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then(data => {
        setState({ data, isLoading: false, error: null });
      })
      .catch(error => {
        if (error.name === 'AbortError') return;
        setState({ data: null, isLoading: false, error });
      });
    
    return () => {
      abortController.abort();
    };
  }, [url]);
  
  return state;
}
```

#### useCallback 和 useMemo 模式

```typescript
// ✅ 性能优化模式
function DataTable<T extends { id: string }>({ 
  data, 
  columns,
  onRowClick 
}: DataTableProps<T>) {
  // 仅在 columns 变化时重新计算
  const columnDefs = useMemo(() => {
    return columns.map(col => ({
      ...col,
      sortable: col.sortable ?? true,
      width: col.width || 'auto'
    }));
  }, [columns]);
  
  // 缓存排序处理函数
  const handleSort = useCallback((columnKey: string) => {
    // 排序逻辑
  }, []);
  
  // 缓存行点击处理
  const handleRowClick = useCallback((item: T) => {
    onRowClick?.(item);
  }, [onRowClick]);
  
  return (
    <table>
      <thead>
        <tr>
          {columnDefs.map(col => (
            <th key={col.key} onClick={() => handleSort(col.key)}>
              {col.title}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {data.map(item => (
          <tr key={item.id} onClick={() => handleRowClick(item)}>
            {columnDefs.map(col => (
              <td key={col.key}>
                {col.render 
                  ? col.render(item[col.key as keyof T], item) 
                  : String(item[col.key as keyof T] ?? '')}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
```

---

## 组件组织规范

### 1. 文件结构

```
ComponentName/
├── index.ts              # 导出
├── ComponentName.tsx     # 主组件
├── ComponentName.hooks.ts # 自定义 hooks
├── ComponentName.utils.ts # 工具函数
├── ComponentName.types.ts # 类型定义
└── ComponentName.test.tsx # 测试文件
```

### 2. 代码组织顺序

```typescript
// 1. 导入
import React, { useState, useEffect, useCallback } from 'react';
import type { FC } from 'react';

// 2. 类型定义
interface ComponentProps {
  // ...
}

interface ComponentState {
  // ...
}

// 3. 常量定义
const DEFAULT_PAGE_SIZE = 10;
const DEBOUNCE_DELAY = 300;

// 4. 工具函数
const formatValue = (value: number): string => {
  return value.toLocaleString();
};

// 5. 自定义 Hooks
const useComponentData = (props: ComponentProps) => {
  // ...
};

// 6. 主组件
export const ComponentName: FC<ComponentProps> = (props) => {
  // 6.1 状态定义
  const [state, setState] = useState<ComponentState>({});
  
  // 6.2 Refs
  const containerRef = useRef<HTMLDivElement>(null);
  
  // 6.3 自定义 Hooks
  const { data, loading } = useComponentData(props);
  
  // 6.4 派生状态 (useMemo)
  const processedData = useMemo(() => {
    return data.map(/* ... */);
  }, [data]);
  
  // 6.5 回调函数 (useCallback)
  const handleClick = useCallback(() => {
    // ...
  }, []);
  
  // 6.6 副作用 (useEffect)
  useEffect(() => {
    // ...
  }, []);
  
  // 6.7 渲染
  return (
    <div ref={containerRef}>
      {/* ... */}
    </div>
  );
};

// 7. 导出
export type { ComponentProps };
export default ComponentName;
```

---

## 性能优化指南

### 1. 避免不必要的重渲染

```typescript
// ✅ 使用 React.memo 包装纯展示组件
const UserCard = React.memo<UserCardProps>(({ user, onSelect }) => {
  return (
    <div onClick={() => onSelect(user.id)}>
      <img src={user.avatar} alt={user.name} />
      <h4>{user.name}</h4>
    </div>
  );
}, (prevProps, nextProps) => {
  // 自定义比较函数
  return prevProps.user.id === nextProps.user.id;
});

// ✅ 使用 useMemo 缓存计算结果
const stats = useMemo(() => {
  return data.reduce((acc, item) => ({
    total: acc.total + item.value,
    count: acc.count + 1,
    avg: (acc.total + item.value) / (acc.count + 1)
  }), { total: 0, count: 0, avg: 0 });
}, [data]);

// ✅ 使用 useCallback 缓存事件处理函数
const handleSubmit = useCallback(async (values: FormValues) => {
  setSubmitting(true);
  try {
    await onSubmit(values);
    showSuccess('提交成功');
  } catch (error) {
    showError(error.message);
  } finally {
    setSubmitting(false);
  }
}, [onSubmit]);
```

### 2. 虚拟列表

```typescript
// ✅ 使用 react-window 或 react-virtualized 处理大量数据
import { FixedSizeList as List } from 'react-window';

interface VirtualListProps<T> {
  items: T[];
  itemHeight: number;
  renderItem: (item: T, index: number) => React.ReactNode;
}

function VirtualList<T extends { id: string }>({
  items,
  itemHeight,
  renderItem
}: VirtualListProps<T>) {
  const Row = useCallback(({ index, style }: ListChildComponentProps) => (
    <div style={style}>
      {renderItem(items[index], index)}
    </div>
  ), [items, renderItem]);

  return (
    <List
      height={600}
      itemCount={items.length}
      itemSize={itemHeight}
      width="100%"
    >
      {Row}
    </List>
  );
}
```

### 3. 代码分割和懒加载

```typescript
// ✅ 使用 React.lazy 和 Suspense 进行代码分割
const UserProfile = React.lazy(() => import('./UserProfile'));
const UserSettings = React.lazy(() => import('./UserSettings'));

function UserPage() {
  return (
    <div>
      <React.Suspense fallback={<LoadingSpinner />}>
        <Routes>
          <Route path="/profile" element={<UserProfile />} />
          <Route path="/settings" element={<UserSettings />} />
        </Routes>
      </React.Suspense>
    </div>
  );
}

// ✅ 使用预加载策略
function usePreloadComponent(importFn: () => Promise<{ default: React.ComponentType }>) {
  const preload = useCallback(() => {
    const link = document.createElement('link');
    link.rel = 'preload';
    link.as = 'script';
    link.href = importFn.toString().match(/import\(['"](.+?)['"]\)/)?.[1] || '';
    document.head.appendChild(link);
  }, [importFn]);
  
  return preload;
}
```

---

## 测试规范

### 1. 组件测试

```typescript
// ✅ 使用 React Testing Library 进行组件测试
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { UserCard } from './UserCard';

describe('UserCard', () => {
  const mockUser = {
    id: '1',
    name: 'John Doe',
    email: 'john@example.com',
    avatarUrl: 'https://example.com/avatar.jpg'
  };

  const mockOnSelect = jest.fn();
  const mockOnEdit = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders user information correctly', () => {
    render(<UserCard user={mockUser} onSelect={mockOnSelect} />);
    
    expect(screen.getByText(mockUser.name)).toBeInTheDocument();
    expect(screen.getByText(mockUser.email)).toBeInTheDocument();
    expect(screen.getByAltText(mockUser.name)).toHaveAttribute('src', mockUser.avatarUrl);
  });

  it('calls onSelect when clicked', async () => {
    render(<UserCard user={mockUser} onSelect={mockOnSelect} />);
    
    await userEvent.click(screen.getByTestId('user-card'));
    
    expect(mockOnSelect).toHaveBeenCalledTimes(1);
    expect(mockOnSelect).toHaveBeenCalledWith(mockUser.id);
  });

  it('renders without optional props', () => {
    const userWithoutOptional = {
      id: '2',
      name: 'Jane Doe',
      email: 'jane@example.com'
    };
    
    render(<UserCard user={userWithoutOptional} />);
    
    expect(screen.getByText(userWithoutOptional.name)).toBeInTheDocument();
    // Avatar should not be rendered when avatarUrl is not provided
    expect(screen.queryByAltText(userWithoutOptional.name)).not.toBeInTheDocument();
  });
});
```

### 2. Hooks 测试

```typescript
// ✅ 使用 @testing-library/react 测试自定义 Hooks（renderHook 已迁移到主包）
import { renderHook, act } from '@testing-library/react';
import { useCounter } from './useCounter';

describe('useCounter', () => {
  it('initializes with default value', () => {
    const { result } = renderHook(() => useCounter());
    
    expect(result.current.count).toBe(0);
  });

  it('initializes with provided value', () => {
    const { result } = renderHook(() => useCounter(10));
    
    expect(result.current.count).toBe(10);
  });

  it('increments count', () => {
    const { result } = renderHook(() => useCounter());
    
    act(() => {
      result.current.increment();
    });
    
    expect(result.current.count).toBe(1);
  });

  it('decrements count', () => {
    const { result } = renderHook(() => useCounter(5));
    
    act(() => {
      result.current.decrement();
    });
    
    expect(result.current.count).toBe(4);
  });

  it('resets to initial value', () => {
    const { result } = renderHook(() => useCounter(10));
    
    act(() => {
      result.current.increment();
      result.current.increment();
    });
    
    expect(result.current.count).toBe(12);
    
    act(() => {
      result.current.reset();
    });
    
    expect(result.current.count).toBe(10);
  });
});
```

---

## 版本控制

- **v1.0.0** (2026-03-17): 初始版本
  - 函数组件规范
  - Hooks 使用规范
  - 性能优化指南
  - 测试规范

---

**规则版本**: 1.0.0  
**最后更新**: 2026-03-17  
**适用**: React 18+, TypeScript 5.0+
