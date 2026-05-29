# Third-party dependencies

rolepod-dblab is MIT licensed. It depends on the following third-party software.

## Runtime dependencies (npm)

| Package | License | Why |
|---|---|---|
| [`@modelcontextprotocol/sdk`](https://github.com/modelcontextprotocol/typescript-sdk) | MIT | The MCP server framework (stdio transport, tool registration). |
| [`pg`](https://github.com/brianc/node-postgres) | MIT | PostgreSQL client. Lazy-loaded at first connect; required by every skill except drift. |
| [`zod`](https://github.com/colinhacks/zod) | MIT | Tool input schemas + JSON-schema export. |

## Build / test dependencies (npm, dev)

| Package | License |
|---|---|
| [`tsup`](https://github.com/egoist/tsup) | MIT |
| [`typescript`](https://github.com/microsoft/TypeScript) | Apache-2.0 |
| [`vitest`](https://github.com/vitest-dev/vitest) | MIT |
| [`zod-to-json-schema`](https://github.com/StefanTerdell/zod-to-json-schema) | ISC |
| `@types/node`, `@types/pg` | MIT |

## External runtime (not bundled, user-provided)

| Tool | License | Used by |
|---|---|---|
| [SQLAlchemy](https://www.sqlalchemy.org/) (Python) | MIT | `/db-migrate-verify` only. The Python sidecar `reflect_models.py` reflects the user's SQLAlchemy models in the user's own interpreter. dblab ships only the ~80-line script; it does not bundle Python or SQLAlchemy. |
| Python 3 | PSF | Runs the drift sidecar. The other four skills do not need Python. |
| Docker (dev only) | Apache-2.0 | Integration tests spin a throwaway `postgres:16-alpine`. |

No third-party code is vendored into this repository.
