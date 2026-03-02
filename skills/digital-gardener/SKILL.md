---
name: digital-gardener
description: >
  Fetch structured community intelligence from Discord, GitHub, and Telegram.
  Search 100+ communities, get AI summaries, raw discussion data, trending
  topics, and contributor stats. Pay-per-query with USDC on Solana via the
  x402 payment protocol. Free tier available for discovery and topics.
version: 1.0.0
metadata:
  openclaw:
    requires:
      bins:
        - curl
    emoji: "\U0001F331"
    homepage: https://digitalgardener.com
---

# Digital Gardener

Digital Gardener is a community intelligence platform that aggregates, enriches, and summarizes content from Discord, GitHub, and Telegram. It provides structured data and AI-generated summaries for 100+ communities, accessible via a REST API with optional pay-per-query access using USDC on Solana.

## Base URL

```
https://digitalgardener.com/api/v1
```

All endpoints below are relative to this base URL.

---

## Quick Start (Free Tier)

These endpoints require no authentication or payment.

### List available communities

```bash
curl https://digitalgardener.com/api/v1/configs
```

Returns all public communities with their IDs, names, slugs, and descriptions. Use the `id` or `slug` from the response to query specific communities.

**Query parameters:** `search`, `sort` (trending, newest, popular), `limit`, `offset`

```bash
# Search for a specific community
curl "https://digitalgardener.com/api/v1/configs?search=eliza&limit=5"
```

### Featured communities

```bash
curl https://digitalgardener.com/api/v1/configs/featured
```

### Get community details

```bash
curl https://digitalgardener.com/api/v1/configs/{configId}
```

Returns metadata including name, description, sources, data date range, and monetization status.

### Get trending topics

```bash
curl https://digitalgardener.com/api/v1/configs/{configId}/topics
```

Returns topic keywords with frequency counts. Useful for understanding what a community is currently discussing.

**Query parameters:** `limit` (default 20), `after_date`, `before_date`

### Get statistics

```bash
curl https://digitalgardener.com/api/v1/configs/{configId}/stats
```

Returns total content items, date range coverage, active sources, and contributor counts.

### Health check

```bash
curl https://digitalgardener.com/api/v1/health
```

---

## Paid Data Access (x402 Protocol)

Rich data endpoints -- context, summaries, raw items, and semantic search -- use the HTTP 402 payment protocol for monetized communities. Payment is in USDC on Solana.

> **Note:** Not all communities are monetized. If a community has `monetization_enabled: false` or `price_per_query: 0`, the data is freely accessible. Check the config details endpoint to see the monetization status.

### How the payment flow works

**Step 1: Request the data**

```bash
curl -i https://digitalgardener.com/api/v1/configs/{configId}/context
```

If the community requires payment, you receive an HTTP 402 response:

```
HTTP/1.1 402 Payment Required
X-Payment-Required: {...}
X-Payment-Amount: 1000
X-Payment-Currency: USDC
X-Payment-Network: solana
X-Payment-Recipient: <owner_wallet_address>
X-Payment-Memo: ctx:<configId>:<timestamp>:<random>
X-Payment-Expires: 2026-03-01T12:05:00.000Z
```

Response body:

```json
{
  "error": "Payment Required",
  "code": "PAYMENT_REQUIRED",
  "payment": {
    "amount": "1000",
    "currency": "USDC",
    "network": "solana",
    "recipient": "<owner_wallet_address>",
    "platformWallet": "<platform_wallet_address>",
    "platformFee": "100",
    "facilitatorUrl": "https://facilitator.pop402.com",
    "memo": "ctx:<configId>:<timestamp>:<random>",
    "expiresAt": "2026-03-01T12:05:00.000Z"
  }
}
```

The `amount` is in the smallest USDC unit (6 decimals). `1000` = 0.001 USDC.

**Step 2: Create a Solana USDC transaction**

Send the exact `amount` of USDC to the `recipient` wallet address. Include the `memo` from the 402 response in the transaction. Submit the transaction to the Solana network and obtain the transaction signature.

**Step 3: Retry with payment proof**

```bash
curl https://digitalgardener.com/api/v1/configs/{configId}/context \
  -H 'X-Payment-Proof: {"signature":"<solana_tx_signature>","memo":"ctx:<configId>:<timestamp>:<random>"}'
```

The server verifies the payment via the facilitator and returns the data.

### 24-hour access grants

Instead of paying per query, you can purchase 24 hours of unlimited access to a community's data:

