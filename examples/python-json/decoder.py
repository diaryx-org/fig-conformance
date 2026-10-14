#!/usr/bin/env python3
"""Python's json module as a toml-test decoder (docs/adapters.md): the
document on stdin, its tagged JSON on stdout, a non-zero exit to refuse.

    npm run parse -- --decoder "python3 examples/python-json/decoder.py" --dialects json json
"""
import json
import sys


def refuse_constant(name):
    raise ValueError(f"{name} is not JSON")


class Number(str):
    """A number's lexeme, kept as written."""


def tagged(v):
    if v is None:
        return {"type": "null", "value": "null"}
    if isinstance(v, bool):
        return {"type": "bool", "value": "true" if v else "false"}
    if isinstance(v, Number):
        return {"type": "float" if any(c in v for c in ".eE") else "integer", "value": str(v)}
    if isinstance(v, str):
        return {"type": "string", "value": v}
    if isinstance(v, list):
        return [tagged(x) for x in v]
    return {k: tagged(x) for k, x in v.items()}


try:
    text = sys.stdin.buffer.read().decode("utf-8")
    value = json.loads(text, parse_int=Number, parse_float=Number, parse_constant=refuse_constant)
except (ValueError, RecursionError) as e:
    print(e, file=sys.stderr)
    sys.exit(1)
json.dump(tagged(value), sys.stdout)
