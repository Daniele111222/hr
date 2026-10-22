# WB02 正式 Excel 引擎部署验证

**验证日期：** 2026-10-10；环境复核：2026-10-11。

**结论：** 推荐固定 Debian 安全源正式 LibreOffice/UNO，显式调用 `calculateAll()`。已在现有后端镜像衍生的独立 Linux arm64 容器完成必要公式、陈旧缓存和来源修正的合成验证。`formulas==1.3.4` 有真实整列查找反例，不作为本需求首选。这里只证明选型可行，尚未证明产品上传链路和安全隔离验收完成。

## 实际环境和部署方式

| 项目 | 实测结果 |
| --- | --- |
| 基础镜像 | 本机已有 `hr-backend:latest`（当时 ID `91e46fad3747`），未拉取新基础镜像 |
| 系统 | Debian GNU/Linux 13 / trixie，Linux aarch64 |
| 业务 Python | `/usr/local/bin/python`，3.13.16 |
| UNO Python | Debian `/usr/bin/python3`，3.13.5 |
| 正式包 | `libreoffice-calc=4:25.2.3-2+deb13u8`、`python3-uno=4:25.2.3-2+deb13u8` |
| 引擎报告 | `LibreOffice 25.2.3.2 520(Build:2)` |
| 安装成本 | `--no-install-recommends`：177 个新增包，133 MB 下载，491 MB 新增磁盘空间 |
| 运行路径 | UNO helper 用系统 Python；主服务继续使用现有 Python，不在主服务解释器中硬塞 pyuno |

