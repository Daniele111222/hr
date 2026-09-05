---
triggers:
  extensions: [".ts", ".tsx"]
  keywords: ["interface", "type", "enum"]
  commands: ["/ts"]
priority: 90
cacheable: true
version: "1.0.1"
---

# TypeScript 严格类型规范

本规则定义了在使用 TypeScript 时必须遵守的严格类型规范，确保代码的类型安全性和可维护性。

## 核心原则

### 1. 禁止使用 any

**错误示例**:
```typescript
// ❌ 禁止使用 any
function processData(data: any): any {
  return data.value;
}

// ❌ 禁止使用 any 类型的数组
const items: any[] = fetchData();
```

**正确示例**:
```typescript
// ✅ 使用明确的接口定义
interface DataItem {
  value: string;
  timestamp: number;
}

function processData(data: DataItem): string {
  return data.value;
}

// ✅ 使用泛型处理未知类型
function fetchData<T>(): Promise<T[]> {
  return api.get<T[]>('/data');
}
```

### 2. 必须定义明确的 Interface/Type

**接口定义规范**:

```typescript
// ✅ 使用 PascalCase 命名接口
interface UserProfile {
  // 必须标注 readonly 对于不可变属性
  readonly id: string;
  readonly createdAt: Date;
  
  // 可选属性使用 ? 标记
  displayName?: string;
  avatarUrl?: string;
  
  // 复杂类型使用明确的嵌套接口
  preferences: UserPreferences;
  
  // 函数类型的属性
  onUpdate?: (profile: UserProfile) => void;
}

interface UserPreferences {
  theme: 'light' | 'dark' | 'system';
  language: string;
  notifications: boolean;
}
```

### 3. 泛型使用规范

```typescript
// ✅ 使用有意义的泛型参数名
interface ApiResponse<TData, TError = ApiError> {
  success: boolean;
  data?: TData;
  error?: TError;
  meta?: ResponseMeta;
}

// ✅ 约束泛型参数
function sortBy<T extends { [K in keyof T]: T[K] }>(
  items: T[],
  key: keyof T,
  direction: 'asc' | 'desc' = 'asc'
): T[] {
  return [...items].sort((a, b) => {
    const aVal = a[key];
    const bVal = b[key];
    const comparison = aVal < bVal ? -1 : aVal > bVal ? 1 : 0;
    return direction === 'asc' ? comparison : -comparison;
  });
}

// ✅ 使用泛型工具类型
function processArray<T, R>(
  items: T[],
  processor: (item: T, index: number) => R
): R[] {
  return items.map(processor);
}
```

### 4. 严格模式配置

```typescript
// tsconfig.json 推荐配置
{
  "compilerOptions": {
    "strict": true,
    "noImplicitAny": true,
    "strictNullChecks": true,
    "strictFunctionTypes": true,
    "strictBindCallApply": true,
    "strictPropertyInitialization": true,
    "noImplicitThis": true,
    "alwaysStrict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noImplicitReturns": true,
    "noFallthroughCasesInSwitch": true,
    "exactOptionalPropertyTypes": true,
    "noUncheckedIndexedAccess": true
  }
}
```

## 类型定义最佳实践

### 1. 使用联合类型替代枚举

```typescript
// ❌ 不推荐：使用 enum
enum Status {
  Pending = 'pending',
  Active = 'active',
  Inactive = 'inactive'
}

// ✅ 推荐：使用联合类型
type Status = 'pending' | 'active' | 'inactive';

const STATUS_CONFIG = {
  pending: { label: '待处理', color: '#faad14' },
  active: { label: '激活', color: '#52c41a' },
  inactive: { label: '停用', color: '#bfbfbf' }
} as const;
```

### 2. 使用映射类型和条件类型

```typescript
// ✅ 使用映射类型生成变体
type Readonly<T> = {
  readonly [K in keyof T]: T[K];
};

type Optional<T> = {
  [K in keyof T]?: T[K];
};

type Nullable<T> = {
  [K in keyof T]: T[K] | null;
};

// ✅ 使用条件类型

type IsArray<T> = T extends (infer U)[] ? true : false;

type ElementType<T> = T extends (infer U)[] ? U : T;

type NonNullable<T> = T extends null | undefined ? never : T;

// ✅ 组合类型工具
type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K];
};

type DeepReadonly<T> = {
  readonly [K in keyof T]: T[K] extends object ? DeepReadonly<T[K]> : T[K];
};
```

### 3. 类型守卫和类型断言

```typescript
// ✅ 使用类型守卫函数
function isString(value: unknown): value is string {
  return typeof value === 'string';
}

function isNumber(value: unknown): value is number {
  return typeof value === 'number' && !isNaN(value);
}

function isArray<T>(value: unknown): value is T[] {
  return Array.isArray(value);
}

interface ErrorResponse {
  error: {
    message: string;
    code: number;
  };
}

interface SuccessResponse<T> {
  data: T;
  meta: ResponseMeta;
}

// ✅ 使用自定义类型守卫
type ApiResponse<T> = SuccessResponse<T> | ErrorResponse;

function isErrorResponse<T>(
  response: ApiResponse<T>
): response is ErrorResponse {
  return 'error' in response;
}

function isSuccessResponse<T>(
  response: ApiResponse<T>
): response is SuccessResponse<T> {
  return 'data' in response;
}

// 使用示例
async function handleApiResponse<T>(
  response: ApiResponse<T>
): Promise<T> {
  if (isErrorResponse(response)) {
    throw new Error(response.error.message);
  }
  return response.data;
}

// ✅ 谨慎使用类型断言
// 只有在确信类型时才使用 as
const canvas = document.getElementById('canvas') as HTMLCanvasElement;

// ✅ 使用双重断言处理复杂类型转换
// 从 unknown 开始逐步断言更安全
const value = fetchData() as unknown as { id: number; name: string };
```

---

## 常见错误和解决方案

| 错误场景 | 解决方案 |
|---------|---------|
| `any` 类型传播 | 使用 `unknown` 替代，然后逐步缩小类型范围 |
| 可选属性访问报错 | 使用可选链 `?.` 或类型守卫 |
| 联合类型无法访问属性 | 使用类型守卫收窄类型 |
| 泛型约束不足 | 使用 `extends` 关键字添加约束 |
| 循环依赖报错 | 使用 `type` 替代 `interface`，或重构代码结构 |

---

## 迁移检查清单

从 JavaScript 迁移到 TypeScript 时：

- [ ] 启用 `strict: true`
- [ ] 为所有函数参数和返回值添加类型注解
- [ ] 用 `interface` 或 `type` 定义所有对象结构
- [ ] 用联合类型（或 const 对象）定义有限集合，优先避免使用 enum
- [ ] 添加 `noImplicitAny` 确保没有隐式 any
- [ ] 为第三方库安装类型定义 (`@types/*`)
- [ ] 配置路径别名和模块解析

---

**规则版本**: 1.0.0  
**最后更新**: 2026-03-17  
**适用**: TypeScript 5.0+
