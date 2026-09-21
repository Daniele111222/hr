# 本项目环境记忆

- Windows 11 当前会出现 Python 进程无法启动：系统 `python`/`py` 不可用，仓库 `.venv\Scripts\python.exe` 和 `C:\Users\31681\AppData\Local\Programs\Python\Python313\python.exe` 会返回“拒绝访问/无法创建进程”。
- 诊断时可使用仓库虚拟环境中的独立工具（例如 `backend` 目录下执行 `..\.venv\Scripts\ruff.exe`），因此 Ruff 静态检查仍可运行；pytest 需要 Python 解释器，不能把该环境阻塞误报为测试失败。
- 前端在 `frontend` 目录优先直接调用 `node_modules\.bin\tsc.cmd`、`node_modules\.bin\vite.cmd`；`pnpm exec` 在当前 pnpm shim 环境下可能找不到本地命令。
- 后端 pytest 在提升权限启动 `.venv\Scripts\python.exe` 后可运行；普通权限会出现无法创建进程。当前无 `PAYLITE_TEST_DATABASE_URL` 时，PostgreSQL 集成测试会按设计跳过。
- Windows 当前管理性排除 TCP 端口 `55386-55685`，因此 docker-compose 的 `55432` 以及测试备用端口 `55433` 都无法映射。机器上的 `finances-postgres-1` 属于其他财务项目，没有 `paylite_test` 数据库，不要将 PayLite 测试迁移写入该实例。
- 前端命令可能因 Windows 对 `frontend/node_modules/.pnpm` 下脚本返回 `EPERM` 而失败；先确认 Node/pnpm 版本满足 `frontend/package.json`（Node 24.21.x、pnpm 12.4.2），再关闭占用文件的进程并重新安装依赖。当前环境实测 Node 24.19.0、pnpm 11.19.0，`tsc`/`vitest` 启动均被 EPERM 阻断，不能据此判断前端代码失败。
