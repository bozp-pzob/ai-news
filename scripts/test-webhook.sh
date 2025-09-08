#!/bin/bash

# Test script for webhook server
# Usage: ./test-webhook.sh [config] [date]

set -euo pipefail

# Configuration
URL="http://127.0.0.1:3000/run-collect"
SECRET="${COLLECT_WEBHOOK_SECRET:-test-secret-123}"
CONFIG="${1:-elizaos.json}"
DATE="${2:-}"

# Create payload (compact JSON to match what server expects)
PAYLOAD=$(jq -nc \
  --arg config "$CONFIG" \
  --arg date "$DATE" \
  '{config: $config, date: $date}')

# Generate HMAC signature (GitHub uses sha256= format)
SIGNATURE="sha256=$(printf '%s' "$PAYLOAD" | openssl dgst -sha256 -hmac "$SECRET" -binary | xxd -p -c 256)"

echo "Testing webhook with:"
echo "  URL: $URL"
echo "  Config: $CONFIG"
echo "  Date: ${DATE:-yesterday}"
echo "  Payload: $PAYLOAD"
echo ""

# Send request
echo "Sending request..."
curl -v -X POST "$URL" \
  -H "Content-Type: application/json" \
  -H "X-Hub-Signature-256: $SIGNATURE" \
  --data "$PAYLOAD"

echo ""
echo "Test complete!"