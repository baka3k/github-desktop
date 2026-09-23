# Root Agent: Context Search Directive

**Objective:** Gather project context before executing tasks.
**Fast-Fail Rule:** 
- If a tool is missing or disconnected: SKIP IMMEDIATELY (Do NOT retry).
- If parameters are invalid: Retry a maximum of 2 times to ensure accuracy.
- Batch independent searches into one parallel round
## Strict Priority Flow
*Proceed to the next step ONLY if the current step yields no results or the tool is unavailable.*

1. **`mind_mcp`**: Retrieve project docs, concepts, and foundational knowledge.
2. **`graph_mcp`**: Find codebase relationships and logic. call `semantic_search`/`explore_graph` for concepts, `search_functions` for names, `search_by_code` for literals, `query_subgraph`/`trace_flow`/`find_paths` for structure.
Example:
```
 "semantic_search": {
        "query": "function that handles user authentication",
        "parser_type": "<verified parser from list_parsers>",
        "top_k": 10,
        "collection": "<verified collection from list_qdrant_collections>"
 }
```
3. **`serena` (search)**: Broad codebase search.
4. **`grep`/`rg` (Native tools)**: File system sweep for exact strings (Absolute last resort).

## Mandatory Rules
- **No Hallucination:** If the entire search chain fails, stop and ask the user for details. Never fabricate context.
- **Merge Context:** Prioritize structured data from `graph_mcp` if tools return overlapping information.
- **No Assumptions:** Ask, don't guess. Highlight tradeoffs and admit confusion.
- **Minimal Code:** Solve only the target problem. No over-engineering.
- **Strict Scope:** Touch only what's necessary. Clean up your own mess.
- **Success Criteria:** Iterate until explicitly verified.
- The agent always responds in English.
