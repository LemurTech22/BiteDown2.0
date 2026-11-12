import pytest


def _assert_cors_headers(response, origin):
    assert response.headers["Access-Control-Allow-Origin"] == origin
    allowed_headers = {
        value.strip().lower()
        for value in response.headers["Access-Control-Allow-Headers"].split(",")
    }
    assert {"authorization", "content-type"} <= allowed_headers
    allowed_methods = {
        value.strip()
        for value in response.headers["Access-Control-Allow-Methods"].split(",")
    }
    assert {"POST", "PATCH", "DELETE"} <= allowed_methods
    assert "Access-Control-Allow-Credentials" not in response.headers
    assert "origin" in {
        value.strip().lower()
        for value in ",".join(response.headers.getlist("Vary")).split(",")
    }


@pytest.mark.parametrize("origin", ["https://web.example", "http://localhost:8081"])
def test_allowed_origin(app, client, monkeypatch, origin):
    monkeypatch.setitem(app.config, "CORS_ORIGINS", "https://web.example,http://localhost:8081")
    response = client.get("/health", headers={"Origin": origin})
    assert response.status_code == 200
    _assert_cors_headers(response, origin)


def test_allowed_origin_on_unauthorized_response(app, client, monkeypatch):
    monkeypatch.setitem(app.config, "CORS_ORIGINS", "https://web.example,http://localhost:8081")
    response = client.get("/items", headers={"Origin": "https://web.example"})
    assert response.status_code == 401
    assert response.is_json
    _assert_cors_headers(response, "https://web.example")


@pytest.mark.parametrize("origin", ["https://evil.example", "http://localhost:8082"])
def test_disallowed_origin(app, client, monkeypatch, origin):
    monkeypatch.setitem(app.config, "CORS_ORIGINS", "https://web.example,http://localhost:8081")
    response = client.get("/health", headers={"Origin": origin})
    assert "Access-Control-Allow-Origin" not in response.headers


def test_allowed_preflight(app, client, monkeypatch):
    monkeypatch.setitem(app.config, "CORS_ORIGINS", "https://web.example,http://localhost:8081")
    response = client.options("/items", headers={
        "Origin": "https://web.example", "Access-Control-Request-Method": "POST",
    })
    assert response.status_code == 204
    _assert_cors_headers(response, "https://web.example")


def test_disallowed_preflight(app, client, monkeypatch):
    monkeypatch.setitem(app.config, "CORS_ORIGINS", "https://web.example,http://localhost:8081")
    response = client.options("/items", headers={
        "Origin": "https://evil.example", "Access-Control-Request-Method": "POST",
    })
    assert "Access-Control-Allow-Origin" not in response.headers


def test_empty_origins_disables_cors(app, client, monkeypatch):
    monkeypatch.setitem(app.config, "CORS_ORIGINS", "")
    response = client.get("/health", headers={"Origin": "https://web.example"})
    assert not any(name.lower().startswith("access-control-") for name in response.headers.keys())


def test_no_origin_header(app, client, monkeypatch):
    monkeypatch.setitem(app.config, "CORS_ORIGINS", "https://web.example,http://localhost:8081")
    response = client.get("/health")
    assert "Access-Control-Allow-Origin" not in response.headers
