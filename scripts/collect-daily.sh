#!/bin/bash

# Simple daily data collection script
# Usage: ./collect-daily.sh [config] [date]
# Examples:
#   ./collect-daily.sh elizaos.json
#   ./collect-daily.sh hyperfy-discord.json 2025-01-01

CONFIG=${1:-"elizaos.json"}
DATE=${2:-$(date -d "yesterday" +'%Y-%m-%d')}

echo "🚀 Starting data collection..."
echo "📋 Config: $CONFIG"
echo "📅 Date: $DATE"

# Run historical data collection
npm run historical -- --source="$CONFIG" --date="$DATE"

if [ $? -eq 0 ]; then
    echo "✅ Collection completed successfully for $CONFIG on $DATE"
else
    echo "❌ Collection failed for $CONFIG on $DATE"
    exit 1
fi