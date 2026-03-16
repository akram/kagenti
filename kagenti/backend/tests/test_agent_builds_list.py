# Copyright 2025 IBM Corp.
# Licensed under the Apache License, Version 2.0

"""
Unit tests for the list agent builds endpoint (GET /agents/builds).

Tests cover:
- Response shape and only agent builds returned
- Builds with and without BuildRuns
- Empty namespace
- 403 on list_custom_resources
"""

from unittest.mock import MagicMock, patch

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from kubernetes.client import ApiException

from app.core.constants import KAGENTI_TYPE_LABEL, RESOURCE_TYPE_AGENT
from app.routers.agents import router
from app.services.kubernetes import get_kubernetes_service


def _make_build(name: str, namespace: str = "team1", git_url: str = "https://github.com/example/repo", revision: str = "main") -> dict:
    """Minimal Shipwright Build resource for agents."""
    return {
        "metadata": {
            "name": name,
            "namespace": namespace,
            "labels": {KAGENTI_TYPE_LABEL: RESOURCE_TYPE_AGENT},
        },
        "spec": {
            "source": {
                "git": {"url": git_url, "revision": revision},
                "contextDir": ".",
            },
        },
        "status": {"registered": True},
    }


def _make_buildrun(build_name: str, run_suffix: str, phase: str = "Succeeded", failure_message: str = None) -> dict:
    """Minimal BuildRun resource."""
    status = {
        "conditions": [{"type": "Succeeded", "status": "True" if phase == "Succeeded" else "False", "message": failure_message or ""}],
        "startTime": "2026-01-01T10:00:00Z",
        "completionTime": "2026-01-01T10:01:00Z" if phase in ("Succeeded", "Failed") else None,
        "output": {"image": "registry.local/img:tag", "digest": "sha256:abc"},
    }
    if phase == "Failed" and failure_message:
        status["conditions"][0]["message"] = failure_message
    return {
        "metadata": {
            "name": f"{build_name}-run-{run_suffix}",
            "creationTimestamp": "2026-01-01T10:00:00Z",
        },
        "status": status,
    }


@pytest.fixture
def client():
    """Test client with agents router."""
    app = FastAPI()
    app.include_router(router, prefix="/api/v1")
    return TestClient(app)


@pytest.fixture
def mock_kube():
    """Mock KubernetesService."""
    kube = MagicMock()
    kube.list_custom_resources.return_value = []
    return kube


class TestListAgentBuilds:
    """Tests for GET /api/v1/agents/builds."""

    def test_empty_namespace_returns_empty_list(self, client, mock_kube):
        """When there are no builds, returns items=[]."""
        mock_kube.list_custom_resources.return_value = []
        client.app.dependency_overrides[get_kubernetes_service] = lambda: mock_kube
        try:
            with patch("app.core.auth.settings") as auth_settings:
                auth_settings.enable_auth = False
                response = client.get("/api/v1/agents/builds?namespace=team1")
            assert response.status_code == 200
            data = response.json()
            assert "items" in data
            assert data["items"] == []
        finally:
            client.app.dependency_overrides.pop(get_kubernetes_service, None)

    def test_returns_builds_with_buildruns(self, client, mock_kube):
        """Returns build summaries with buildRuns populated."""
        builds = [_make_build("my-agent", namespace="team1")]
        buildruns = [
            _make_buildrun("my-agent", "abc12", phase="Succeeded"),
        ]
        mock_kube.list_custom_resources.side_effect = [builds, buildruns]

        client.app.dependency_overrides[get_kubernetes_service] = lambda: mock_kube
        try:
            with patch("app.core.auth.settings") as auth_settings:
                auth_settings.enable_auth = False
                response = client.get("/api/v1/agents/builds?namespace=team1")
            assert response.status_code == 200
            data = response.json()
            assert len(data["items"]) == 1
            item = data["items"][0]
            assert item["buildName"] == "my-agent"
            assert item["namespace"] == "team1"
            assert item["buildRegistered"] is True
            assert item["gitUrl"] == "https://github.com/example/repo"
            assert item["gitRevision"] == "main"
            assert item["agentName"] == "my-agent"
            assert len(item["buildRuns"]) == 1
            br = item["buildRuns"][0]
            assert br["name"] == "my-agent-run-abc12"
            assert br["phase"] == "Succeeded"
            assert br["startTime"] == "2026-01-01T10:00:00Z"
            assert br["completionTime"] == "2026-01-01T10:01:00Z"
        finally:
            client.app.dependency_overrides.pop(get_kubernetes_service, None)

    def test_build_with_no_buildruns(self, client, mock_kube):
        """Build with no BuildRuns returns empty buildRuns list."""
        builds = [_make_build("orphan-build")]
        mock_kube.list_custom_resources.side_effect = [builds, []]  # second call = list buildruns

        client.app.dependency_overrides[get_kubernetes_service] = lambda: mock_kube
        try:
            with patch("app.core.auth.settings") as auth_settings:
                auth_settings.enable_auth = False
                response = client.get("/api/v1/agents/builds?namespace=team1")
            assert response.status_code == 200
            data = response.json()
            assert len(data["items"]) == 1
            assert data["items"][0]["buildRuns"] == []
        finally:
            client.app.dependency_overrides.pop(get_kubernetes_service, None)

    def test_403_on_list_builds_returns_403(self, client, mock_kube):
        """When list_custom_resources raises 403, endpoint returns 403."""
        exc = ApiException(status=403, reason="Forbidden")
        exc.status = 403
        mock_kube.list_custom_resources.side_effect = exc

        client.app.dependency_overrides[get_kubernetes_service] = lambda: mock_kube
        try:
            with patch("app.core.auth.settings") as auth_settings:
                auth_settings.enable_auth = False
                response = client.get("/api/v1/agents/builds?namespace=team1")
            assert response.status_code == 403
        finally:
            client.app.dependency_overrides.pop(get_kubernetes_service, None)
