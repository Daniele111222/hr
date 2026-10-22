# WB02 实施记录（2026-10-11）

本文件保留验收前过程记录；最终状态及证据见 [最终验收](final-verification.md)。WB01、WB02、WB03 已完成，未提交、部署或升级开发工资库。

## 已实现与实测

- 固定工作簿适配器 `backend/src/paylite/excel/workbook_import.py`：识别花名册 28 列与原考勤 56 列；考勤只映射 19 项有效事实。校验 P1 实际日期和所选月份，不读取上传缓存。XML 实际数据单元格确定有效行，格式尺寸与独立序号不计数，缺身份的非空输入保留。
- 对用户原文件只读解析：花名册 73 行（2—74）、考勤 73 行（3—75）、2026-08。没有将真人文件交给引擎，没有写入数据库。
- 必要依赖白名单与隔离求值副本：保留原坐标和公式，只复制有效输入及实际依赖，不复制宏、外部链接、defined names 或无关工资页。必要外部引用、动态引用、名称、未知函数、循环及错误值定位到原输入单元格。按原范围保留查找语义，不裁剪整列公式。
- 原文件必要依赖检查无错误；共享依赖缓存改造后只读解析和副本生成约 6.216 秒（改造前 79.752 秒）。这里只是一次真实文件预处理耗时，不是最大规模承诺，也没有对真人数据求值。
- `engine.py` / `_uno_worker.py`：仅 Debian 系统 Python + 锁定 LibreOffice 25.2.3.2，显式 `calculateAll()`，任务专属 profile、UNO 管道、新输出文件；不读取旧输出或缓存。清空业务环境，降权，Landlock 文件及 IPC 限制、seccomp 网络 socket 限制、资源上限、超时终止进程组，失败明确返回。
- 默认容器 Bubblewrap 命名空间不可用；实际内核支持 Landlock ABI 7，本实现要求至少 ABI 6，失败拒绝运行。[内核接口](https://docs.kernel.org/userspace-api/landlock.html)
- Calc 的新 profile 首次启动请求退出 81 后重启一次；仅处理这一明确初始化状态，不对任意错误重试或切换引擎。直接启动 `soffice.bin`，绕过 oosplash 的全局管道路径。使用任务 `OSL_SOCKET_PATH`；Dockerfile 将 /tmp、/var/tmp 保持 root 可写、降权工作进程不可写，使 UNO 采用任务专属路径。[锁定版本管道源码](https://raw.githubusercontent.com/LibreOffice/core/libreoffice-25.2.3.2/sal/osl/unx/pipe.cxx)
- `tests/check_workbook_engine.py` 在正式 Calc/UNO 安装的独立 Linux arm64 断网容器运行成功：跨表 VLOOKUP/INDEX/MATCH、EDATE、_xlfn.IFS 数组、NETWORKDAYS/COUNTIFS；正常值 21、999 陈旧缓存重算为 21、修正姓名与假日后为 20；完整身份证、前导零银行卡及日期保持正确。独立预期为 21 个周一至周五工作日，减周三假日加周六补班，再增加周四假日。
- 同一脚本证明任务目录外的合成文件读取、覆盖以及 IPv4/IPv6 TCP、UDP socket 创建返回 PermissionError，外部文件保持原值。脚本使用合成数据和受控临时文件，不访问工资库。日志 `/private/tmp/paylite-wb02-engine-check.log`。
- 当前适配器/引擎边界 **10 passed**，含原位置、错月、百万行尺寸、危险依赖、公式追溯、引擎缺失/超时/崩溃拒绝输出；改动范围 Ruff/格式、两条分层约束、编译与 diff 检查通过。

## 运行环境说明

验证镜像 `paylite-wb02-engine-runtime:probe` 为已有 `hr-backend:latest` 的独立安装衍生镜像，包含锁定正式包；不是已部署业务服务。诊断镜像/容器仅用于合成启动问题，未改变业务容器权限。产品 Dockerfile 已声明 trixie 与固定版本，标准镜像构建另行记录，不能将临时镜像验证当作标准构建成功。

标准 Dockerfile 首次构建失败于 Docker Hub 的 TLS handshake timeout，日志 `/private/tmp/paylite-wb02-standard-build.log`。随后从 Docker 官方的 ECR Public 分发渠道取得同名 Python trixie 镜像（digest `sha256:70729b46c69b4f1e97c4822c1af3df53a1476cf5ddc6c087c0c10bc3a5678c2f`），登记为本地基础镜像缓存；没有用业务镜像冒充基础镜像，没有改变 Dockerfile 的 FROM。**标准构建成功**，镜像 `paylite-wb02-standard:verification`，日志 `/private/tmp/paylite-wb02-standard-build-cached.log`。安装包运行验收单独记录，未更新业务服务。[Docker 官方分发说明](https://www.docker.com/blog/news-from-aws-reinvent-docker-official-images-on-amazon-ecr-public/)

## 本轮上传与页面进展

- 新增 0014 revision/SQL 与 `workbook_import` 来源关联，原文件只存一份，关联花名册及考勤子批次。历史单项导入保持兼容，整本考勤子批次原文件下载返回父任务文件，旧纠错入口明确拒绝绕过整本依赖版本。
- 真实上传 API 顺序验证员工→刷新本期任职→考勤；新增员工按月初与入职日较晚者初始化全部四类生效记录。已有员工静默跳过，不创建来源新部门或覆盖薪资；重复文件返回原任务，换文件不能覆盖已保存考勤。
- 专用 paylite_test + 实际 UNO 运行时完整 PostgreSQL 接口回归 **51 passed**，日志 `/private/tmp/paylite-wb02-api-regression.log`。覆盖月初/入职日初始化、原位置、部分成功、依赖未就绪、下载/重复上传、数据库故障完整回滚。追加并发三请求同任务 **1 passed**，日志 `/private/tmp/paylite-wb02-api-concurrent.log`；非法引擎输出无写入 **1 passed**，日志 `/private/tmp/paylite-wb02-failed-output.log`。
- 来源身份查找匹配不唯一时拒绝相关考勤，花名册重复继续静默跳过；实际接口先复现错误接受再修复，红/绿日志 `/private/tmp/paylite-wb02-identity-{red,green}.log`。
- 导入中心整本入口与原型 `workbook-import.html` 同步，分别显示两类输入、主体归集、原字段及单元格、解析值、原文件和只读历史；无主体/批次选择，无拆表要求。导入页面 **19 passed**，日志 `/private/tmp/paylite-wb02-front-all-imports.log`；类型检查和生产构建成功 `/private/tmp/paylite-wb02-front-build.log`。
- 真实浏览器使用隔离合成响应查看 1366px 空/部分成功、390px 部分成功与只读详情，截图在 `output/playwright/wb02-*.png`。窄屏表格内部滚动，布局稳定后页面宽度与视口均为390，详情视口截图已人工核对；首次即时尺寸检查受到响应式状态切换影响，未当成产品溢出缺陷。未使用浏览器向业务库写验收数据。

## 尚需实现与验收

上传保存与查询闭环已实现并完成上述验证；WB02 尚需按整票标准补齐边界检查、标准安装包运行态与最终审查。依赖纠错 WB03 及整本输入后的最终完整核算/四类导出验收仍未完成，当前检查不能替代整个 feature 交付；WB02 验收全部未勾选。

正式镜像、资源/规模边界、攻击性载荷及接口无业务写入、依赖不唯一的业务复核仍需验证；真实工资人工对账不由合成结果替代。
