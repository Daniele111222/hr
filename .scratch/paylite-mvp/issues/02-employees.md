# 02：员工与薪酬维护

**What to build（交付）：** HR 能维护员工当前身份资料、任职、薪酬、转正信息、base 地和银行账户，为期间算薪提供可解释的输入。

**Blocked by（前置任务）：** 01：公司与组织维护

**Status:** completed

## 验收标准

- [x] 身份证和银行卡作为文本保存；身份证在公司内唯一且不可修改，停用员工不删除历史工资。
- [x] 维护入离职、任职主体/部门/职级、转正日期及算薪需要的薪资生效信息。
- [x] 薪酬标准按固定薪资 80%、绩效基数 20% 表达；试用期无绩效，转正前后固定薪资不变。
- [x] 普通加减薪按适用工资期间整月处理，入离职与主体/部门调动保留生效日期。
- [x] 员工当前资料与历史工资快照职责明确，不扩展完整员工历史档案；生效区间冲突有反馈。
- [x] 通过页面新增、修改和查询验证实际持久化结果，覆盖重复身份与无效日期。

## 开始前需收敛的事项

涉及月中变化的期间输入保存方案应支持后续历史结果解释；不得用当前资料覆盖已确认工资快照。

## 完成记录

- 实现摘要：已接入员工查询、新增和修改 API；新增时在单事务内写入员工主档、任职、薪酬、base 地和银行卡；身份证号/员工编号不可通过修改接口变更；薪酬、任职、base 地和银行卡修改会关闭旧生效区间并新增下一段，停用仅更新 active；校验固定薪资 80%/绩效基数 20%、试用期无绩效及转正固定薪资不变；前端使用组织资料选择器并提供新增、编辑、停用入口。
- 验证命令与结果：后端 `ruff check src tests` 通过；前端 `tsc -b`、Vitest（1 个测试文件/1 个测试）和 Vite production build 通过；使用隔离 PostgreSQL `paylite_test` 运行后端 pytest：22 passed（含员工新增、重复身份证、薪酬生效区间、薪酬结构规则和删除引用保护）。
- 审查结论及遗留事项：员工与薪酬基础维护竖切已完成；更细的任职变更表单和工资计算属于后续需求。

## Comments

2026-09-20（索引同步时记录，非实现方）：`Status:` 保持 `completed`，development-plan.md 状态列记为**待验收**。按验收标准逐条核对现有证据：

**已有测试支撑：**
- 第 3 条（薪酬 80%/20%、试用期无绩效）—— `test_business_schemas.py::test_salary_policy_requires_eighty_twenty_and_no_probation_performance` 直接覆盖三种情形：试用期带绩效基数报错、非 80%/20% 报错、合规通过。对应实现在 `api/employees.py::_validate_salary_policy`（以 `performance_base * 4 == fixed_salary` 判定）。
- 第 1 条（身份证唯一、文本保存）—— `test_postgres_integration.py::test_id_number_is_unique_text`，以及 API flow 中重复身份证返回 409 且 detail 含“身份证”。
- 生效区间**顺序追加与旧区间关闭** —— API flow 测试断言 PATCH 薪酬后 `salary_rows[0].effective_to == date(2026, 7, 1)`。
- 生效日期倒置 —— `test_effective_records_reject_reversed_dates`、`test_employee_rejects_invalid_lifecycle_dates`。

