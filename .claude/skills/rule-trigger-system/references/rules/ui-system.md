---
triggers:
  extensions: [".css", ".scss", ".less", ".styl"]
  keywords: ["style", "className", "tailwind", "css", "ui", "design", "layout", "responsive", "theme", "color", "font", "spacing"]
  commands: ["/ui", "/style", "/design"]
priority: 90
cacheable: true
version: "1.0.0"
---

# UI 系统与设计规范

本规则定义了用户界面设计、样式编写和响应式布局的最佳实践。

---

## 设计原则

### 1. 一致性

- 使用统一的设计系统（颜色、字体、间距）
- 遵循既定的命名规范
- 保持组件风格的统一性

### 2. 可读性

- 保证足够的对比度（WCAG 2.1 AA 标准）
- 使用合适的字体大小和行高
- 保持合理的行长度（45-75 个字符）

### 3. 响应式

- 移动优先设计
- 使用相对单位（rem, em, %）
- 关键断点：320px, 768px, 1024px, 1440px

---

## CSS/Tailwind 规范

### 1. 命名规范

#### BEM 命名法

```css
/* Block */
.card { }

/* Element */
.card__header { }
.card__body { }
.card__footer { }

/* Modifier */
.card--primary { }
.card--large { }
.card--disabled { }
```

#### Tailwind 类名组织

```tsx
// ✅ 按类别组织类名
function Button({ variant, size, children }: ButtonProps) {
  return (
    <button
      className={`
        /* 布局 */
        inline-flex items-center justify-center
        
        /* 间距 */
        px-4 py-2
        
        /* 字体 */
        font-medium text-sm
        
        /* 边框 */
        rounded-md border
        
        /* 状态 */
        focus:outline-none focus:ring-2 focus:ring-offset-2
        disabled:opacity-50 disabled:cursor-not-allowed
        
        /* 变体 */
        ${variant === 'primary' 
          ? 'bg-blue-600 text-white border-transparent hover:bg-blue-700' 
          : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
        }
        
        /* 尺寸 */
        ${size === 'large' ? 'px-6 py-3 text-base' : ''}
        ${size === 'small' ? 'px-3 py-1 text-xs' : ''}
      `}
    >
      {children}
    </button>
  );
}
```

### 2. 响应式设计

```tsx
// ✅ 移动优先的响应式设计
function ResponsiveLayout() {
  return (
    <div className="
      /* 基础样式（移动端） */
      grid grid-cols-1 gap-4 p-4
      
      /* 平板 (768px+) */
      md:grid-cols-2 md:gap-6 md:p-6
      
      /* 桌面 (1024px+) */
      lg:grid-cols-3 lg:gap-8 lg:p-8
      
      /* 大屏 (1440px+) */
      xl:grid-cols-4 xl:max-w-7xl xl:mx-auto
    ">
      <Card />
      <Card />
      <Card />
      <Card />
    </div>
  );
}
```

### 3. 暗色模式支持

```tsx
// ✅ 支持暗色模式
function ThemeAwareComponent() {
  return (
    <div className="
      /* 亮色模式 */
      bg-white text-gray-900
      
      /* 暗色模式 */
      dark:bg-gray-900 dark:text-gray-100
    ">
      <h1 className="
        text-2xl font-bold
        text-gray-800 dark:text-gray-200
      ">
        Title
      </h1>
      
      <p className="
        text-gray-600
        dark:text-gray-400
      ">
        Content goes here...
      </p>
      
      <button className="
        px-4 py-2 rounded
        bg-blue-600 text-white
        hover:bg-blue-700
        dark:bg-blue-500 dark:hover:bg-blue-600
      ">
        Action
      </button>
    </div>
  );
}
```

---

## 设计系统规范

### 1. 颜色系统

