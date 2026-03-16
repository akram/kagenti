# Copyright 2025 IBM Corp.
# Licensed under the Apache License, Version 2.0

"""
Shared exception handling utilities.
"""

from fastapi import HTTPException
from kubernetes.client import ApiException

RBAC_FORBIDDEN_DETAIL = "Permission denied. Check RBAC configuration."


def raise_http_from_api_exception(
    e: ApiException,
    forbidden_detail: str = RBAC_FORBIDDEN_DETAIL,
) -> None:
    """Convert Kubernetes ApiException to FastAPI HTTPException.

    Uses a dedicated message for 403 (forbidden); otherwise maps status and reason.
    """
    if e.status == 403:
        raise HTTPException(status_code=403, detail=forbidden_detail)
    raise HTTPException(status_code=e.status, detail=str(e.reason))
