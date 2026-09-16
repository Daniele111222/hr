from fastapi import FastAPI

from paylite import __version__
from paylite.api.system import router as system_router
from paylite.config import Settings, get_settings


def create_app(settings: Settings | None = None) -> FastAPI:
    resolved_settings = settings or get_settings()
    application = FastAPI(title=resolved_settings.app_name, version=__version__)
    application.include_router(system_router)
    return application
