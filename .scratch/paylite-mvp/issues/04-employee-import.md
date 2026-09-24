# 04：员工 Excel 导入

**What to build（交付）：** HR 能下载员工固定模板、导入员工资料并逐行修正错误。

**Blocked by（前置任务）：** 02：员工与薪酬维护

**Status:** completed

## 验收标准

- [ ] 提供版本化模板下载、上传、结果摘要和逐行错误页面（功能及自动化验证已完成，待用户页面验收）。
- [x] 正确行可先保存，错误行保留原始值、工作表、行列位置、错误码及修正记录。
- [x] 保留原始文件、哈希、模板版本与字段映射，业务标识不丢失前导零或精度。
- [x] 重复文件按公司作用域拒绝；身份证与既有员工冲突不得静默覆盖。
- [x] 修正行重新校验，通过后仅写入一次；文件处理失败不产生不可追溯的成功状态。
- [x] 用包含有效行、错误行、重复身份和长数字标识的工作簿验证完整流程。

## 开始前需收敛的事项

实现前收敛姓名/身份证不一致、辅助匹配、员工主档导入与工资期间关联的处理契约；不得将样例策略当作已确认业务规则。

## 完成记录

- 实现摘要：新增固定员工模板生成与 `openpyxl` 解析、原始文件/哈希/字段映射/行级错误持久化、公司范围重复文件拒绝、身份证冲突拒绝、逐行纠错接口；前端 `/imports` 按 `design/import-center.html` 和 `design/import-batch.html` 重建流程、预览、历史及抽屉纠错。
- 验证命令与结果：`backend/.venv/bin/pytest -q backend/tests`（21 passed，12 个 PostgreSQL 测试因未设置环境变量跳过）；使用专用 `paylite_test` 执行 `PAYLITE_TEST_DATABASE_URL=... PAYLITE_ALLOW_TEST_DATABASE_RESET=1 backend/.venv/bin/pytest -q backend/tests/test_postgres_integration.py`（12 passed）；`backend/.venv/bin/ruff check ...`、`compileall` 通过；前端 Node 24 下 `tsc -b`、`vitest run`（18 passed）、`vite build` 通过。
- 审查结论及遗留事项：已按确认口径整行拒绝既有身份证冲突，导入页不提供覆盖主档操作；页面视觉与交互验收由用户处理，完成前不标记整票验收通过。未引入自定义字段映射或个税逻辑。