**缺测试，且其中一条是验收标准明文要求：**
- 第 5 条要求“**生效区间冲突有反馈**”。实现存在该路径（`api/employees.py` 的 `_append_effective_record`：新生效日期不晚于当前记录时抛 `HTTPException(400, "新生效日期必须晚于当前记录的生效日期")`），但 `backend/tests/` 下**没有任何 400 断言**，该分支未被执行过。这是已实现未验证，不是未实现。
- 第 1 条要求“停用员工不删除历史工资”。停用（`active` 更新）路径在测试中**无任何断言**，grep `active=` / `"active"` 在 `backend/tests/` 下无命中。
- 第 4 条“转正前后固定薪资不变”：`_validate_salary_policy` 的 `preserve_fixed` 分支已接入 API 层 PATCH（`update_employee` 以 `employee.probation_status == "in_probation" and target_status != "in_probation"` 按位传入），但 `test_postgres_integration.py` 的 API flow 测试中员工创建时即为 `probation_status="confirmed"`，该条件恒假，**分支从未被驱动**。`test_business_schemas.py` 只构造 `EmployeeIn`（走 create 路径，`preserve_fixed` 用默认 `False`），同样不覆盖。要验证需构造 in_probation → confirmed 的转正 PATCH。
- 附带发现（**静态阅读代码所得，未运行验证**）：`update_employee` 的 `elif "probation_status" in values` 分支只传两个参数（`preserve_fixed` 用默认 `False`），即**仅改转正状态、不同时提交新薪酬**时不做固定薪资不变校验。按 `_validate_salary_policy` 的逻辑推演，此时 `current_salary.performance_base` 为 0（试用期无绩效），会落入第二个 if 并因 `0 * 4 != fixed_salary` 抛 400“固定薪资和绩效基数必须按 80%/20% 表达”——错误信息指向薪酬结构而非“转正需一并提交薪酬”，对使用者可能误导。补测试时应固化预期行为（保持 400 但改善文案，或允许沿用原基数），并据此决定是否需要改动。
- 第 2、6 条的前端部分：`frontend/src/pages/employees/` 下只有 `index.tsx` 与 `index.module.less`，无测试文件；全仓库前端仅 `src/app/App.test.tsx` 一个测试。第 6 条要求“通过页面新增、修改和查询验证实际持久化结果”，当前无页面级证据。

待办：补生效区间冲突的 400 测试、停用路径测试、转正固定薪资不变的 API 层测试、员工页面组件测试，随后逐条勾选验收标准并把 development-plan.md 状态列转“已完成”。勾选须由实际运行过验证的会话执行。

2026-09-21：补充员工页面查询、编辑、查询错误、关键词筛选及“试用期转已转正”提交测试，前端全套实测为 3 个测试文件、8 个测试通过，生产构建通过。页面转正时提交原固定薪资、新绩效基数和转正生效日；PostgreSQL API 流程增加生效日期冲突 400、停用后资料仍可查询、试用期转正固定薪资不得变化及合法转正断言；同时修复 PATCH 在校验前覆盖原转正状态、导致固定薪资保护失效的问题。纯业务 schema 测试已实际通过，但新增 PostgreSQL 断言因用户选择不下载 PostgreSQL 而未执行；包含转正前后固定薪资保护的第 3 条也暂不勾选。索引状态仍为“待验收”。

2026-09-22：在独立 `paylite_test` 上运行后端全套测试，22 passed；其中试用期转正固定薪资变化返回 400、固定薪资不变且补足绩效基数返回 200 的 PostgreSQL API 断言已执行，结合薪酬结构 schema 测试与页面转正提交测试，第 3 条勾选。其余条目仍缺完整证据，尤其第 6 条要求页面操作到真实持久化；现有页面测试使用模拟接口，不能冒充该闭环。开发库未写入测试数据。

2026-09-22（继续验收）：员工编辑页开放任职、职级、普通调薪、base 地及银行卡变更，变更时填写各自生效日期；普通调薪的后端约束为工资期间首日生效，月中调薪返回 400，转正仍可使用实际日期。PATCH 身份证等未允许字段现返回 422 而非静默忽略。PostgreSQL 集成测试覆盖前导零银行卡文本、唯一身份、回滚、生效区间冲突、停用后工资快照仍存、无效日期与转正固定薪资；后端 22 passed。前端 9 项测试和生产构建通过；真实浏览器在 `paylite_test` 新增员工、修改并刷新查询，随后从页面调薪与修改任职/银行卡，再经 API 查询确认金额及各自生效日期持久化。测试库已清理，开发库未写入验收数据。第 1、2、4—6 条据此勾选。实际工资计算和真实数据对账属于后续票，不作为本票验收依赖。
