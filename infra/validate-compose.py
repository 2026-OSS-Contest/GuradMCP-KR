#!/usr/bin/env python3
"""Offline structural validation used when the Docker CLI is unavailable."""

from __future__ import annotations

import pathlib
import sys

import yaml


REQUIRED_SERVICES = {
    "postgres",
    "postgres-seed",
    "redis",
    "redis-seed",
    "gateway",
    "control-plane",
    "console",
    "demo-agent",
    "demo-mcp-tools",
    "demo-agent-dev",
    "demo-mcp-tools-dev",
}


def fail(message: str) -> None:
    raise SystemExit(f"Compose validation failed: {message}")


def main() -> None:
    path = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else "docker-compose.yml")
    document = yaml.safe_load(path.read_text(encoding="utf-8"))
    if not isinstance(document, dict):
        fail("document root must be a mapping")

    services = document.get("services")
    if not isinstance(services, dict):
        fail("services must be a mapping")

    missing = sorted(REQUIRED_SERVICES - set(services))
    if missing:
        fail(f"required services missing: {', '.join(missing)}")

    for name, service in services.items():
        if not isinstance(service, dict):
            fail(f"service {name!r} must be a mapping")
        health_required = name not in {"postgres-seed", "redis-seed"}
        if health_required and "healthcheck" not in service:
            fail(f"service {name!r} has no healthcheck")

    if services["demo-agent"].get("profiles") != ["demo"]:
        fail("demo-agent must be isolated in the demo profile")
    if services["demo-mcp-tools"].get("profiles") != ["demo"]:
        fail("demo-mcp-tools must be isolated in the demo profile")
    if services["demo-agent-dev"].get("profiles") != ["dev"]:
        fail("demo-agent-dev must be isolated in the dev profile")
    if services["demo-mcp-tools-dev"].get("profiles") != ["dev"]:
        fail("demo-mcp-tools-dev must be isolated in the dev profile")

    for name in ("gateway", "control-plane", "console", "demo-agent", "demo-mcp-tools"):
        build = services[name].get("build", {})
        dockerfile = build.get("dockerfile") if isinstance(build, dict) else None
        if not dockerfile or not (path.parent / dockerfile).is_file():
            fail(f"service {name!r} references a missing Dockerfile")

    print(
        "Offline Compose validation passed: "
        f"{len(services)} services, deterministic seed jobs, demo/dev profiles, health checks."
    )


if __name__ == "__main__":
    main()