官方 Debian 页面确认这两个版本是 trixie 的安全更新，并提供 arm64 包；python3-uno 依赖系统 Python 3.13。[Calc 包](https://packages.debian.org/trixie/libreoffice-calc)、[UNO 包](https://packages.debian.org/trixie/python3-uno)

这条路径不依赖 Codex 私有运行时、开发版 LibreOffice 或用户桌面 Excel。正式 Dockerfile 应固定发行版及验收过的包版本，并把更新后的版本重新纳入回归。软件源可能替换旧安全修订，构建失败应显式处理，不能静默安装另一个版本。

## 合成验证及独立预期

只生成三名合成员工和四张工作表（花名册、考勤表、法定假日列表、工资明细），没有读取真人数据、上传用户文件、连接数据库或修改业务容器。必要公式复现既有原式形状：中文表名、整列引用、VLOOKUP 通配符、INDEX/MATCH、EDATE、EOMONTH、IFS CSE 数组、NETWORKDAYS、COUNTIFS。

预期工作日通过 Python 的逐日 `weekday()` 加减合成假日与补班独立确定：2026 年 8 月有 21 个周一至周五工作日；排除 8 月 12 日并增加周六 8 月 15 日补班，合计仍为 21；再排除 8 月 13 日后为 20。身份证为手写 18 位文本 `11010120000101002X`，EDATE 独立预期为 2026-01-31 加三个月得到 2026-04-30。输入缓存不作为预期来源。

每个文件使用独立 profile、随机 UNO pipe，加载后显式 `doc.calculateAll()`，再写到新输出路径；在计算前断开自有容器网络。保存后用 openpyxl `data_only=True` 对本次输出做断言。

| 输入 | 预期 | 实际及断言 |
| --- | --- | --- |
| fresh：无结果缓存 | 三人应出勤均 21；身份文本、姓名、主体、EDATE 正确 | 全部通过；0.267 秒 |
| stale：T3 缓存故意写为 999，关闭 fullCalcOnLoad/forceFullCalc | 必须重新得到 21，不采用 999 | 全部通过；三人 21/21/21；0.284 秒 |
| changed：修改花名册姓名并新增 8 月 13 日假日 | 查找返回新姓名；三人应出勤均 20 | 全部通过；0.265 秒 |
| 无关工资页 `=1/0` | 保持错误，但不能污染合法考勤结果 | 输出为 `#DIV/0!`；三种文件必要输出仍通过 |

表内时间是最后一次使用官方 `NEVER_EXECUTE` 常量重跑的单次小样耗时，不是大工作簿性能承诺。三个案例各有六组保存后断言。此前同样合成案例在普通 CLI 转换下保留 999 的失败仍然有效，不能用转换成功替代本次 `calculateAll()`。[官方强制重算 API](https://api.libreoffice.org/docs/idl/ref/interfacecom_1_1sun_1_1star_1_1sheet_1_1XCalculatable.html)

## formulas 正式包反例

隔离 macOS Python 3.13.15 环境成功安装 `formulas==1.3.4`，依赖包括 schedula 1.6.15、numpy 2.5.3、scipy 1.18.1、openpyxl 3.1.5。没有修改项目依赖。安装和运行成功不代表目标 Linux 已验收。[正式发行包](https://pypi.org/project/formulas/1.3.4/)

- 将合成查找范围缩小为 `B2:D4`、`B2:B4`、`F2:F4` 时，身份证、姓名、主体、日期、IFS 和应出勤结果通过；约 0.415 秒。
- 保留原形整列 `INDEX(花名册!D:D,MATCH(A3,花名册!B:B,0))` 及日期查找时，主体、日期和其下游 IFS/工作日返回 `#VALUE!`；一次耗时 26.513 秒。VLOOKUP 的身份证和姓名仍正确。
- 另一轮较完整合成表的整列计算长时间无输出，已终止自己的探针；不将其写成准确超时指标。

因此此包需要额外裁剪引用等适配才可能使用。该适配可能改变公式语义，且没有通过本需求原式验收，本轮不继续集成多个引擎。

## 安全边界与正式接入要求

1. 加载属性用官方常量：`MacroExecutionMode=NEVER_EXECUTE`（值 **0**），`UpdateDocMode=NO_UPDATE`（值 **0**），并设置 Hidden；不要用魔法数字 4，4 实际是 `ALWAYS_EXECUTE_NO_WARN`。最后一次验证已使用正确官方宏常量重跑，输入本来不含宏。[宏模式](https://api.libreoffice.org/docs/idl/ref/namespacecom_1_1sun_1_1star_1_1document_1_1MacroExecMode.html)、[链接模式](https://api.libreoffice.org/docs/idl/ref/namespacecom_1_1sun_1_1star_1_1document_1_1UpdateDocMode.html)
2. `NO_UPDATE` 不能证明阻止所有外部文件或网络型公式。产品必须先构造临时计算副本：只保留有效输入及必要依赖；外部工作簿/文件引用、外部 defined name、DDE、WEBSERVICE、RTD、动态引用如 INDIRECT 及未知函数依赖不能进入引擎。必要依赖命中时定位对应输入错误；无关页外部链接从临时副本排除，原文件仅作追溯保留，不能整份拒绝无依赖的合法考勤。
3. 采用明确公式/引用允许规则，并保留原坐标；不能只靠关键词黑名单。原式中的通配符查找成功也不能替代业务层对完整身份证、唯一性、姓名、主体的严格校验。
4. 引擎进程使用任务独立目录、profile、pipe、新输出文件和受限资源；超时终止整个进程组并清理。引擎启动、calculateAll、输出不存在/错误时不读取旧输出或输入缓存，不得写业务数据。
5. 正式运行须具备文件读取及网络隔离，不能让本地 Excel 引擎继承数据库密码或任意宿主目录访问。此次**断网容器运行**证明无网络条件下必要公式可工作，尚未测试攻击性外部依赖、宏载荷、超时和崩溃；上述安全策略需由产品实现及接口测试证明。
6. 引擎只提供事实来源值；金额校验和工资计算继续由项目 Decimal 规则完成。只读取必要输出错误，不以无关工资页全无错为导入条件。

## 探针产物、环境现状和复用

原探针路径：

- `/private/tmp/paylite-stable-engine-probe/generate.py`：纯合成工作簿与独立预期。
- `/private/tmp/paylite-stable-engine-probe/uno_recalc.py`：三文件 calculateAll。
- `/private/tmp/paylite-stable-engine-probe/{fresh,stale,changed}.xlsx` 及 `uno-*.xlsx`。
- `uno-results.json`、`verified-results.json`、`formulas-results.json`。
- `/private/tmp/paylite-formulas-venv`：隔离 Python 包。
- `/private/tmp/paylite-uno-install.log`：正式包安装记录。

**2026-10-11 复核：上述临时目录、文件及 venv 已在环境恢复后消失，不能声称这些路径当前仍可直接运行。** 历史实测数值来自本聊天工具输出。本笔记保留结果与下面的可复用 UNO 调用，正式功能测试应创建自己持久化的合成 fixture。

保留的自有容器名：`paylite-uno-runtime-probe`。复核时 `docker inspect` 为 `exited`、ExitCode **100**，没有网络，绑定 `/private/tmp:/probe`。不要直接 start：它的旧入口会重新 apt-get，且末尾日志已有 DNS 失败。只读 `docker cp` 的 dpkg 状态证明 python3-uno 和 libreoffice-core 的上述版本仍 installed；calc 已成为 config-files，calc-nogui 同版 installed（此前试探的包替换）。**本笔记性能/兼容结论对应替换前正式 calc，不将当前 nogui 宣称为通过验收。** 当前容器保留供恢复时检查，不删除，不触碰业务容器。

```bash
export DOCKER_HOST=unix:///Users/hyperchain/.rd/docker.sock
docker inspect paylite-uno-runtime-probe
docker cp paylite-uno-runtime-probe:/var/lib/dpkg/status /private/tmp/paylite-uno-dpkg-status
# 正式实现验收应使用新生成合成 fixture 和已经验收的正式构建镜像。
# 安装命令（仅供独立构建阶段，不能在业务运行容器内临时安装）：
apt-get update
apt-get install -y --no-install-recommends \
  libreoffice-calc=4:25.2.3-2+deb13u8 python3-uno=4:25.2.3-2+deb13u8
```

最小 UNO 调用顺序（helper 使用 `/usr/bin/python3`；外层必须负责超时、资源和安全隔离）：

```python
import uno
from com.sun.star.beans import PropertyValue

def prop(name, value):
    p = PropertyValue()
    p.Name, p.Value = name, value
    return p

# 独立启动 soffice --headless --nologo --nodefault --norestore
# -env:UserInstallation=file:///任务独立profile
# --accept=pipe,name=随机任务pipe;urp;StarOffice.ComponentContext
local = uno.getComponentContext()
resolver = local.ServiceManager.createInstanceWithContext(
    'com.sun.star.bridge.UnoUrlResolver', local
)
remote = resolver.resolve('uno:pipe,name=随机任务pipe;urp;StarOffice.ComponentContext')
desktop = remote.ServiceManager.createInstanceWithContext(
    'com.sun.star.frame.Desktop', remote
)
doc = desktop.loadComponentFromURL(input_uri, '_blank', 0, (
    prop('Hidden', True),
    prop('ReadOnly', False),
    prop('MacroExecutionMode', uno.getConstantByName(
        'com.sun.star.document.MacroExecMode.NEVER_EXECUTE')),
    prop('UpdateDocMode', uno.getConstantByName(
        'com.sun.star.document.UpdateDocMode.NO_UPDATE')),
))
if doc is None:
    raise RuntimeError('Workbook load failed')
try:
    doc.calculateAll()
    doc.storeAsURL(output_uri, (
        prop('FilterName', 'Calc MS Excel 2007 XML'), prop('Overwrite', True)
    ))
finally:
    doc.close(True)
```

## 未验证事项

尚未验证真实上传/纠错接口、目标最终构建镜像、真实样本规模与最大内存、百万行声明尺寸、攻击性宏/外部文件/网络公式、并发及引擎异常后的无业务写入。未运行数据库测试或更改产品代码；nogui 与其他引擎不继续扩展。本结果用于 WB02 接入选型，不能代替功能完整验收。
