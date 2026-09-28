# 09：全公司考勤激励

**What to build（交付）：** HR 能查看全公司当期就绪情况，统一计算考勤激励并追溯其来源。

**Blocked by（前置任务）：** 08：普通工资试算与核对

**Status:** completed

## 验收标准

- [x] 按公司期间协调各主体数据；不齐时可保留普通试算，但不能确认最终工资。
- [x] 激励池来自上月全主体锁定考勤扣款，候选人为本月有考勤、无规定异常、正式已转正且低于 P7 的员工。
- [x] 按人数平均，保留两位，尾差给确定排序的最后一人；无合格员工时不生成金额并提示。尾差顺序已于 2026-09-28 确认。
- [x] 保存池来源、候选快照、排序、分配结果及版本；激励计入工资，不计入社保公积金基数。
- [x] 输入变化影响公司期间就绪状态与相关批次试算，不能确认旧激励结果。
- [x] 固定顺序锁定关联资源；验证多主体、重试、并发和金额守恒，不重复分配。

## 业务口径核对

- 当期各主体数据未齐时可先普通试算，但未包含最终激励的试算不能确认；见 `CONTEXT.md` 的“全公司激励”决策。
- 缺少上月期间或任一主体上月有效锁定正常批次时阻止计算，不把缺失扣款当作零；由本票验收标准约束。
- 跨主体调动暂不计算；见 `CONTEXT.md` 的“2026-09-24 普通工资试算补充口径”。无候选人时保存空结果并提示不生成激励金额。
- 尾差排序已于 2026-09-28 确认：按主体 ID、员工工号、员工 ID 升序，尾差给排序最后一人。

## 完成记录

- 实现摘要：已落地公司期间激励 API/service、`0007_attendance_incentive` 迁移及前端页面；记录上月来源、候选快照、排序、分配和输入指纹，并将最终激励写入各主体最终试算。公司数据或上月来源不齐、普通试算过期时禁止计算；激励不计入社保公积金基数。
- 验证命令与结果：`backend/.venv/bin/pytest -q backend/tests/test_attendance_incentive.py`：3 passed；使用专用 `paylite_test` URL 并设置 `PAYLITE_ALLOW_TEST_DATABASE_RESET=1` 运行 `backend/.venv/bin/pytest -q backend/tests/test_postgres_integration.py -k company_attendance_incentive`：1 passed；核查期间还临时验证了缺上月来源阻断、当期未齐时不能确认及两路并发请求复用同一 run id，均通过，临时测试代码未保留；`backend/.venv/bin/ruff check backend/tests/test_postgres_integration.py` 和 `ruff format --check` 通过；Node 24 下 `npm run test -- --run src/pages/payroll/incentive.test.tsx`：2 passed。
- 审查结论及遗留事项：验收条款全部满足。真实工资数据尚未用于人工金额对账，按 MVP 计划留到真实数据验收。
