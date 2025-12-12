"""
Illustrative Temporal workflow/activity showing how to execute a Salam ingestion plan.

This code is provided as a template. Copy it into your deployment repository, adjust
logging/metrics/secrets, and package it with your Temporal worker. The Temporal SDK
is an optional dependency here; the import is wrapped so the file can be linted
without the SDK installed.
"""

from __future__ import annotations

import asyncio
import os
import subprocess
from dataclasses import dataclass
from typing import Iterable, Sequence, Any

activity: Any
workflow: Any

@dataclass
class RetryPolicy:
    initial_interval: object
    maximum_attempts: int | None = None


try:  # pragma: no cover - runtime-only import
    from temporalio import activity as _activity, workflow as _workflow
    activity = _activity
    workflow = _workflow
except Exception:  # pragma: no cover - allow docs/tests without Temporal
    class _WorkflowStub:
        RetryPolicy = RetryPolicy

        @staticmethod
        def timedelta(*args, **kwargs):
            import datetime
            return datetime.timedelta(*args, **kwargs)

    activity = object()
    workflow = _WorkflowStub()

@dataclass
class IngestionPayload:
    execution_command: Sequence[str]
    environment: dict[str, str] | None = None
    schedule_info: dict | None = None
    retries: dict | None = None
    alerts: dict | None = None


async def _run_command(command: Iterable[str], env: dict[str, str] | None = None) -> int:
    merged_env = os.environ.copy()
    if env:
        merged_env.update(env)
    process = await asyncio.create_subprocess_exec(
        *command,
        env=merged_env,
    )
    return await process.wait()


if activity:

    @activity.defn(name="RunIngestionCommand")
    async def run_ingestion_command(payload: IngestionPayload) -> None:  # pragma: no cover - executed in worker
        exit_code = await _run_command(payload.execution_command, payload.environment)
        if exit_code != 0:
            raise RuntimeError(f"Ingestion command failed with exit code {exit_code}")


if workflow:

    @workflow.defn(name="IngestionWorkflow")
    class IngestionWorkflow:  # pragma: no cover - executed in worker
        @workflow.run
        async def run(self, payload: IngestionPayload) -> None:
            await workflow.execute_activity(
                run_ingestion_command,
                payload,
                schedule_to_close_timeout=workflow.timedelta(minutes=120),
                retry_policy=workflow.RetryPolicy(
                    initial_interval=workflow.timedelta(seconds=payload.retries.get("initial_interval_seconds", 60))
                    if payload.retries
                    else workflow.timedelta(seconds=60),
                    maximum_attempts=payload.retries.get("maximum_attempts") if payload.retries else None,
                ),
            )
