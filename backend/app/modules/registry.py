"""Round-module registry (server side). Maps module type -> module instance.

Adding a game mode = registering a module here; the contest engine is never touched.
Empty in M0; modules register starting in M2.
"""

from __future__ import annotations

from app.modules.base import RoundModule

_REGISTRY: dict[str, RoundModule] = {}


def register(module: RoundModule) -> None:
    if module.type in _REGISTRY:
        raise ValueError(f"Round module already registered: {module.type!r}")
    _REGISTRY[module.type] = module


def get_module(module_type: str) -> RoundModule:
    return _REGISTRY[module_type]


def all_modules() -> dict[str, RoundModule]:
    return dict(_REGISTRY)
