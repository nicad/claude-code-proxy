#!/usr/bin/env python3
import sys, json
from typing import Any

MAX_BYTES = 120

def truncate_utf8_bytes(s: str, max_bytes: int = MAX_BYTES) -> str:
    b = s.encode("utf-8")
    if len(b) <= max_bytes:
        return s

    cut = max_bytes
    # back up to a valid UTF-8 boundary if needed
    while cut > 0:
        try:
            prefix = b[:cut].decode("utf-8")
            break
        except UnicodeDecodeError:
            cut -= 1
    else:
        prefix = ""  # shouldn't happen unless max_bytes == 0

    truncated = len(b) - len(prefix.encode("utf-8"))
    return f"{prefix}... truncated {truncated} bytes"

def walk(v: Any) -> Any:
    if isinstance(v, str):
        return truncate_utf8_bytes(v)
    if isinstance(v, list):
        return [walk(x) for x in v]
    if isinstance(v, dict):
        # If you also want to truncate *keys*, replace k with walk(k)
        return {k: walk(val) for k, val in v.items()}
    return v

def main() -> int:
    data = sys.stdin.read()
    dec = json.JSONDecoder()
    i = 0
    n = len(data)

    def skip_ws(j: int) -> int:
        while j < n and data[j].isspace():
            j += 1
        return j

    i = skip_ws(i)
    first = True

    while i < n:
        obj, j = dec.raw_decode(data, i)
        obj = walk(obj)

        if not first:
            sys.stdout.write("\n")  # separate multiple JSON values like jq does
        first = False

        sys.stdout.write(json.dumps(obj, ensure_ascii=False, indent=2))
        sys.stdout.write("\n")

        i = skip_ws(j)

    return 0

if __name__ == "__main__":
    raise SystemExit(main())