```typescript
// tailwind.config.ts
const config = {
  theme: {
    extend: {
      colors: {
        // 主色调
        primary: {
          50: '#eff6ff',
          100: '#dbeafe',
          200: '#bfdbfe',
          300: '#93c5fd',
          400: '#60a5fa',
          500: '#3b82f6',
          600: '#2563eb',
          700: '#1d4ed8',
          800: '#1e40af',
          900: '#1e3a8a',
        },
        // 语义化颜色
        success: {
          light: '#86efac',
          DEFAULT: '#22c55e',
          dark: '#15803d',
        },
        warning: {
          light: '#fcd34d',
          DEFAULT: '#f59e0b',
          dark: '#b45309',
        },
        error: {
          light: '#fca5a5',
          DEFAULT: '#ef4444',
          dark: '#b91c1c',
        },
        info: {
          light: '#93c5fd',
          DEFAULT: '#3b82f6',
          dark: '#1d4ed8',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
        mono: ['Fira Code', 'Monaco', 'Consolas', 'monospace'],
      },
      fontSize: {
        'xs': ['0.75rem', { lineHeight: '1rem' }],
        'sm': ['0.875rem', { lineHeight: '1.25rem' }],
        'base': ['1rem', { lineHeight: '1.5rem' }],
        'lg': ['1.125rem', { lineHeight: '1.75rem' }],
        'xl': ['1.25rem', { lineHeight: '1.75rem' }],
        '2xl': ['1.5rem', { lineHeight: '2rem' }],
        '3xl': ['1.875rem', { lineHeight: '2.25rem' }],
        '4xl': ['2.25rem', { lineHeight: '2.5rem' }],
      },
      spacing: {
        '0': '0',
        'px': '1px',
        '0.5': '0.125rem',
        '1': '0.25rem',
        '2': '0.5rem',
        '3': '0.75rem',
        '4': '1rem',
        '5': '1.25rem',
        '6': '1.5rem',
        '8': '2rem',
        '10': '2.5rem',
        '12': '3rem',
        '16': '4rem',
        '20': '5rem',
        '24': '6rem',
        '32': '8rem',
        '40': '10rem',
        '48': '12rem',
        '56': '14rem',
        '64': '16rem',
      },
      borderRadius: {
        'none': '0',
        'sm': '0.125rem',
        'DEFAULT': '0.25rem',
        'md': '0.375rem',
        'lg': '0.5rem',
        'xl': '0.75rem',
        '2xl': '1rem',
        '3xl': '1.5rem',
        'full': '9999px',
      },
      boxShadow: {
        'sm': '0 1px 2px 0 rgba(0, 0, 0, 0.05)',
        'DEFAULT': '0 1px 3px 0 rgba(0, 0, 0, 0.1), 0 1px 2px 0 rgba(0, 0, 0, 0.06)',
        'md': '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)',
        'lg': '0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05)',
        'xl': '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)',
        '2xl': '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
        'inner': 'inset 0 2px 4px 0 rgba(0, 0, 0, 0.06)',
        'none': 'none',
      },
      transitionTimingFunction: {
        'DEFAULT': 'cubic-bezier(0.4, 0, 0.2, 1)',
        'linear': 'linear',
        'in': 'cubic-bezier(0.4, 0, 1, 1)',
        'out': 'cubic-bezier(0, 0, 0.2, 1)',
        'in-out': 'cubic-bezier(0.4, 0, 0.2, 1)',
      },
      transitionDuration: {
        '0': '0ms',
        '75': '75ms',
        '100': '100ms',
        '150': '150ms',
        '200': '200ms',
        '300': '300ms',
        '500': '500ms',
        '700': '700ms',
        '1000': '1000ms',
      },
      zIndex: {
        '0': 0,
        '10': 10,
        '20': 20,
        '30': 30,
        '40': 40,
        '50': 50,
        'auto': 'auto',
        'dropdown': 1000,
        'sticky': 1020,
        'fixed': 1030,
        'modal-backdrop': 1040,
        'modal': 1050,
        'popover': 1060,
        'tooltip': 1070,
      },
    },
  },
  plugins: [
    require('@tailwindcss/forms'),
    require('@tailwindcss/typography'),
    require('@tailwindcss/aspect-ratio'),
  ],
};

export default config;
```

---

## 版本控制

- **v1.0.0** (2026-03-17): 初始版本
  - 颜色系统设计
  - 字体系统规范
  - 间距和尺寸标准
  - 响应式断点
  - 暗色模式支持

---

**规则版本**: 1.0.0  
**最后更新**: 2026-03-17  
**适用**: Tailwind CSS 3.0+, React 18+
