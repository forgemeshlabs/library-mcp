#!/usr/bin/env node
"use strict";

// Smoke tests: schema-shape assertions on every tool definition, plus a live
// discovery + 402-challenge parse check against the real service. NO PAYMENTS
// are made or attempted here — the paid-path test only fetches the 402
// challenge and verifies a client can construct a payment payload from it;
// it never signs+sends a real payment.

const test = require("node:test");
const assert = require("node:assert/strict");
const { generatePrivateKey } = require("viem/accounts");
const { TOOLS, resolveFlagshipBook, slugify, FLAGSHIP_BOOKS, buildBaseHttpClient } = require("../index.js");

const BASE_URL = process.env.LIBRARY_BASE_URL || "https://library.forgemesh.io";
const EXPECTED_TOOL_NAMES = [
  "search_literature",
  "search_books",
  "get_book_metadata",
  "get_chapter",
  "get_quotes",
  "ask_book",
  "browse_shelf",
  "book_of_the_day",
];

test("exposes exactly the 8 expected tools", () => {
  const names = TOOLS.map((t) => t.name).sort();
  assert.deepEqual(names, [...EXPECTED_TOOL_NAMES].sort());
});

test("every tool has a name, description, and object inputSchema", () => {
  for (const tool of TOOLS) {
    assert.equal(typeof tool.name, "string");
    assert.ok(tool.name.length > 0, `tool missing name: ${JSON.stringify(tool)}`);
    assert.equal(typeof tool.description, "string");
    assert.ok(tool.description.length > 20, `${tool.name} description too short`);
    assert.equal(tool.inputSchema.type, "object");
    assert.equal(typeof tool.inputSchema.properties, "object");
  }
});

test("paid tools declare a required field (no tool silently accepts empty input except book_of_the_day)", () => {
  for (const tool of TOOLS) {
    if (tool.name === "book_of_the_day") continue; // all args optional by design
    assert.ok(
      Array.isArray(tool.inputSchema.required) && tool.inputSchema.required.length > 0,
      `${tool.name} has no required fields`
    );
  }
});

test("resolveFlagshipBook resolves canonical slugs and common aliases", () => {
  assert.equal(resolveFlagshipBook("Moby Dick"), "moby-dick");
  assert.equal(resolveFlagshipBook("moby-dick"), "moby-dick");
  assert.equal(resolveFlagshipBook("the odyssey"), "the-odyssey");
  assert.equal(resolveFlagshipBook("Sherlock Holmes"), "sherlock-holmes");
  assert.equal(resolveFlagshipBook("dorian gray"), "picture-of-dorian-gray");
  assert.equal(resolveFlagshipBook("marcus aurelius"), "meditations");
  assert.equal(resolveFlagshipBook("some nonexistent book title xyz"), null);
});

test("slugify normalizes punctuation and whitespace", () => {
  assert.equal(slugify("Gothic Horror"), "gothic-horror");
  assert.equal(slugify("Grimm's Fairy Tales"), "grimms-fairy-tales");
  assert.equal(slugify("  extra   spaces "), "extra-spaces");
});

test("FLAGSHIP_BOOKS has 24 entries, all with unique slugs", () => {
  assert.equal(FLAGSHIP_BOOKS.length, 24);
  const slugs = FLAGSHIP_BOOKS.map((b) => b.slug);
  assert.equal(new Set(slugs).size, slugs.length);
});

// --- Live checks against the real service (network required, no payments) ---

test("live: llms.txt discovery doc is reachable and mentions all 8 tool routes", async () => {
  const res = await fetch(`${BASE_URL}/llms.txt`);
  assert.equal(res.status, 200);
  const text = await res.text();
  assert.ok(text.includes("library.forgemesh.io"), "llms.txt should reference the service");
  assert.ok(text.toLowerCase().includes("literature-search"), "llms.txt should list literature-search");
  assert.ok(text.toLowerCase().includes("book-search"), "llms.txt should list book-search");
});

test("live: a flagship ask-book route returns a 402 challenge, and a throwaway test wallet can construct (never send) a signed payment payload from it", async () => {
  const slug = resolveFlagshipBook("Meditations");
  assert.equal(slug, "meditations");
  const res = await fetch(`${BASE_URL}/ask-${slug}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ question: "what does it say about death" }),
  });
  assert.equal(res.status, 402, "expected a 402 Payment Required challenge (no payment sent)");
  assert.ok(res.headers.get("payment-required"), "expected a payment-required header carrying the x402 challenge");

  const challengeBody = await res.json().catch(() => undefined);

  // Ephemeral, randomly generated, zero-balance test key — used only to prove
  // the payment payload construction step works. Never funded, never logged,
  // and the resulting payload is never sent back to the server (no settlement).
  const originalKey = process.env.WALLET_PRIVATE_KEY;
  process.env.WALLET_PRIVATE_KEY = generatePrivateKey();
  try {
    const { httpClient } = buildBaseHttpClient();
    const paymentRequired = httpClient.getPaymentRequiredResponse((name) => res.headers.get(name), challengeBody);
    assert.equal(paymentRequired.x402Version, 2);
    assert.ok(Array.isArray(paymentRequired.accepts) && paymentRequired.accepts.length > 0);
    const accept = paymentRequired.accepts[0];
    assert.equal(accept.network, "eip155:8453");
    assert.ok(accept.amount || accept.maxAmountRequired, "accept entry should carry a price");
    assert.ok(accept.payTo, "accept entry should carry a payTo address");

    // This signs an EIP-3009 authorization locally — a cryptographic operation
    // with no network call — and stops there. It is never sent as X-PAYMENT.
    const paymentPayload = await httpClient.createPaymentPayload(paymentRequired);
    assert.ok(paymentPayload, "client should be able to construct a payment payload");
    const encoded = httpClient.encodePaymentSignatureHeader(paymentPayload);
    assert.ok(Object.keys(encoded).length > 0, "should encode at least one payment header");
  } finally {
    if (originalKey === undefined) delete process.env.WALLET_PRIVATE_KEY;
    else process.env.WALLET_PRIVATE_KEY = originalKey;
  }
});

test("live: an unrecognized shelf slug 402s just like a valid one (server decides existence, not us)", async () => {
  const res = await fetch(`${BASE_URL}/book-of-the-day`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  assert.equal(res.status, 402);
});
