#!/usr/bin/env node
"use strict";

const { Server } = require("@modelcontextprotocol/sdk/server/index.js");
const { StdioServerTransport } = require("@modelcontextprotocol/sdk/server/stdio.js");
const { CallToolRequestSchema, ListToolsRequestSchema } = require("@modelcontextprotocol/sdk/types.js");
const { x402Client, x402HTTPClient } = require("@x402/core/client");
const { ExactEvmScheme } = require("@x402/evm/exact/client");
const { toClientEvmSigner } = require("@x402/evm");
const { privateKeyToAccount } = require("viem/accounts");
const { createPublicClient, http } = require("viem");
const { base } = require("viem/chains");

const VERSION = "0.1.3";
const BASE_URL = (process.env.LIBRARY_BASE_URL || "https://library.forgemesh.io").replace(/\/$/, "");
const BASE_RPC_URL = process.env.BASE_RPC_URL || "https://mainnet.base.org";

// Flagship /ask-<book> routes. Each entry maps a slug to the aliases an agent
// is likely to type. Kept as a lookup table because these ~24 routes are
// hand-curated; the 111 category/subject shelves are NOT enumerated here on
// purpose — the corpus is actively growing (17k+ books toward ~62k) and shelf
// membership shifts with it, so browse_shelf resolves against live discovery.
const FLAGSHIP_BOOKS = [
  { slug: "alice-in-wonderland", aliases: ["alice in wonderland", "alice's adventures in wonderland", "alice"] },
  { slug: "art-of-war", aliases: ["art of war", "the art of war", "sun tzu"] },
  { slug: "count-of-monte-cristo", aliases: ["count of monte cristo", "the count of monte cristo", "monte cristo"] },
  { slug: "crime-and-punishment", aliases: ["crime and punishment"] },
  { slug: "don-quixote", aliases: ["don quixote"] },
  { slug: "dracula", aliases: ["dracula"] },
  { slug: "frankenstein", aliases: ["frankenstein"] },
  { slug: "great-expectations", aliases: ["great expectations"] },
  { slug: "grimms-fairy-tales", aliases: ["grimms fairy tales", "grimm's fairy tales", "grimm brothers"] },
  { slug: "jane-eyre", aliases: ["jane eyre"] },
  { slug: "meditations", aliases: ["meditations", "marcus aurelius"] },
  { slug: "moby-dick", aliases: ["moby dick", "moby-dick"] },
  { slug: "picture-of-dorian-gray", aliases: ["picture of dorian gray", "the picture of dorian gray", "dorian gray"] },
  { slug: "pride-and-prejudice", aliases: ["pride and prejudice"] },
  { slug: "sherlock-holmes", aliases: ["sherlock holmes", "the adventures of sherlock holmes"] },
  { slug: "the-iliad", aliases: ["iliad", "the iliad", "homer's iliad"] },
  { slug: "the-odyssey", aliases: ["odyssey", "the odyssey", "homer's odyssey"] },
  { slug: "the-republic", aliases: ["republic", "the republic", "plato's republic"] },
  { slug: "the-time-machine", aliases: ["time machine", "the time machine"] },
  { slug: "tom-sawyer", aliases: ["tom sawyer", "the adventures of tom sawyer"] },
  { slug: "treasure-island", aliases: ["treasure island"] },
  { slug: "walden", aliases: ["walden", "thoreau's walden"] },
  { slug: "war-and-peace", aliases: ["war and peace"] },
  { slug: "wuthering-heights", aliases: ["wuthering heights"] },
];

