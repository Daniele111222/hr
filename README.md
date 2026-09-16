# 轻算薪 PayLite

面向中小企业 HR 的轻量算薪工具 —— 定位「Excel 增强器 + 算薪核对器」。

导入员工主档、月度考勤和绩效 Excel，按固定薪酬、绩效、考勤、社保和公积金规则生成工资结果，输出工资表 / 银行代发文件 / 人工成本表 / 申报辅助模板，并提供结果追溯、缺失字段提示和核对能力。系统不计算个税。

## 产品定位

- **目标用户**：中小企业 HR（5–300 人，Windows + Excel 使用习惯，无专职 IT 部门）
- **数据不出本机**：本地存储、无账号、无云同步
- **核心壁垒**：按期间版本化的「城市社保基数 + 公积金规则 + 考勤薪酬规则」和对既有 Excel 模板的稳定适配

## 明确不做

- 不做一体化 HRMS（考勤 / 招聘 / 绩效等）
- 不接个税申报接口，只导出申报辅助格式

## 路线图

| 里程碑 | 内容 |
| --- | --- |
| M1 | 员工主档、固定薪酬/绩效基数、考勤和绩效导入，以及规则数据 |
| M2 | 月度工资计算、工资台账，以及工资表 / 代发工资表 / 人工成本表导出 |
| M3 | 申报辅助模板导出、缺失字段提示、结果追溯和导入错误处理 |
| M4 | 更正批次、历史期间回算、规则维护；Windows 打包后置 |

## 技术栈（已确认，2026-09-12）

- 后端：Python 3.13 + FastAPI + Uvicorn + Pydantic v2
- 数据库：PostgreSQL；SQLAlchemy 2.x + Alembic + psycopg 3
- 前端：React + TypeScript + Vite + Ant Design
- 前端数据与表单：TanStack Query + React Hook Form
- Excel：`openpyxl` 处理 `.xlsx`；旧式 `.xls` 模板统一转换为 `.xlsx`
- 测试：pytest + Vitest + Testing Library + Playwright
- 运行方式：本地网页端，浏览器访问本机 Web 服务；暂不做 PyInstaller、Windows 安装包或单个 EXE
- 数据边界：PostgreSQL 运行在本机，数据不上传云端

## 项目文档

产品路线、功能优先级、数据模型和里程碑见 [docs/product.md](docs/product.md)。

后端分层、ORM 分包、事务生命周期和业务规则落地差距见 [docs/backend-architecture.md](docs/backend-architecture.md)。

## License

[MIT](LICENSE)
