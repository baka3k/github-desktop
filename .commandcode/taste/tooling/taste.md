# Tooling

- Prefers code search to go through MCP semantic/graph tools (e.g. graph_mcp / semantic_search) first, treating grep/glob as a last resort. Confidence: 0.65
- Maintains custom agent instructions both globally (`~/.commandcode/AGENTS.md`) and per-project (repo-root `AGENTS.md`) and expects the agent to honor them reliably, including when delegating work to sub-agents. Confidence: 0.6
