#!/usr/bin/env python3
"""Reflect SQLAlchemy models into a normalized JSON schema.

The ONLY Python in rolepod-dblab. The TS server (which cannot import Python
objects in-process) shells out to this script for the db-migrate-verify drift
skill — the direct analog of how rolepod-uiproof shells out to Appium for the
mobile runtime it can't reach natively. The TS side owns the diff; this script
only reflects.

Usage:
    python3 reflect_models.py --models <module>:<attr>

<attr> is a SQLAlchemy declarative Base (or any object exposing `.metadata`),
or a MetaData instance. Column types are compiled with the Postgres dialect so
they line up with the live information_schema types on the TS side.

Output (stdout): {"dialect": "postgres", "tables": [
    {"name": str, "columns": [{"name": str, "type": str, "nullable": bool}]}]}
Exit non-zero with a message on stderr if the models can't be imported.
"""
import argparse
import importlib
import json
import os
import sys


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--models", required=True, help="module:attr (Base/MetaData)")
    args = parser.parse_args()

    # Make the working directory importable so the user's project package resolves.
    sys.path.insert(0, os.getcwd())

    module_name, _, attr = args.models.partition(":")
    if not attr:
        print("models entrypoint must be 'module:attr'", file=sys.stderr)
        return 2

    try:
        module = importlib.import_module(module_name)
    except Exception as exc:  # noqa: BLE001 — report any import failure verbatim
        print(f"could not import module '{module_name}': {exc}", file=sys.stderr)
        return 1

    target = getattr(module, attr, None)
    if target is None:
        print(f"'{attr}' not found in module '{module_name}'", file=sys.stderr)
        return 1

    metadata = getattr(target, "metadata", target)
    if not hasattr(metadata, "tables"):
        print(f"'{args.models}' is not a Base or MetaData (no .tables)", file=sys.stderr)
        return 1

    try:
        from sqlalchemy.dialects import postgresql

        dialect = postgresql.dialect()
    except Exception as exc:  # noqa: BLE001
        print(f"SQLAlchemy (postgresql dialect) not available: {exc}", file=sys.stderr)
        return 1

    tables = []
    for _, table in sorted(metadata.tables.items()):
        columns = []
        for col in table.columns:
            try:
                col_type = col.type.compile(dialect=dialect)
            except Exception:  # noqa: BLE001 — fall back to the generic repr
                col_type = str(col.type)
            columns.append(
                {"name": col.name, "type": col_type, "nullable": bool(col.nullable)}
            )
        tables.append({"name": table.name, "columns": columns})

    json.dump({"dialect": "postgres", "tables": tables}, sys.stdout)
    return 0


if __name__ == "__main__":
    sys.exit(main())
