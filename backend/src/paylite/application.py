from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from paylite import __version__
from paylite.api.employees import router as employees_router
from paylite.api.errors import install_error_handlers
from paylite.api.exports import router as exports_router
from paylite.api.imports import router as imports_router
from paylite.api.organization import router as organization_router
from paylite.api.payroll import router as payroll_router
from paylite.api.rules import router as rules_router
from paylite.api.system import router as system_router
from paylite.config import Settings, get_settings


def create_app(settings: Settings | None = None) -> FastAPI:
    resolved_settings = settings or get_settings()
    application = FastAPI(title=resolved_settings.app_name, version=__version__)
    routers = (
        system_router,
        organization_router,
        rules_router,
        employees_router,
        imports_router,
        payroll_router,
        exports_router,
    )
    prefix = "/api" if resolved_settings.frontend_directory is not None else ""
    for router in routers:
        application.include_router(router, prefix=prefix)
        if not prefix:
            application.include_router(router, prefix="/api", include_in_schema=False)
    if resolved_settings.frontend_directory is not None:
        frontend = resolved_settings.frontend_directory.resolve()
        if not (frontend / "index.html").is_file():
            raise RuntimeError("前端构建文件不存在，请先执行 frontend 的 npm run build")
        application.include_router(system_router, include_in_schema=False)
        application.mount("/assets", StaticFiles(directory=frontend / "assets"), name="assets")

        @application.get("/{path:path}", include_in_schema=False)
        def frontend_page(path: str):
            if path == "api" or path.startswith("api/"):
                raise HTTPException(404, "接口不存在")
            return FileResponse(frontend / "index.html")

    install_error_handlers(application)
    return application
