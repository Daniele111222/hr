import pytest
from fastapi.testclient import TestClient

from paylite.application import create_app
from paylite.config import Settings


def test_local_frontend_deep_link_and_same_origin_api(tmp_path):
    (tmp_path / "assets").mkdir()
    (tmp_path / "assets" / "app.js").write_text("console.log('local');")
    (tmp_path / "index.html").write_text("<html>PayLite 本机页面</html>")
    with TestClient(create_app(Settings(frontend_directory=tmp_path))) as client:
        for path in ["/", "/payroll/ledger/records/5", "/employees"]:
            response = client.get(path)
            assert response.status_code == 200
            assert "PayLite 本机页面" in response.text
        assert client.get("/assets/app.js").text == "console.log('local');"
        assert client.get("/api/health").json() == client.get("/health").json()
        assert client.get("/api/nonexistent").status_code == 404
        assert client.get("/assets/nonexistent.js").status_code == 404
        assert "/api/health" in client.get("/openapi.json").json()["paths"]


def test_local_frontend_requires_build(tmp_path):
    with pytest.raises(RuntimeError, match="前端构建文件不存在"):
        create_app(Settings(frontend_directory=tmp_path))


def test_api_only_development_also_supports_vite_api_prefix():
    with TestClient(create_app(Settings(frontend_directory=None))) as client:
        assert client.get("/api/health").json() == client.get("/health").json()
        assert "/api/health" not in client.get("/openapi.json").json()["paths"]
