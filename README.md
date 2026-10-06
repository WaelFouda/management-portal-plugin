# Management Portal — Claude Code plugin marketplace

One-click install of the **management-portal MCP operator** for [Claude Code](https://code.claude.com).
It connects the management-portal MCP **and** ships the agent discipline that makes an agent use it
correctly — in a single install.

> **Authoritative install and sign-in instructions live in
> [`management-portal/README.md`](management-portal/README.md).** This page is the short version. Where the
> two ever disagree, that file wins — it sits beside the code it describes. This page deliberately does not
> restate the details, because when it did, the two drifted for two months and contradicted each other on
> the front page.

## Install

**You sign in with OAuth 2.1 + PKCE (S256 only — `plain` is rejected), with dynamic client registration.
There is no API key to create, paste or store on this path** — the plugin ships no `userConfig` prompt and
its `.mcp.json` carries no `headers` at all, just `type` and `url`.
Two routes actually carry a sign-in through to a working connection:

### Route 1 — claude.ai custom connector (no terminal)

**Settings → Connectors → Add custom connector**, paste
`https://client-management-api-1uk1.onrender.com/mcp`, approve. No terminal, no JSON, no key.
This gives you the **tools only** — the skills, subagents, commands and hooks are plugin content, so for
those take Route 2.

### Route 2 — the plugin

1. **Add this marketplace** — Claude Code Plugins panel → *Add marketplace*, or run:
   `/plugin marketplace add WaelFouda/management-portal-plugin`
2. **Install** — find **management-portal** in the marketplace and click *Install*, or run:
   `/plugin install management-portal@portal`
3. **Reload** (`/reload-plugins`) or restart Claude Code.
4. **Sign in.** In an **interactive terminal**, run `claude`, then `/mcp` → select **management-portal** →
   **Authenticate**. A browser opens, you approve, and the server comes back connected.

> ⚠️ **Claude Code Desktop cannot complete the sign-in.** `/mcp` → **Authenticate** in an interactive
> terminal is the only thing that opens a browser. Desktop performs discovery, dynamic client registration
> and PKCE and even builds the authorization URL — then logs `Redirection handling is disabled, skipping
> redirect` and stops. That is a connect-time probe that marks a server as "needs auth"; **it is not a
> login.** The same applies to `claude -p` and to the SDK. Desktop-only users should take **Route 1**.
>
> **Windows:** if no browser opens, Claude Code prints the authorization URL — paste it in by hand.

> ⚠️ **Restart, don't just open.** The skills, the subagents, the commands and the hooks register **only at
> session start**. Start a fresh session (or `/reload-plugins` and reconnect MCP), then run `/mcp` to
> confirm `management-portal` is **connected**.

### Headless / CI — the API key is still first-class

**Keys were not removed.** OAuth is an *additional* way in, not a replacement. OAuth needs an interactive
browser, so anything that cannot open one — CI, headless runners, containers — authenticates with a
platform API key, which the server still accepts on **either** `X-API-Key: pfk_live_…` **or**
`Authorization: Bearer pfk_live_…`. Both resolve to the same identity. Register the **standalone** server
instead of the plugin:

```
claude mcp add --transport http management-portal \
  https://client-management-api-1uk1.onrender.com/mcp \
  --header "X-API-Key: <YOUR_KEY>"
```

Generate the key in the web app → **Settings → API Keys → Generate**.

> ⚠️ **That path writes the key in plaintext** to `~/.claude.json` under
> `projects[<abs path>].mcpServers["management-portal"].headers["X-API-Key"]`. Treat that file as a secret,
> never copy it into a repo or a support ticket, and rotate the key if it leaks.

> **This is a different install path from the plugin and it yields different tool names**
> (`mcp__management-portal__…` rather than `mcp__plugin_management-portal_management-portal__…`).
> See [`management-portal/README.md`](management-portal/README.md#the-tool-name-prefix-depends-on-which-install-path-you-took).

## What you get

| Component | What it does |
|---|---|
| `management-portal` **MCP server** | The remote MCP (clients, projects, briefs, proposals, tasks, flow board, boards, notes, calendar, gigs, time, team chat). |
| `management-portal` **skill** | Auto-triggers on any portal work and loads the operating discipline. |
| `reference.md` | Load-on-demand deep reference (playbook + write→read map + board-first). |
| `canon-gates.md` | The status board for the canon gates — what enforces today and what does not. |
| `team-chat-reachability` **skill** | How to stay reachable on a channel watch roster; the re-arm rule. |
| `portal-operator` **subagent** | Runs the portal under the discipline (portal tools only, no `delete_*`). |
| `team-chat-watcher` **subagent** | The background loop you spawn; spawning it is what actually makes you reachable. |
| `/portal` **command** | Dispatches the `portal-operator` subagent for a disciplined run. |
| `/portal-project`, `/portal-continue` | Start a disciplined run for a client + project, and resume it without stopping between phases. |
| `/channel-coordinate`, `/channel-join` | Join a Team Chat channel as coordinator or participant, under a name you choose. |
| `/portal-stand-down`, `/portal-rearm` | **The escape** from a canon gate, and **the way back**. |
| `/plain-english` **command** | Re-explains the current work in plain language and holds that register. |
| `/rearm-watch` **command** | What a human types to join a channel and keep watching it, or to read the roster. |
| `scripts/canon-gate.js` | The canon gates: `PreToolUse` refusals, `PostToolUse`/`Stop` compulsions, turn-end advisories, plus `stand-down`, `doctor` and `selftest` modes. |
| `scripts/watch-alarm.js` | The ABSENT alarm and the turn-end gate. Node, no dependencies. |

### What actually enforces — stated plainly, as of plugin 1.7.9

The canon gates ship and are wired into the plugin's hooks. Not every gate has the same evidence behind
it, and it is worth knowing which is which:

- **The Team Chat turn-end ABSENT gate refuses.** It returns `decision: block`, and it is verified to
  refuse to end a turn while the roster says this session is `ABSENT`.
- **Three canon gates are verified live:** `CANON-ID`, `CANON-READ-BACK` and `CANON-BOTTOM-UP` were
  observed refusing real calls. The first `CANON-ID` refusals were wrong, and fixed — which is why that is
  written down rather than left out.
- **Every other canon gate is ARMED, not ENFORCED** — shipped, wired and fixture-verified, but not yet
  seen refusing a live call. Each has a documented one-line stand-down escape.
- The status board is
  [`management-portal/skills/management-portal/canon-gates.md`](management-portal/skills/management-portal/canon-gates.md);
  where this page and that board disagree, the board wins.

### What's new in 1.7.9 (since 1.7.5)

- **1.7.8 — project knowledge graphs can be seeded with related earlier graphs and GitHub repos.** Both
  are new source kinds (`knowledge_graph`, `github_repo`), and the close-out gate now counts sources added
  in one batched call (`items[].type`), so the documented one-call pattern finally passes.
- **1.7.7 — reply and forward owe a read-back.** Inbox and chat reply/forward writes carry another
  person's words across a hop, and the gate now asks for the read that proves they landed.
- **1.7.6 — the settling call a gate prints now carries the id the read actually takes** — a subtask's
  parent, not the subtask just created — so running it settles what is owed instead of returning an empty
  list that looks like data loss.

Details for each are in [`management-portal/README.md`](management-portal/README.md).

## Use

Just start working on the portal — the skill loads automatically. For a dedicated, disciplined run use
**`/management-portal:portal <what to do>`**, which engages the `portal-operator` subagent bound to the
core loop, the three gates, bottom-up completion, never-fabricate-ids, and board-first alignment.
On Team Chat, type **`/rearm-watch`**.

## Other platforms (file-copy bundles)

VS Code Copilot, Cursor, and Roo Code don't have a one-click marketplace like Claude Code — they install
by copying a small bundle. **These bundles authenticate with an API key on `X-API-Key`, not with OAuth**;
each ships a placeholder `<YOUR_MCP_API_KEY>` you replace at install time.

| Platform | Bundle | One-click? |
|---|---|---|
| **Cursor** | [`agent-onboarding/bundles/cursor/`](agent-onboarding/bundles/cursor) | MCP server only — `cursor://` deeplink in its README |
| **VS Code (Copilot)** | [`agent-onboarding/bundles/copilot/`](agent-onboarding/bundles/copilot) | MCP server only — `vscode:mcp/install` link in its README |
| **Roo Code** | [`agent-onboarding/bundles/roo/`](agent-onboarding/bundles/roo) | No — file copy only |
| **Claude Code (manual)** | [`agent-onboarding/bundles/claude-code/`](agent-onboarding/bundles/claude-code) | Prefer the one-click plugin above |

Each bundle's README has one-screen install steps. The shared core they condense from is in
[`agent-onboarding/shared/`](agent-onboarding/shared); the canonical spec is
[`agent-onboarding/DISCIPLINE.md`](agent-onboarding/DISCIPLINE.md), and the measured hook facts are in
[`agent-onboarding/CANON-GATES.md`](agent-onboarding/CANON-GATES.md).

> **For agents:** when there's no one-click path (e.g. Roo), fetch the platform's bundle folder above,
> copy its files into the user's project root, replace `<YOUR_MCP_API_KEY>` in the MCP config, and follow
> the bundle README. Everything here is public and contains only placeholders — no secrets.

---

*This repo is the public distribution channel for the plugin. The canonical source is maintained
privately and mirrored here; the plugin contains no secrets — the plugin path signs in with OAuth, and
the bundle and headless paths take a key you supply yourself at install.*
