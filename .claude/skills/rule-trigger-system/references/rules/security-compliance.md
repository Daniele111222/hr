---
triggers:
  extensions: []
  keywords: ["api", "auth", "security", "token", "encrypt"]
  commands: ["/security", "/audit"]
priority: 100
cacheable: true
version: "1.0.1"
---

# API 安全与合规规范

本规则定义了在调用接口、处理认证和安全加固时必须遵守的规范，防止常见的安全漏洞。

## 核心安全原则

### 1. HTTP 请求封装

```typescript
// ✅ 使用统一的请求封装，集中处理认证和错误
import axios, { AxiosInstance, AxiosRequestConfig, AxiosResponse } from 'axios';

interface RequestConfig extends AxiosRequestConfig {
  skipAuth?: boolean;
  retryCount?: number;
}

interface ApiError {
  code: string;
  message: string;
  statusCode: number;
}

class HttpClient {
  private instance: AxiosInstance;

  constructor(baseURL: string) {
    this.instance = axios.create({
      baseURL,
      timeout: 10000,
      headers: {
        'Content-Type': 'application/json',
      },
    });

    this.setupInterceptors();
  }

  private setupInterceptors(): void {
    // 请求拦截：自动注入 Token
    this.instance.interceptors.request.use(
      (config) => {
        // 从安全存储中获取 token（不从 localStorage 直接取）
        const token = tokenStore.getAccessToken();
        if (token && !config.skipAuth) {
          config.headers.Authorization = `Bearer ${token}`;
        }
        return config;
      },
      (error) => Promise.reject(error)
    );

    // 响应拦截：统一错误处理
    this.instance.interceptors.response.use(
      (response) => response,
      async (error) => {
        if (error.response?.status === 401) {
          // Token 过期，尝试刷新
          await this.refreshToken();
          return this.instance.request(error.config);
        }
        return Promise.reject(this.normalizeError(error));
      }
    );
  }

  private normalizeError(error: unknown): ApiError {
    if (axios.isAxiosError(error)) {
      return {
        code: error.response?.data?.code ?? 'UNKNOWN',
        message: error.response?.data?.message ?? error.message,
        statusCode: error.response?.status ?? 0,
      };
    }
    return { code: 'UNKNOWN', message: String(error), statusCode: 0 };
  }
}
```

### 2. JWT Token 安全处理

```typescript
// ❌ 禁止将 Token 存储在 localStorage（容易被 XSS 攻击）
localStorage.setItem('token', jwtToken);

// ✅ 推荐方案 1：使用 httpOnly Cookie（由服务端设置）
// 服务端设置 Set-Cookie: token=xxx; HttpOnly; Secure; SameSite=Strict

// ✅ 推荐方案 2：使用内存存储 + Refresh Token 轮转
class TokenStore {
  private accessToken: string | null = null;

  getAccessToken(): string | null {
    return this.accessToken;
  }

  setAccessToken(token: string): void {
    // 验证 token 格式
    if (!this.isValidJWT(token)) {
      throw new Error('Invalid JWT format');
    }
    this.accessToken = token;
  }

  clearTokens(): void {
    this.accessToken = null;
  }

  private isValidJWT(token: string): boolean {
    const parts = token.split('.');
    return parts.length === 3;
  }
}

export const tokenStore = new TokenStore();
```

### 3. XSS 防护

```typescript
// ❌ 禁止直接使用用户输入渲染 HTML
const dangerousHTML = `<div>${userInput}</div>`;
element.innerHTML = dangerousHTML;

// ✅ 使用 React 的自动转义（JSX 默认安全）
const SafeComponent: React.FC<{ content: string }> = ({ content }) => (
  <div>{content}</div>  // React 自动转义
);

// ✅ 如果必须渲染 HTML，使用净化库
import DOMPurify from 'dompurify';

const SanitizedContent: React.FC<{ html: string }> = ({ html }) => (
  <div
    dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(html) }}
  />
);
```

### 4. 输入验证

```typescript
// ✅ 始终验证和净化用户输入
import { z } from 'zod';

const UserInputSchema = z.object({
  email: z.string().email('请输入有效的邮箱地址'),
  password: z.string()
    .min(8, '密码至少8位')
    .regex(/[A-Z]/, '必须包含大写字母')
    .regex(/[0-9]/, '必须包含数字'),
  age: z.number().int().min(0).max(120),
});

type UserInput = z.infer<typeof UserInputSchema>;

async function validateAndProcess(rawInput: unknown): Promise<UserInput> {
  const result = UserInputSchema.safeParse(rawInput);
  if (!result.success) {
    throw new ValidationError(result.error.issues);
  }
  return result.data;
}
```

### 5. CSRF 防护

```typescript
// ✅ 为状态变更请求附加 CSRF Token
const csrfToken = document.querySelector<HTMLMetaElement>(
  'meta[name="csrf-token"]'
)?.content;

await httpClient.post('/api/user/update', data, {
  headers: {
    'X-CSRF-Token': csrfToken,
  },
});
```

## 常见漏洞检查清单

| 漏洞类型 | 检查点 |
|---------|--------|
| XSS | 是否使用 `innerHTML` 直接渲染用户输入 |
| CSRF | 状态变更请求是否携带 CSRF Token |
| SQL 注入 | 是否使用参数化查询（前端场景较少，BFF 层注意）|
| Token 泄露 | Token 是否存储在 localStorage/URL 中 |
| 敏感数据 | 是否在日志/错误信息中暴露密码/密钥 |
| HTTPS | 生产环境是否强制使用 HTTPS |

---

**规则版本**: 1.0.0
**最后更新**: 2026-03-17
**适用**: Web 安全最佳实践
