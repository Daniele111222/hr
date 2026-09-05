---
triggers:
  extensions: [".test.ts", ".test.tsx", ".spec.ts", ".spec.tsx"]
  keywords: ["test", "spec", "vitest", "jest", "coverage", "mock", "assert", "describe", "it", "expect"]
  commands: ["/test", "/spec"]
priority: 85
cacheable: true
version: "1.0.0"
---

# 测试策略规范

本规则定义了单元测试、集成测试和 E2E 测试的最佳实践，确保代码质量和可维护性。

---

## 测试金字塔

```
      /\
     /  \
    / E2E \    <- 少量，关键用户流程
   /--------\
  / 集成测试 \  <- 中等，API 和组件组合
 /------------\
/   单元测试    \ <- 大量，函数和组件
----------------
```

### 测试比例建议
- **单元测试**: 70%
- **集成测试**: 20%
- **E2E 测试**: 10%

---

## 单元测试规范

### 1. 测试文件结构

```typescript
// 被测试文件: utils/calculator.ts
export function add(a: number, b: number): number {
  return a + b;
}

export function divide(a: number, b: number): number {
  if (b === 0) {
    throw new Error('Cannot divide by zero');
  }
  return a / b;
}
```

```typescript
// 测试文件: utils/calculator.test.ts
import { describe, it, expect } from 'vitest';
import { add, divide } from './calculator';

describe('calculator', () => {
  describe('add', () => {
    it('should add two positive numbers', () => {
      // Arrange
      const a = 1;
      const b = 2;
      
      // Act
      const result = add(a, b);
      
      // Assert
      expect(result).toBe(3);
    });
    
    it('should handle negative numbers', () => {
      expect(add(-1, -2)).toBe(-3);
    });
    
    it('should handle zero', () => {
      expect(add(0, 5)).toBe(5);
      expect(add(5, 0)).toBe(5);
    });
  });
  
  describe('divide', () => {
    it('should divide two numbers', () => {
      expect(divide(10, 2)).toBe(5);
    });
    
    it('should throw error when dividing by zero', () => {
      expect(() => divide(10, 0)).toThrow('Cannot divide by zero');
    });
  });
});
```

### 2. AAA 模式 (Arrange-Act-Assert)

```typescript
// ✅ 使用 AAA 模式组织测试
it('should update user profile successfully', async () => {
  // Arrange: 设置测试数据和依赖
  const userId = 'user-123';
  const updates = { name: 'John Doe', email: 'john@example.com' };
  const mockApi = vi.fn().mockResolvedValue({ id: userId, ...updates });
  
  // Act: 执行被测试的操作
  const result = await updateUserProfile(userId, updates, mockApi);
  
  // Assert: 验证结果
  expect(mockApi).toHaveBeenCalledWith(`/users/${userId}`, updates);
  expect(result).toEqual({ id: userId, ...updates });
});
```

### 3. Mock 和 Stub 使用

```typescript
// ✅ 使用 vi.mock 进行模块级 Mock
vi.mock('./api', () => ({
  fetchUser: vi.fn(),
  updateUser: vi.fn()
}));

// ✅ 使用 vi.spyOn 进行对象方法 Spy
const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

// ✅ 使用 vi.fn 创建 Mock 函数
const mockFn = vi.fn()
  .mockReturnValueOnce('first')
  .mockReturnValueOnce('second')
  .mockReturnValue('default');

// ✅ 重置和清理 Mock
afterEach(() => {
  vi.clearAllMocks(); // 清除调用记录
});

afterAll(() => {
  vi.restoreAllMocks(); // 恢复原始实现
});
```

### 4. 异步测试

```typescript
// ✅ 使用 async/await 测试异步操作
it('should fetch user data', async () => {
  const user = await fetchUser('123');
  expect(user).toHaveProperty('id', '123');
});

// ✅ 使用 resolves/rejects 匹配器
it('should resolve with user data', () => {
  return expect(fetchUser('123')).resolves.toHaveProperty('name');
});

it('should reject when user not found', () => {
  return expect(fetchUser('999')).rejects.toThrow('User not found');
});

// ✅ 使用 fake timers 控制时间
it('should debounce search input', async () => {
  vi.useFakeTimers();
  
  const onSearch = vi.fn();
  const { getByPlaceholderText } = render(<SearchInput onSearch={onSearch} />);
  
  const input = getByPlaceholderText('Search...');
  fireEvent.change(input, { target: { value: 'test' } });
  
  // 快进时间
  vi.advanceTimersByTime(300);
  
  expect(onSearch).toHaveBeenCalledWith('test');
  
  vi.useRealTimers();
});
```

---

## 组件测试规范

### 1. 使用 Testing Library

