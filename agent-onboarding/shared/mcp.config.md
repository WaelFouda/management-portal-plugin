# MCP connection — canonical params

> Single source of truth for how to **connect** to the management-portal MCP. Every per-platform bundle
> imports these values so connection details never drift. **No real secret lives here** — use a placeholder
> and inject the real key per platform (env var or the platform's secret store).

## Canonical connection

| Field | Value |
|---|---|
| **Server name** | `management-portal` |
| **Transport** | streamable HTTP |
| **URL** | `https://client-management-api-1uk1.onrender.com/mcp` |
| **Auth** | header `X-API-Key: <YOUR_MCP_API_KEY>` |

> Replace `<YOUR_MCP_API_KEY>` with your real key at install time. **Never commit the real key.** Prefer an
> env var (e.g. `${MCP_API_KEY}` / `${env:MCP_API_KEY}`) so the key stays out of version control.

## Per-platform config file (where each bundle wires this in)

| Platform | Config file (repo-relative) |
|---|---|
| **Claude Code** | `.mcp.json` |
| **VS Code — GitHub Copilot** | `.vscode/mcp.json` |
| **Roo Code** | `.roo/mcp.json` |
| **Cursor** | `.cursor/mcp.json` |

Each platform's `mcp.json` declares an MCP server named `management-portal` pointing at the URL above with
the `X-API-Key` header. Shape varies slightly per platform, but the **URL, header name, and server name are
identical** everywhere — they all come from this file.

### Canonical shape (adapt the wrapper key per platform)

```jsonc
{
  // top-level key is "mcpServers" (Claude Code / Cursor / Roo) or "servers" (VS Code Copilot)
  "mcpServers": {
    "management-portal": {
      "url": "https://client-management-api-1uk1.onrender.com/mcp",
      "headers": { "X-API-Key": "${MCP_API_KEY}" }
    }
  }
}
```

> AGENTS.md / SKILL.md tell the agent **how to operate** the MCP; this file tells each platform **how to
> connect** to it. Keep them in sync with `../DISCIPLINE.md`.