function slugify(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function resolveFlagshipBook(input) {
  const norm = slugify(input);
  if (!norm) return null;
  for (const entry of FLAGSHIP_BOOKS) {
    if (entry.slug === norm) return entry.slug;
  }
  for (const entry of FLAGSHIP_BOOKS) {
    const aliasSlugs = entry.aliases.map(slugify);
    if (aliasSlugs.includes(norm)) return entry.slug;
  }
  // fuzzy: does the normalized input appear inside the slug or an alias, or vice versa?
  for (const entry of FLAGSHIP_BOOKS) {
    if (entry.slug.includes(norm) || norm.includes(entry.slug)) return entry.slug;
    for (const alias of entry.aliases) {
      const aliasSlug = slugify(alias);
      if (aliasSlug.includes(norm) || norm.includes(aliasSlug)) return entry.slug;
    }
  }
  return null;
}

const FLAGSHIP_LIST_TEXT = FLAGSHIP_BOOKS.map((e) => e.aliases[0]).join(", ");

const TOOLS = [
  {
    name: "search_literature",
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
    description:
      "PREMIUM full-text search across the entire indexed public-domain corpus (17k+ books and growing). Returns the most relevant passages from ANY book, ranked by relevance, with title/author citations. Retrieval only — real cited passages, never LLM-generated or summarized. Costs $0.02 via x402 (requires WALLET_PRIVATE_KEY, USDC on Base).",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Full-text search query, e.g. 'the nature of justice'" },
        limit: { type: "integer", description: "Max passages to return (default 10, max 30)" },
      },
      required: ["query"],
    },
  },
  {
    name: "search_books",
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
    description:
      "Search the indexed public-domain book corpus by title or author substring, e.g. 'Dickens' or 'Frankenstein'. Returns matching books ranked by historical popularity with book_id for drill-down into metadata, chapters, quotes, or full-text search. Costs $0.005 via x402 (requires WALLET_PRIVATE_KEY, USDC on Base).",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Title or author substring" },
        limit: { type: "integer", description: "Max results (default 10, max 50)" },
      },
      required: ["query"],
    },
  },
  {
    name: "get_book_metadata",
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
    description:
      "Full metadata for one indexed book by book_id: title, author, year, subjects, bookshelves, download rank, chunk count, and detected chapter range. Use search_books first to find a book_id. Costs $0.002 via x402 (requires WALLET_PRIVATE_KEY, USDC on Base).",
    inputSchema: {
      type: "object",
      properties: {
        book_id: { type: "integer", description: "Gutenberg book id, from search_books" },
      },
      required: ["book_id"],
    },
  },
  {
    name: "get_chapter",
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
    description:
      "Full text of one chapter from an indexed book by book_id and chapter number. Chapter 0 is front matter before the first detected heading. Use get_book_metadata for the valid chapter range. Costs $0.005 via x402 (requires WALLET_PRIVATE_KEY, USDC on Base).",
    inputSchema: {
      type: "object",
      properties: {
        book_id: { type: "integer", description: "Gutenberg book id" },
        chapter: { type: "integer", description: "Chapter number (0 = front matter)" },
      },
      required: ["book_id", "chapter"],
    },
  },
  {
    name: "get_quotes",
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
    description:
      "Notable passages from one indexed book by book_id. Pass an optional theme to full-text search within that book, or omit it for a sample of short dialogue-bearing lines. Costs $0.005 via x402 (requires WALLET_PRIVATE_KEY, USDC on Base).",
    inputSchema: {
      type: "object",
      properties: {
        book_id: { type: "integer", description: "Gutenberg book id" },
        theme: { type: "string", description: "Optional theme/keyword to search for within the book" },
        limit: { type: "integer", description: "Max quotes to return (default 5)" },
      },
      required: ["book_id"],
    },
  },
  {
    name: "ask_book",
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
    description:
      `Ask a natural-language question about one of the flagship books and get back the most relevant passages from the book itself, with chapter/location citations. Retrieval only — never a generated summary. Pass any recognizable name for "book" (e.g. "Moby Dick", "the Odyssey") — it resolves to the matching route. Available flagship books: ${FLAGSHIP_LIST_TEXT}. Costs $0.01 via x402 (requires WALLET_PRIVATE_KEY, USDC on Base).`,
    inputSchema: {
      type: "object",
      properties: {
        book: { type: "string", description: `Book name, e.g. one of: ${FLAGSHIP_LIST_TEXT}` },
        question: { type: "string", description: "Your question about the book" },
        limit: { type: "integer", description: "Max passages (default 5, max 15)" },
      },
      required: ["book", "question"],
    },
  },
  {
    name: "browse_shelf",
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
    description:
      "Browse a curated category/subject shelf: 10 hand-picked categories (adventure, childrens-classics, classic-literature, economics-and-politics, gothic-horror, history, philosophy, poetry, science-and-nature, shakespeare-and-drama) plus 100+ auto-generated shelves drawn from real Gutenberg subjects/bookshelves (e.g. 'gothic-fiction', 'russian-literature', 'detective-fiction'). Returns a ranked list of books with book_id for drill-down. Full shelf catalog is discoverable free at https://library.forgemesh.io/llms.txt. Costs $0.003 via x402 (requires WALLET_PRIVATE_KEY, USDC on Base).",
    inputSchema: {
      type: "object",
      properties: {
        shelf: { type: "string", description: "Shelf name or slug, e.g. 'gothic horror' or 'russian-literature'" },
      },
      required: ["shelf"],
    },
  },
  {
    name: "book_of_the_day",
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
    description:
      "Deterministic daily book pick from the indexed corpus, date-seeded so every caller gets the same answer on the same UTC day. Optional date override for backfill. Costs $0.001 via x402 (requires WALLET_PRIVATE_KEY, USDC on Base).",
    inputSchema: {
      type: "object",
      properties: {
        date: { type: "string", description: "Optional ISO date (YYYY-MM-DD) to replay a past day's pick" },
      },
    },
  },
];

function buildBaseHttpClient() {
  const key = process.env.WALLET_PRIVATE_KEY;
  if (!key) {
    throw new Error(
      "WALLET_PRIVATE_KEY is not set. ForgeMesh Library is a paid-per-call knowledge base — set a dedicated low-balance Base wallet private key (never your primary wallet) with a small amount of USDC on Base mainnet. See README for setup."
    );
  }
  const pk = key.startsWith("0x") ? key : "0x" + key;
  const account = privateKeyToAccount(pk);
  const coreClient = new x402Client().register("eip155:*", new ExactEvmScheme(toClientEvmSigner(account)));
  return { httpClient: new x402HTTPClient(coreClient), account };
}