```bash
# Step 1: Check access status
curl https://digitalgardener.com/api/v1/configs/{configId}/access

# Step 2: Initiate purchase (returns 402 with payment details)
curl -X POST https://digitalgardener.com/api/v1/configs/{configId}/access/purchase \
  -H 'Content-Type: application/json' \
  -d '{"walletAddress": "<your_solana_wallet>"}'

# Step 3: Complete purchase with payment proof
curl -X POST https://digitalgardener.com/api/v1/configs/{configId}/access/purchase \
  -H 'Content-Type: application/json' \
  -H 'X-Payment-Proof: {"signature":"<tx_sig>","memo":"access:<configId>:<timestamp>:<random>"}' \
  -d '{"walletAddress": "<your_solana_wallet>"}'
```

After purchase, all data endpoints for that community work without per-query payment for 24 hours.

---

## Data Endpoints

### Get LLM-optimized context

Best endpoint for feeding community intelligence into an LLM context window.

```bash
# JSON format (structured)
curl https://digitalgardener.com/api/v1/configs/{configId}/context

# Plain text format (optimized for LLM context windows)
curl "https://digitalgardener.com/api/v1/configs/{configId}/context?format=text"

# For a specific date
curl "https://digitalgardener.com/api/v1/configs/{configId}/context?date=2026-02-28&format=text"

# Limit output length (in characters)
curl "https://digitalgardener.com/api/v1/configs/{configId}/context?format=text&maxLength=8000"
```

**Query parameters:** `format` (json, text), `date` (YYYY-MM-DD), `maxLength`

### Get AI-generated summary

```bash
curl https://digitalgardener.com/api/v1/configs/{configId}/summary

# For a specific date
curl "https://digitalgardener.com/api/v1/configs/{configId}/summary?date=2026-02-28"
```

Returns the AI-generated daily summary including highlights, key discussions, and notable events.

### Get raw content items

```bash
curl "https://digitalgardener.com/api/v1/configs/{configId}/items?limit=50"
```

Returns individual content items (messages, PRs, issues, commits) from the community's sources.

**Query parameters:** `source`, `type`, `limit`, `offset`

### Get generated summaries list

```bash
curl "https://digitalgardener.com/api/v1/configs/{configId}/content?limit=10"
```

Returns a paginated list of all generated summaries for a community.

**Query parameters:** `type`, `limit`, `offset`

---

## Semantic Search

Search across community content using natural language queries. Powered by vector embeddings.

### POST search (single community)

```bash
curl -X POST https://digitalgardener.com/api/v1/search \
  -H 'Content-Type: application/json' \
  -d '{
    "configId": "<configId>",
    "query": "token launch announcement",
    "limit": 10,
    "afterDate": "2026-02-01",
    "beforeDate": "2026-03-01"
  }'
```

### GET search (single community)

```bash
curl "https://digitalgardener.com/api/v1/search/{configId}?q=token+launch&limit=10&after=2026-02-01"
```

### Multi-community search

```bash
curl -X POST https://digitalgardener.com/api/v1/search/multi \
  -H 'Content-Type: application/json' \
  -d '{
    "configIds": ["<configId1>", "<configId2>"],
    "query": "governance proposal",
    "limit": 10
  }'
```

**Search parameters:** `query` (required), `limit` (max 50), `threshold` (similarity, 0-1), `type`, `source`, `afterDate`/`after`, `beforeDate`/`before`

---

## Endpoint Reference

| Endpoint | Method | Free? | Description |
|----------|--------|-------|-------------|
| `/configs` | GET | Yes | List public communities |
| `/configs/featured` | GET | Yes | Featured communities |
| `/configs/{id}` | GET | Yes | Community details |
| `/configs/{id}/topics` | GET | Yes | Trending topics |
| `/configs/{id}/stats` | GET | Yes | Statistics |
| `/configs/{id}/access` | GET | Yes | Check access status |
| `/configs/{id}/context` | GET | Paid* | LLM-optimized context |
| `/configs/{id}/summary` | GET | Paid* | AI-generated summary |
| `/configs/{id}/items` | GET | Preview* | Raw content items |
| `/configs/{id}/content` | GET | Preview* | Generated summaries |
| `/search` | POST | Paid* | Semantic search |
| `/search/{configId}` | GET | Paid* | Semantic search (GET) |
| `/search/multi` | POST | Paid* | Multi-community search |
| `/health` | GET | Yes | Health check |
| `/me/plans` | GET | Yes | Subscription plans |

*Only for monetized communities. Non-monetized communities provide data freely.

## Rate Limits

| Endpoint Category | Limit |
|-------------------|-------|
| Data (context, summary, items, content, topics, stats) | 30 requests/minute |
| Search | 10 requests/minute |
| Run/generate | 5 requests/minute |

## OpenAPI Specification

A machine-readable OpenAPI 3.1 specification is available at:

```
https://digitalgardener.com/api/v1/openapi.json
```

## Agent Discovery

Standard discovery files are served at:

- `https://digitalgardener.com/.well-known/ai-plugin.json` -- Agent plugin manifest
- `https://digitalgardener.com/robots.txt` -- Crawling rules
