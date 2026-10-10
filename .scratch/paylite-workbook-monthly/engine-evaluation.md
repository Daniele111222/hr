# 整本工资工作簿导入：Excel 引擎评估

**日期：** 2026-10-10  
**范围：** 选型研究；未安装候选库、未改业务代码、未将员工数据上传至外部服务。LibreOffice 本机合成试验由主任务补充，本文不声称真实样表已通过任何引擎。

## 建议

值得评估引入现成的本地公式引擎，但需要解决的是“有效输入的跨表公式”，而不是“读取多个工作表”。整本花名册、考勤的识别、字段映射、期间校验、顺序保存、幂等与纠错，仍由 PayLite 的 Excel Adapter 和 service 负责；不能把工作簿算出的工资、扣款或绩效当作工资业务真值。

推荐方向为“固定工作表/字段适配 + 本机公式引擎 + 系统事实校验”，优先验证稳定版 LibreOffice/UNO 的强制重算路径，`formulas` 为更轻的 Python 备选。LibreOffice 倾向兼容原工作簿，代价是独立进程与部署；`formulas` 有按输出范围构建子模型的官方接口，但真实函数组合、数组、许可及依赖必须验证。Aspose.Cells 可以作为允许商业依赖时的候选。当前不优先采用 `pycel`、`xlcalculator` 或 HyperFormula。

这是选型推断，不是兼容性验收。若必要公式类型固定且非常有限，保留现有适配器处理明确来源的方案仍更小；若继续扩展自写表达式解析、类型转换、数组和函数集合，其维护成本可能超过引擎。

## 不能由引擎替代的边界

- 只提取花名册与考勤事实；绩效、增减项、税额及 Excel 薪资结果不参与新月度核算。
- 身份证、银行卡不能经过浮点转化后再“修复”为文本；公式结果也必须通过同一套身份、日期、天数及金额文本校验。
- 只将有效输入及必要依赖的求值结果用于导入，优先限制临时求值副本的范围。使用全表强制重算的引擎时，机械计算某个无关公式不等同于 PayLite 接收其业务结果；无关工资页的错误不得让合法考勤整体失败，也不能要求整本工资表“全部无错”才接收考勤。
- 保留原文件、原表达式、位置、求值结果与人工修正。引擎版本属于解析证据，不能默默升级后改变历史解释。
- 必需公式求值错误、循环、外部依赖或结果类型错误必须报错，不能降级为缓存、空值或零。阻断真正依赖的记录，而不是静默改变来源。

以上为 PayLite 设计要求，来源是本需求 [spec.md](./spec.md)，不是候选产品的能力承诺。

## 候选比较