// x402 derives EIP-3009 validity windows from Date.now; choose a timestamp
// valid for both Base block time and facilitator wall-clock checks (clock-skew fix).
async function createChainTimedPaymentPayload(httpClient, paymentRequired) {
  try {
    const publicClient = createPublicClient({ chain: base, transport: http(BASE_RPC_URL) });
    const block = await publicClient.getBlock();
    const chainNow = Number(block.timestamp);
    const originalNow = Date.now;
    const localNow = Math.floor(originalNow() / 1000);
    const timeout = Number(paymentRequired.accepts?.[0]?.maxTimeoutSeconds || 300);
    const lowerBound = localNow + 30 - timeout;
    const upperBound = chainNow + 600;
    const signingNow = Math.min(Math.max(chainNow, lowerBound), upperBound);
    Date.now = () => signingNow * 1000;
    try {
      return await httpClient.createPaymentPayload(paymentRequired);
    } finally {
      Date.now = originalNow;
    }
  } catch (_) {
    return httpClient.createPaymentPayload(paymentRequired);
  }
}

async function paidPost(ctx, path, body) {
  const { httpClient } = ctx;
  const url = BASE_URL + path;
  const init = { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body || {}) };
  const res = await fetch(url, init);

  if (res.status === 402) {
    let challengeBody;
    try {
      challengeBody = await res.clone().json();
    } catch (_) {}
    const paymentRequired = httpClient.getPaymentRequiredResponse((name) => res.headers.get(name), challengeBody);
    const paymentPayload = await createChainTimedPaymentPayload(httpClient, paymentRequired);
    const paidRes = await fetch(url, {
      ...init,
      headers: { ...init.headers, ...httpClient.encodePaymentSignatureHeader(paymentPayload) },
    });
    if (!paidRes.ok) {
      const errBody = await paidRes.text().catch(() => paidRes.statusText);
      throw new Error(`HTTP ${paidRes.status}: ${errBody.slice(0, 300)}`);
    }
    const data = await paidRes.json();
    try {
      const settleResponse = httpClient.getPaymentSettleResponse((name) => paidRes.headers.get(name));
      if (settleResponse && data && typeof data === "object" && !Array.isArray(data)) {
        return { ...data, _payment: settleResponse };
      }
    } catch (_) {}
    return data;
  }

  if (!res.ok) {
    const errBody = await res.text().catch(() => res.statusText);
    throw new Error(`HTTP ${res.status}: ${errBody.slice(0, 300)}`);
  }
  return res.json();
}

async function main() {
  let ctxPromise;
  async function getPaymentContext() {
    if (!ctxPromise) ctxPromise = Promise.resolve().then(buildBaseHttpClient);
    return ctxPromise;
  }

  const server = new Server({ name: "library-mcp", version: VERSION }, { capabilities: { tools: {} } });

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const { name, arguments: args = {} } = req.params;
    try {
      let data;
      switch (name) {
        case "search_literature":
          data = await paidPost(await getPaymentContext(), "/literature-search", {
            query: args.query,
            limit: args.limit,
          });
          break;
        case "search_books":
          data = await paidPost(await getPaymentContext(), "/book-search", {
            query: args.query,
            limit: args.limit,
          });
          break;
        case "get_book_metadata":
          data = await paidPost(await getPaymentContext(), "/book-metadata", { book_id: args.book_id });
          break;
        case "get_chapter":
          data = await paidPost(await getPaymentContext(), "/book-chapter", {
            book_id: args.book_id,
            chapter: args.chapter,
          });
          break;
        case "get_quotes":
          data = await paidPost(await getPaymentContext(), "/book-quotes", {
            book_id: args.book_id,
            theme: args.theme,
            limit: args.limit,
          });
          break;
        case "ask_book": {
          const slug = resolveFlagshipBook(args.book);
          if (!slug) {
            throw new Error(
              `Could not resolve "${args.book}" to a flagship book. Available: ${FLAGSHIP_LIST_TEXT}. For other titles use search_literature instead.`
            );
          }
          data = await paidPost(await getPaymentContext(), `/ask-${slug}`, {
            question: args.question,
            limit: args.limit,
          });
          break;
        }
        case "browse_shelf": {
          const shelfSlug = slugify(args.shelf);
          if (!shelfSlug) throw new Error("shelf is required");
          data = await paidPost(await getPaymentContext(), `/${shelfSlug}`, {});
          break;
        }
        case "book_of_the_day":
          data = await paidPost(await getPaymentContext(), "/book-of-the-day", { date: args.date });
          break;
        default:
          throw new Error(`Unknown tool: ${name}`);
      }
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    } catch (e) {
      return { content: [{ type: "text", text: `Error: ${e.message}` }], isError: true };
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`library-mcp v${VERSION} ready — ${BASE_URL}`);
}

if (require.main === module) {
  main().catch((e) => {
    console.error("Fatal:", e.message);
    process.exit(1);
  });
}

module.exports = { TOOLS, resolveFlagshipBook, slugify, FLAGSHIP_BOOKS, buildBaseHttpClient };