```typescript
// ✅ 优先使用查询方法顺序
// 1. getByRole (最优先)
// 2. getByLabelText
// 3. getByPlaceholderText
// 4. getByText
// 5. getByDisplayValue
// 6. getByAltText
// 7. getByTitle
// 8. getByTestId (最后手段)

import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

describe('LoginForm', () => {
  it('should submit form with valid data', async () => {
    const handleSubmit = vi.fn();
    
    render(<LoginForm onSubmit={handleSubmit} />);
    
    // 使用语义化查询
    const emailInput = screen.getByRole('textbox', { name: /email/i });
    const passwordInput = screen.getByLabelText(/password/i);
    const submitButton = screen.getByRole('button', { name: /sign in/i });
    
    // 使用 userEvent 模拟用户输入
    await userEvent.type(emailInput, 'user@example.com');
    await userEvent.type(passwordInput, 'password123');
    
    // 提交表单
    await userEvent.click(submitButton);
    
    // 验证提交
    await waitFor(() => {
      expect(handleSubmit).toHaveBeenCalledWith({
        email: 'user@example.com',
        password: 'password123'
      });
    });
  });
  
  it('should display validation errors', async () => {
    render(<LoginForm onSubmit={vi.fn()} />);
    
    const submitButton = screen.getByRole('button', { name: /sign in/i });
    
    // 提交空表单
    await userEvent.click(submitButton);
    
    // 验证错误消息
    expect(await screen.findByText(/email is required/i)).toBeInTheDocument();
    expect(await screen.findByText(/password is required/i)).toBeInTheDocument();
  });
});
```

### 2. 测试无障碍性

```typescript
// ✅ 使用 jest-axe 测试无障碍性
import { render } from '@testing-library/react';
import { axe, toHaveNoViolations } from 'jest-axe';

expect.extend(toHaveNoViolations);

describe('Accessibility', () => {
  it('should have no accessibility violations', async () => {
    const { container } = render(<MyComponent />);
    
    const results = await axe(container);
    
    expect(results).toHaveNoViolations();
  });
});
```

---

## E2E 测试规范

### 1. 使用 Playwright

```typescript
// ✅ E2E 测试示例
import { test, expect } from '@playwright/test';

test.describe('User Authentication', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
  });

  test('should login successfully', async ({ page }) => {
    // 输入凭证
    await page.fill('[data-testid="email-input"]', 'user@example.com');
    await page.fill('[data-testid="password-input"]', 'password123');
    
    // 点击登录
    await page.click('[data-testid="login-button"]');
    
    // 验证重定向到首页
    await expect(page).toHaveURL('/dashboard');
    
    // 验证欢迎消息
    await expect(page.locator('[data-testid="welcome-message"]')).toContainText('Welcome');
  });

  test('should show error for invalid credentials', async ({ page }) => {
    await page.fill('[data-testid="email-input"]', 'invalid@example.com');
    await page.fill('[data-testid="password-input"]', 'wrongpassword');
    await page.click('[data-testid="login-button"]');
    
    // 验证错误消息
    await expect(page.locator('[data-testid="error-message"]')).toContainText('Invalid credentials');
    
    // 验证仍在登录页
    await expect(page).toHaveURL('/login');
  });
});
```

### 2. 视觉回归测试

```typescript
// ✅ 使用 Playwright 进行视觉回归测试
import { test, expect } from '@playwright/test';

test.describe('Visual Regression', () => {
  test('homepage visual check', async ({ page }) => {
    await page.goto('/');
    
    // 等待所有资源加载完成
    await page.waitForLoadState('networkidle');
    
    // 截图并与基准对比
    expect(await page.screenshot({ fullPage: true })).toMatchSnapshot('homepage.png');
  });
  
  test('dark mode visual check', async ({ page }) => {
    await page.goto('/');
    
    // 切换到暗色模式
    await page.click('[data-testid="theme-toggle"]');
    await page.waitForTimeout(300); // 等待过渡动画
    
    expect(await page.screenshot({ fullPage: true })).toMatchSnapshot('homepage-dark.png');
  });
});
```

---

## 测试覆盖率目标

| 类型 | 目标覆盖率 | 最低覆盖率 |
|------|-----------|-----------|
| 语句 (Statements) | 90% | 80% |
| 分支 (Branches) | 85% | 75% |
| 函数 (Functions) | 90% | 80% |
| 行 (Lines) | 90% | 80% |

---

## 版本控制

- **v1.0.0** (2026-03-17): 初始版本
  - 单元测试规范
  - 组件测试指南
  - E2E 测试最佳实践
  - 覆盖率目标

---

**规则版本**: 1.0.0  
**最后更新**: 2026-03-17  
**适用**: Vitest/Jest + React Testing Library + Playwright
