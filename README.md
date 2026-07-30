# ForgeMesh Library — Public-Domain Knowledge Base for AI Agents

*A [ForgeMesh Labs](https://forgemesh.io) product.*

**A paid public-domain knowledge base, built for agents.** Full-text search, book metadata, chapters, notable quotes, flagship "ask this book a question" retrieval, and 100+ curated subject shelves over a growing corpus of public-domain books — no license, no API key, no account. Pay per call in USDC on Base via [x402](https://x402.org).

Retrieval only: every answer is a real, cited passage pulled from the indexed text. Nothing here is LLM-generated or summarized — that makes it safe to cite for tutoring agents, reading apps, quiz/curriculum generators, and any workflow where a hallucinated quote is worse than no quote.

## Quick start (Claude Desktop / Claude Code / any MCP client)

```json
{
  "mcpServers": {
    "library": {
      "command": "npx",
      "args": ["-y", "@forgemeshlabs/library-mcp"],
      "env": {
        "WALLET_PRIVATE_KEY": "0x..."
      }
    }
  }
}
```

`WALLET_PRIVATE_KEY` is a **dedicated low-balance Base wallet** for x402 micropayments — never your primary wallet. $1 of USDC buys dozens to hundreds of calls depending on the route.

## Tools

| Tool | Cost | What it does |
|---|---|---|
| `search_literature` | $0.02 | Full-text search across the entire corpus — real passages, any book |
| `search_books` | $0.005 | Search the corpus by title or author substring |
| `get_book_metadata` | $0.002 | Title, author, year, subjects, bookshelves, chapter range for a book_id |
| `get_chapter` | $0.005 | Full text of one chapter by book_id + chapter number |
| `get_quotes` | $0.005 | Notable passages from a book, optionally themed |
| `ask_book` | $0.01 | Ask a flagship book (Moby Dick, the Republic, Sherlock Holmes...) a question, get cited passages back |
| `browse_shelf` | $0.003 | Browse a curated category or subject shelf (gothic horror, Russian literature, detective fiction, 100+ shelves) |
| `book_of_the_day` | $0.001 | Deterministic daily book pick, date-seeded |

Prices are set by the live service and may change — the actual charge always comes from the x402 402 challenge at call time, not this table.

## Who this is for

Built for **education-safe** agent use cases:

- Tutoring agents that need a real quote, not a paraphrase
- Reading apps and book-club bots
- Quiz and curriculum generators that cite public-domain source text
- Any agent that needs a large, cheap, license-free text corpus without hitting a rate-limited free API

Nothing here requires an account, an API key, or a license negotiation — the entire corpus is public domain, drawn in part from the Project Gutenberg collection. Not affiliated with or endorsed by Project Gutenberg.

## Corpus size

The corpus is actively growing — it started at hundreds of books and is on a path from **17,000+ toward roughly 62,000** as more public-domain texts are indexed. Don't hardcode a book count anywhere downstream of this server; ask `search_books` or `search_literature` and let the live index answer.

## Flagship books (`ask_book`)

Alice in Wonderland, Art of War, Count of Monte Cristo, Crime and Punishment, Don Quixote, Dracula, Frankenstein, Great Expectations, Grimms' Fairy Tales, Jane Eyre, Meditations (Marcus Aurelius), Moby-Dick, The Picture of Dorian Gray, Pride and Prejudice, Sherlock Holmes, The Iliad, The Odyssey, The Republic, The Time Machine, Tom Sawyer, Treasure Island, Walden, War and Peace, Wuthering Heights.

Any other book: use `search_literature` or `search_books` + `get_chapter`/`get_quotes` instead — the flagship `ask_book` routes are hand-curated, the rest of the corpus is reachable through search.

## Shelves (`browse_shelf`)

10 hand-picked categories (adventure, children's classics, classic literature, economics & politics, gothic horror, history, philosophy, poetry, science & nature, Shakespeare & drama) plus 100+ auto-generated subject shelves drawn from real Gutenberg subjects/bookshelves metadata (gothic fiction, Russian literature, detective fiction, banned books lists, and more).

The full, current shelf catalog is free to browse — no payment, no tool call required:

- `https://library.forgemesh.io/llms.txt`
- `https://library.forgemesh.io/openapi.json`

## How payment works

No signup, no API key, no subscription. The first request to any tool returns an HTTP 402 challenge; this MCP server signs a USDC payment authorization (EIP-3009) and retries automatically. The result lands in the same response, with the on-chain settlement details under `_payment` when available.

## Direct API

Prefer raw HTTP? The full agent-readable surface:

- `https://library.forgemesh.io/llms.txt` — one-page summary for agents
- `https://library.forgemesh.io/openapi.json` — OpenAPI 3.1 with x402 payment metadata, full input schemas, and worked examples for every route
- `https://library.forgemesh.io/.well-known/x402.json` — x402 discovery manifest

## FAQ

**Is this LLM-generated?** No. Every response is retrieval over a local full-text index of real books. The `method` field in every response says so explicitly.

**Do I need an account or API key?** No. x402 payments are the only credential.

**What chain and token?** USDC on Base mainnet (`eip155:8453`).

**Can I use this for tutoring or curriculum content?** Yes — that's the intended use. Retrieval-only, cited-passage answers are education-safe in a way generated summaries aren't.

---

Built by [ForgeMesh Labs](https://forgemesh.io) · Powered by the [x402 protocol](https://x402.org) · MIT License
