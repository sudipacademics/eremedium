"""API-surface tests: the internal token gate and the HTTP contract.

The compute service is reachable through nginx, and nothing in front of it authenticates a user. The
token check is therefore the only thing standing between the ephemeris engine and the open internet,
which makes it worth a test of its own.
"""

import importlib
import os
from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient

TOKEN = "test-internal-token-long-enough"

BIRTH_PAYLOAD = {
    "dob_utc": "1994-08-16T22:15:00+00:00",
    "latitude": 25.317645,
    "longitude": 83.005495,
}


def _client_with_token(token: str | None) -> TestClient:
    """Rebuilds the app so the settings cache picks up the environment for this test."""
    if token is None:
        os.environ.pop("INTERNAL_SERVICE_TOKEN", None)
    else:
        os.environ["INTERNAL_SERVICE_TOKEN"] = token

    from app import config

    config.get_settings.cache_clear()
    main = importlib.reload(importlib.import_module("app.main"))
    return TestClient(main.app)


@pytest.fixture
def guarded_client() -> Iterator[TestClient]:
    previous = os.environ.get("INTERNAL_SERVICE_TOKEN")
    client = _client_with_token(TOKEN)
    yield client
    if previous is None:
        os.environ.pop("INTERNAL_SERVICE_TOKEN", None)
    else:
        os.environ["INTERNAL_SERVICE_TOKEN"] = previous
    from app import config

    config.get_settings.cache_clear()


class TestTheInternalTokenGate:
    def test_a_request_with_no_token_is_refused(self, guarded_client: TestClient) -> None:
        response = guarded_client.post("/api/v1/astro/natal-chart", json=BIRTH_PAYLOAD)
        assert response.status_code == 401

    def test_a_wrong_token_is_refused(self, guarded_client: TestClient) -> None:
        response = guarded_client.post(
            "/api/v1/astro/natal-chart",
            json=BIRTH_PAYLOAD,
            headers={"x-internal-token": "not-the-token"},
        )
        assert response.status_code == 401

    def test_the_ayurveda_router_is_guarded_too(self, guarded_client: TestClient) -> None:
        assert guarded_client.get("/api/v1/ayurveda/prakriti-parameters").status_code == 401

    def test_health_stays_open_so_the_orchestrator_can_probe_it(self, guarded_client: TestClient) -> None:
        response = guarded_client.get("/healthz")
        assert response.status_code == 200
        assert response.json()["ayanamsha"] == "CHITRA_PAKSHA_LAHIRI"

    def test_the_correct_token_is_accepted(self, guarded_client: TestClient) -> None:
        response = guarded_client.post(
            "/api/v1/astro/natal-chart",
            json=BIRTH_PAYLOAD,
            headers={"x-internal-token": TOKEN},
        )
        # 200 with ephemeris data present, 422 without it; either proves the gate let the call past.
        assert response.status_code in (200, 422)


class TestTheHttpContract:
    def test_a_malformed_body_is_a_422_not_a_500(self, guarded_client: TestClient) -> None:
        response = guarded_client.post(
            "/api/v1/astro/natal-chart",
            json={"dob_utc": "not-a-date", "latitude": 25.3, "longitude": 83.0},
            headers={"x-internal-token": TOKEN},
        )
        assert response.status_code == 422

    def test_a_naive_timestamp_is_refused_over_http(self, guarded_client: TestClient) -> None:
        response = guarded_client.post(
            "/api/v1/astro/natal-chart",
            json={**BIRTH_PAYLOAD, "dob_utc": "1994-08-16T22:15:00"},
            headers={"x-internal-token": TOKEN},
        )
        assert response.status_code == 422

    def test_the_prakriti_questionnaire_is_the_documented_28_parameters(
        self, guarded_client: TestClient
    ) -> None:
        response = guarded_client.get(
            "/api/v1/ayurveda/prakriti-parameters",
            headers={"x-internal-token": TOKEN},
        )
        assert response.status_code == 200
        assert len(response.json()["parameters"]) == 28

    def test_an_incomplete_questionnaire_is_refused(self, guarded_client: TestClient) -> None:
        """Scoring 3 of 28 answers would return a confident percentage from almost no data."""
        response = guarded_client.post(
            "/api/v1/ayurveda/prakriti-score",
            json={"responses": {"body_frame": "VATA"}},
            headers={"x-internal-token": TOKEN},
        )
        assert response.status_code == 422
