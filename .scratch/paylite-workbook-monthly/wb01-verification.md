# WB01 验收记录（2026-10-11）

范围：`codex/feature-workbook-monthly` 上月度不含绩效的工作区改动。未提交、未部署，未升级开发工资库；WB02/03 尚未交付。

## 业务证据

- `test_ordinary_trial_is_partial_versioned_and_outside_ledger`：无绩效也可试算；只修改绩效基数和绩效修订号不改变新指纹，固定金额变化仍使试算失效。
- `test_employee_import_uploads_partial_rows_and_corrects_one_row`、27 列导入测试及 employee/domain/schema 单测：绩效可空，非法非月度资料不阻断固定输入；已有合法值保留，不伪造零。
- `test_correction_switches_effective_version_without_rewriting_ledger[False/True]`：真实 API 在专用 `paylite_test` 覆盖试算、激励、查看、确认、锁定、四类导出、整批更正及有效台账。分别验证新来源和旧含绩效来源。旧未确认快照须重算；旧确认金额 9100 保留，新更正仅改考勤且排除原绩效，固定薪资继续使用原快照 8000。
- 同一集成测试分别在原结果与更正结果锁定后下载工资、代发、人工成本、税务四类真实 Excel，核对总额与有效台账；新绩效明细为空、税额未知为空，旧绩效金额保留。
- `test_nullable_performance_migration_refuses_loss`：0013 允许绩效为空，存在空值时降级拒绝；没有删除、补零或覆盖旧工资。
- 页面测试覆盖绩效历史只读、月度无绩效待办、工资更正仅考勤、可空员工资料及新旧台账解释。旧计算步骤中工作天数仍从历史绩效步骤恢复，新步骤从固定薪资读取。

## 已运行检查

- 后端相关领域、DTO、员工导入、工资导出单测及全部 PostgreSQL 集成测试：**99 passed**，日志 `/private/tmp/paylite-wb01-check.log`。
- 追加完整四导出及旧未确认口径门槛后，重跑上述更正集成测试两个参数：**2 passed**，日志 `/private/tmp/paylite-wb01-flow-final.log`。数据库明确为 `paylite_test`，显式开启测试重置；未指向 `paylite`。
- 工资导出单测：**4 passed**，含全空绩效总计为空及混合历史结果总计保留。
- 六个改动页面测试文件：**51 passed**，日志 `/private/tmp/paylite-wb01-pages-final.log`。
- 改动范围 Ruff 与格式：20 文件通过；两条 import-linter contract 通过；Python 编译检查通过。
- 改动范围 Oxlint、Prettier 通过；生成 API 契约、TypeScript 与 Vite 生产构建通过，构建日志 `/private/tmp/paylite-wb01-build-final.log`。
- Playwright 在 1366px、390px 检查考勤入口、绩效历史只读及横向溢出；考勤选中标签与内容一致。截图位于忽略目录 `output/playwright/wb01-{attendance,performance}-{1366,390}.png`。界面接口为隔离合成响应，真实业务持久化由上述 API 集成测试验证。

## 审查与限制

按工作流执行 Standards / Spec 两轴只读审查。发现并修复：旧步骤恢复工作天数的字段合并问题，以及新工资表绩效总计公式显示零的问题；两项定向复审均关闭。

依赖产生 TestClient 弃用告警、JSDOM 伪元素告警及构建分包体积提示，不改变本票结果。真实工资人工对账、标准后端镜像构建与上线尚未执行；本票验收不替代整本导入及引擎部署验收。
