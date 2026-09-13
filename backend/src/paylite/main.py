from fastapi import FastAPI

from paylite import __version__
from paylite.config import get_settings

settings = get_settings()
app = FastAPI(title=settings.app_name, version=__version__)


@app.get("/health", tags=["system"])
def health() -> dict[str, str]:
    return {"status": "ok"}