| 候选 | 工作簿与跨表依赖：官方能力 | 部署与许可：官方证据 | 对 PayLite 的判断（推断） |
| --- | --- | --- | --- |
| formulas | `ExcelModel` 加载 `.xlsx`、计算、写回；官方 `from_ranges` 可从输出单元格构建部分依赖模型，无需 Excel COM。[维护者文档](https://github.com/vinci1it2000/formulas#excel-workbook) | EUPL 1.1+；当前维护者包元数据及源码列出 Python 3.13、macOS/POSIX；2026-03-11 有正式发布。[PyPI](https://pypi.org/project/formulas/) [setup.py](https://github.com/vinci1it2000/formulas/blob/master/setup.py) | Python 方案优先候选；官方子模型能力符合限定必要输入的方向。元数据不等于本项目 Python 3.13/Docker 安装成功；需要锁定实际发布版本测试，不能只依据 master。许可需匹配后续交付方式。 |
| pycel | 以依赖图编译并计算工作簿，维护者曾测试多表；有 CSE 数组支持，但动态引用可能引用尚未编译的单元格而失败，VBA 不编译。[README](https://github.com/dgorissen/pycel#the-bad) [发布历史](https://pypi.org/project/pycel/) | GPLv3；PyPI 最近正式发布是 2021-10-13。源码限制 `networkx>=2.0,<2.7`，最高明确 Python 分类为 3.10。[setup.py](https://github.com/dgorissen/pycel/blob/master/setup.py) | 暂不优先：Python 3.13 与旧依赖组合未证明可用，可能先花时间修兼容。不能据此断言项目已停止维护。 |
| xlcalculator | 可读 Excel、建立模型、计算指定单元格或范围；官方明确不支持 CSE 数组公式，VLOOKUP 仅精确匹配，并列出数值兼容限制。[README](https://github.com/bradbase/xlcalculator) | MIT；PyPI 最近发布是 2023-02-06；源码要求 Python >=3.9、分类到 3.11，依赖 NumPy/Pandas/SciPy 等。[PyPI](https://pypi.org/project/xlcalculator/) [setup.py](https://github.com/bradbase/xlcalculator/blob/master/setup.py) | 数组是本例评估项，因此不作为原工作簿首选。许可宽松不能抵消缺失能力；不能把该仓库横向比较表当作其他库的最新能力。 |
| HyperFormula | 有多表数据与依赖计算，但没有内置 XLSX 导入；官方示例先用 ExcelJS 将工作簿转成 JavaScript 数组，再调用 `buildFromSheets`。[文件导入](https://hyperformula.handsontable.com/docs/guide/file-import.html) | JavaScript/TypeScript、支持 Node；GPLv3 或商业双许可，由 Handsontable 团队维护。[官方主页](https://hyperformula.handsontable.com/docs/) [许可](https://hyperformula.handsontable.com/docs/guide/licensing.html) | 后端增加 Node 执行与 XLSX 转换边界；日期、命名区域、数组元数据都要正确传递。若没有在线表格编辑需求，目前收益不足以抵消这层集成。 |
| Aspose.Cells for Python via .NET | `Workbook` 直接读工作簿，`calculate_formula()` 计算；官方支持数组与 R1C1 公式。[公式处理](https://docs.aspose.com/cells/python-net/using-formulas-or-functions-to-process-data/) | 商业许可；试用会加水印并限制同进程打开文件数。当前包 `aspose-cells-python` 声明 Python >=3.8,<3.14，分类含 3.13；有 macOS x64/arm64 与 Linux x64 包。[许可](https://docs.aspose.com/cells/python-net/licensing/) [PyPI](https://pypi.org/project/aspose-cells-python/) [发行包](https://releases.aspose.com/cells/python-net/) | 有预算时可减少自维护公式语义。需验证目标 Docker 架构及原生库，不能把 macOS arm64 wheel 推断成 Linux arm64 支持；不在本次编造报价。 |
| LibreOffice / UNO | 原生文档读取及无界面运行；官方 `calculateAll()` 明确重算全部单元格，`calculate()` 只重算脏单元格。[命令行](https://help.libreoffice.org/latest/en-US/text/shared/guide/start_parameters.html) [重算 API](https://api.libreoffice.org/docs/idl/ref/interfacecom_1_1sun_1_1star_1_1sheet_1_1XCalculatable.html) | 本机 bundled runtime 带 LibreOfficeDev 26.8.0.0.alpha0；正式产品须锁定正式稳定版并在目标容器部署，不依赖 Codex 私有运行时。本机没有正式安装的 Microsoft Excel。 | 首选验证候选：本轮跨表合成测试有正向证据，但普通转换的旧缓存反例已失败，生产必须显式强制重算。UNO 和稳定版容器路径尚未验证。 |

Aspose Linux 文档要求检查 `libgdiplus` 等原生依赖，macOS 说明了 Python 动态库与 SkiaSharp 加载问题；这些是实际部署边界，不能只看 `pip install` 成功。[官方安装说明](https://docs.aspose.com/cells/python-net/getting-started/) 官方另有 .NET Docker 示例，但它不是本项目 Python via .NET 容器的实测证据。[Docker 文档](https://docs.aspose.com/cells/net/how-to-run-aspose-cells-in-docker/)

## 本例函数与数组：能力证据与缺口

此处“存在”只表示官方函数表或源码有实现，不表示原文件的引用、类型转换、错误处理及嵌套组合正确。

| 候选 | VLOOKUP / INDEX / MATCH | IF / IFS / IFERROR | NETWORKDAYS / COUNTIFS / EDATE | 数组与本例缺口 |
| --- | --- | --- | --- | --- |
| formulas | 三者在当前维护者源码注册。[look.py](https://github.com/vinci1it2000/formulas/blob/master/formulas/functions/look.py) | 三者及 `_XLFN.IFS` 别名在源码注册。[logic.py](https://github.com/vinci1it2000/formulas/blob/master/formulas/functions/logic.py) | 在源码注册；NETWORKDAYS 使用工作日与假日处理。[date.py](https://github.com/vinci1it2000/formulas/blob/master/formulas/functions/date.py) [stat.py](https://github.com/vinci1it2000/formulas/blob/master/formulas/functions/stat.py) | 源码使用数组结果，但仍须确认 XLSX 的 CSE 范围元数据、嵌套数组与标量返回；不能因为有 NumPy 数组就宣称完整 Excel 数组兼容。 |
| pycel | 官方历史与源码有 VLOOKUP/MATCH/INDEX。[发布历史](https://pypi.org/project/pycel/) [lookup.py](https://github.com/dgorissen/pycel/blob/master/src/pycel/lib/lookup.py) | 当前 `logical.py` 有 IF、IFS、IFERROR，含 CSE 包装。[logical.py](https://github.com/dgorissen/pycel/blob/master/src/pycel/lib/logical.py) | 本轮未逐一核实当前日期/统计实现和发布包，列为待查，不推断支持。 | 官方有 CSE 机制，但本文件具体数组组合及 Python 3.13 环境均未验收。 |
| xlcalculator | VLOOKUP 精确匹配、MATCH 有实现；官方表中 INDEX 未列为其支持。[README](https://github.com/bradbase/xlcalculator) | 当前 `logical.py` 有 IF，未见 IFS/IFERROR 注册。[logical.py](https://github.com/bradbase/xlcalculator/blob/master/xlcalculator/xlfunctions/logical.py) | 官方表有 COUNTIFS、EDATE；当前日期源码未见 NETWORKDAYS。[date.py](https://github.com/bradbase/xlcalculator/blob/master/xlcalculator/xlfunctions/date.py) | 官方明确不支持 CSE；若选它需改写或增加原公式能力，削弱引入引擎的目的。 |
| HyperFormula | 三者列在官方函数表。 | 三者列在官方函数表。 | 三者列在官方函数表。[内置函数](https://hyperformula.handsontable.com/docs/guide/built-in-functions.html) | 支持数组运算，但需 `useArrayArithmetic`/局部数组模式；源 XLSX 数组范围仍要正确转换。[数组](https://hyperformula.handsontable.com/docs/guide/arrays.html) |
| Aspose.Cells | 三者列在官方函数表。 | 三者列在官方函数表。 | 三者列在官方函数表。[支持函数](https://docs.aspose.com/cells/python-net/supported-formula-functions/) | 官方支持数组公式，尚未验证原样本中的 INDEX/MATCH 数组组合、IFERROR 掩盖错误等行为。 |

HyperFormula 文档明确存在与 Excel 的运行时差异，日期基准、1900 闰年行为、TRUE/FALSE、数组和空值等需要配置；不是放入公式就天然等价。[Excel 兼容配置](https://hyperformula.handsontable.com/docs/guide/compatibility-with-microsoft-excel.html) 原型中表名、整列引用及数组范围也不能因“函数名单全部命中”就省略验收。

工资计算必须继续用 PayLite `Decimal`。引擎给出的天数、身份或主档来源值进入规范化与校验后才保存，不让任何候选的浮点计算变成新的工资金额规则。即使引擎精确复现原表病假扣款公式，该金额仍不符合当前已确认业务口径。

## 本机合成试验：转换不等于强制重算

2026-10-10 使用本机 LibreOfficeDev 26.8.0.0.alpha0。只从示例复制必要表头与公式形状，生成三个不含真人资料的测试员工、合成主体和日历；未将原员工工作簿交给引擎。原文件前后 SHA-256 一致。

试验调用普通 `--headless --convert-to xlsx`，使用每次独立临时 profile 和不同输出目录。下面结果不能推断为 UNO `calculateAll()` 的验收。

| 试验 | 独立预期 | 实际结果 |
| --- | --- | --- |
| 无结果缓存的合成工作簿 | 18 位身份证文本、跨表姓名/公司查找、EDATE 月末处理正确；IFS 数组与 NETWORKDAYS/COUNTIFS 的三人工作日合计均 21 | 六类断言通过，工作日合计为 21/21/21 |
| 故意将 T3 缓存设为 999，并关闭文件的加载重算提示 | 依赖事实未变，应重新算出 21 | 普通转换完成但 T3 仍为 999，其他两行为 21；说明仅文件转换成功不能证明缓存刷新 |
| 改变花名册姓名并新增一个工作日假日，缓存为空 | 查找跟随姓名变化；三人应出勤均为 20 | 六类断言通过，工作日合计为 20/20/20 |

`openpyxl` 官方说明它不计算公式，`data_only=True` 只读取上次保存的结果，因此不能用输入文件缓存当独立基准。[公式说明](https://openpyxl.readthedocs.io/en/stable/simple_formulae.html) [读取选项](https://openpyxl.readthedocs.io/en/stable/tutorial.html)

LibreOffice 官方也区分 `calculateAll()` 与普通重算，并允许加载时不重新计算 Excel 文件。因此正式流程须显式强制重算，再读取本次求值结果；不能仅沿用 CLI 转换。[强制重算 API](https://api.libreoffice.org/docs/idl/ref/interfacecom_1_1sun_1_1star_1_1sheet_1_1XCalculatable.html) [加载重算设置](https://books.libreoffice.org/en/CG262/CG26216-SettingUpCustomizing.html)

原始文件始终保留；只处理任务自己的临时副本，记录引擎版本、输入/修正版本和计算证据。加载应设置不执行宏、不更新外部链接，还必须阻止外部文件或网络型公式被执行；仅设置 `UpdateDocMode` 不能替代这些依赖检查。[加载属性](https://api.libreoffice.org/docs/idl/ref/servicecom_1_1sun_1_1star_1_1document_1_1MediaDescriptor.html) [宏模式](https://api.libreoffice.org/docs/idl/ref/namespacecom_1_1sun_1_1star_1_1document_1_1MacroExecMode.html) [链接更新模式](https://api.libreoffice.org/docs/idl/ref/namespacecom_1_1sun_1_1star_1_1document_1_1UpdateDocMode.html)

本机三个小样本的完成时间不足 1 秒，但它们不含示例的 20 页及百万行尺寸，不代表真实工作簿、稳定版 Docker 的速度或内存表现。未执行 UNO 强制重算、隔离策略验收、真实样表全量重算或 Linux 容器试验，不能宣布完整兼容。

## 建议的最小选型验收

1. 从真实示例只提取结构和必要公式形状，生成不含真人资料的合成工作簿；建立独立、可人工复核的预期事实。Excel 缓存不是判定标准。
2. 覆盖同簿花名册直接引用、文本身份证精确匹配、VLOOKUP 与 INDEX/MATCH、IF/IFS/IFERROR、入转离职日期、月末/闰年 EDATE、NETWORKDAYS 放假与周末补班、COUNTIFS 及原样数组范围。补充空值、查无/重复身份、错误值和缺引用。
3. 验证必要输入可以单独失败、无关薪资公式错误不阻断、外部链接不联网/不读取外部文件、宏不执行；覆盖百万行声明尺寸但很少有效内容、超时和异常进程退出。
4. 在当前 Python 3.13、本机 macOS 与目标 Linux Docker 架构运行同一组断言；记录实际用时和内存，不提前写未经测量的性能承诺。
5. 对通过的候选锁定版本与配置，记录原公式/原坐标/值/引擎版本；完成真实上传和纠错接口回归，再决定是否替换现有公式部分。

本轮没有安装和实跑五个候选库，也没有真实工作簿全量重算；只完成上述本机合成试验。因此没有给出任何“完全兼容 Excel”的结论，普通转换路径的旧缓存反例必须纳入正式回归。
