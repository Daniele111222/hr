from fastapi import FastAPI

from paylite import __version__
from paylite.api.employees import router as employees_router
from paylite.api.errors import install_error_handlers
from paylite.api.imports import router as imports_router
from paylite.api.organization import router as organization_router
from paylite.api.payroll import router as payroll_router
from paylite.api.rules import router as rules_router
from paylite.api.system import router as system_router
from paylite.config import Settings, get_settings


def create_app(settings: Settings | None = None) -> FastAPI:
    resolved_settings = settings or get_settings()
    application = FastAPI(title=resolved_settings.app_name, version=__version__)
    application.include_router(system_router)
    application.include_router(organization_router)
    application.include_router(rules_router)
    application.include_router(employees_router)
    application.include_router(imports_router)
    application.include_router(payroll_router)
    install_error_handlers(application)
    return application
