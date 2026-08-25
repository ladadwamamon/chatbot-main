"""Tiny in-memory response cache to avoid repeat Gemini calls."""

from __future__ import annotations

from collections import OrderedDict
from threading import Lock


class ResponseCache:
    def __init__(self, max_size: int = 200):
        self.max_size = max_size
        self._data: OrderedDict[str, str] = OrderedDict()
        self._lock = Lock()

    def get(self, key: str) -> str | None:
        with self._lock:
            if key not in self._data:
                return None
            self._data.move_to_end(key)
            return self._data[key]

    def set(self, key: str, value: str) -> None:
        with self._lock:
            if key in self._data:
                self._data.move_to_end(key)
            self._data[key] = value
            while len(self._data) > self.max_size:
                self._data.popitem(last=False)


ai_cache = ResponseCache(max_size=200)
