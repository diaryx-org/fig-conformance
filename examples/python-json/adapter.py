#!/usr/bin/env python3
"""Python's json module, scored over the JSON-lines protocol (docs/adapters.md).

    npm run parse -- --command "python3 examples/python-json/adapter.py" json

It reads JSON (parse) and writes it again (print); it does not edit.
"""
import json
import sys


class Raw(str):
    """A number's lexeme, kept as written."""


class Obj(list):
    """An object's pairs, in order, duplicates included."""


def refuse_constant(name):
    raise ValueError(f"{name} is not JSON")


def load(text):
    return json.loads(text, parse_int=Raw, parse_float=Raw,
                      parse_constant=refuse_constant, object_pairs_hook=Obj)


def tree(v):
    """The loaded value as the protocol's tree."""
    if v is None:
        return {"kind": "null"}
    if isinstance(v, bool):
        return {"kind": "bool", "value": v}
    if isinstance(v, Raw):
        return {"kind": "float" if any(c in v for c in ".eE") else "int", "raw": str(v)}
    if isinstance(v, str):
        return {"kind": "string", "value": v}
    if isinstance(v, Obj):
        return {"kind": "map", "entries": [[{"kind": "string", "value": k}, tree(x)] for k, x in v]}
    return {"kind": "seq", "items": [tree(x) for x in v]}


def plain(v):
    """The loaded value as Python's own, for json.dumps."""
    if isinstance(v, Raw):
        return float(v) if any(c in v for c in ".eE") else int(v)
    if isinstance(v, Obj):
        return {k: plain(x) for k, x in v}
    if isinstance(v, list):
        return [plain(x) for x in v]
    return v


def source(req):
    if "source_base64" in req:
        raise ValueError("not UTF-8")
    return req["source"]


def answer(req):
    method = req.get("method")
    if method == "hello":
        return {"name": "python json", "dialects": ["json"], "methods": ["parse", "print"]}
    try:
        if method == "parse":
            return {"ok": True, "tree": tree(load(source(req)))}
        if method == "print":
            if req.get("to") != "json":
                return {"ok": False, "error": f"cannot write {req.get('to')}"}
            return {"ok": True, "text": json.dumps(plain(load(source(req))))}
        return {"ok": False, "error": f"no method {method}"}
    except (ValueError, RecursionError) as e:
        return {"ok": False, "error": str(e)}


for line in sys.stdin:
    if line.strip():
        req = json.loads(line)
        sys.stdout.write(json.dumps({"id": req["id"], **answer(req)}) + "\n")
        sys.stdout.flush()
