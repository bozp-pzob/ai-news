# AI News Aggregator

A modular TypeScript-based news aggregator that collects, enriches, and analyzes AI-related content from multiple sources using OpenAI's GPT models.

## Features

- **Multiple Data Sources**
  - Twitter posts monitoring
  - Discord channel messages and announcements
  - GitHub activity tracking
  - Solana token analytics
  - CoinGecko market data

- **Content Enrichment**
  - AI-powered topic extraction
  - Automated content summarization 
  - Image generation capabilities

- **Storage & Analysis**
  - SQLite database for persistent storage
  - Daily summary generation
  - JSON export functionality

## Prerequisites

- Node.js ≥ 18
- TypeScript 4.x
- SQLite3

## Installation

```bash
# Clone the repository
git clone https://github.com/yourusername/ai-news.git

# Install dependencies
cd ai-news
npm install

# Create .env file and add your credentials
cp example.env .env
```

## Configuration

Create a `.env` file with the following variables:

```env
OPENAI_API_KEY=           # Your OpenAI API key or OpenRouter API key
OPENAI_DIRECT_KEY=        # Optional: Your OpenAI API key for image generation when using OpenRouter
USE_OPENROUTER=false      # Set to true to use OpenRouter
SITE_URL=                 # Your site URL for OpenRouter rankings
SITE_NAME=                # Your site name for OpenRouter rankings

# Other existing configurations...
TWITTER_USERNAME=         # Account username
TWITTER_PASSWORD=         # Account password
TWITTER_EMAIL=            # Account email

DISCORD_APP_ID=
DISCORD_TOKEN=
```

## GitHub Actions Secrets Single File


1. Navigate to your GitHub repository
2. Go to "Settings" > "Secrets and variables" > "Actions"
3. Click "New repository secret"
4. Copy the JSON with your credentials
5. Save name as "ENV_SECRETS"

```json
{
  "TWITTER_USERNAME": "",
  "TWITTER_PASSWORD": "",
  "TWITTER_EMAIL": "",
  "OPENAI_API_KEY": "",
  "OPENAI_DIRECT_KEY": "",
  "USE_OPENROUTER": "",
  "SITE_URL": "",
  "SITE_NAME": "",
  "DISCORD_APP_ID": "",
  "DISCORD_TOKEN": "",
  "BIRDEYE_API_KEY": ""
}
```

> Note: You'll get notifications about Twitter login from unknown location, maybe best to exclude Twitter

## Running the Application

```bash
# Development mode
npm run dev

# Development mode using the sources.json config
npm run dev -- --source=sources.json

# Build and run production
npm run build
npm start

# Generate daily summary
npm run generator

# Generate daily summary for specific date using the sources.json config
npm run generator -- --source=sources.json --date=2025-01-01 

# Grab Historical Data from sources ( default 60 days )
npm run historical

# Grab Historical Data from the sources.json config ( Specific number of days )
npm run historical -- --source=sources.json --day=10
```

## Project Structure

```
config/                 # JSON-Based Configuration System     
src/
├── aggregator/         # Core aggregation logic
├── plugins/
│   ├── ai/             # AI provider implementations
│   ├── enrichers/      # Content enrichment plugins
│   ├── generators/     # Summary generation tools
│   ├── sources/        # Data source implementations
│   └── storage/        # Database storage handlers
├── types.ts            # TypeScript type definitions
├── index.ts            # Main application entry
└── generator.ts        # Summary generator entry
└── historical.ts       # Grab historical data entry
```

## Adding New Sources

1. Implement the `ContentSource` interface
2. Add configuration in JSON config
3. Run System

Example:
```typescript
class NewSource implements ContentSource {
  public name: string;
  
  async fetchItems(): Promise<ContentItem[]> {
    // Implementation
  }
  async fetchHistorical(): Promise<ContentItem[]> {
    // Implementation for historical fetching if source allows
  }
}
```

## Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

## License

MIT License - see the [LICENSE](LICENSE) file for details

## Data Structures

### ContentItem
Core data structure used throughout the application:
```typescript
interface ContentItem {
  id?: number;          // Assigned by storage
  cid: string;          // Content Id from source
  type: string;         // "tweet", "newsArticle", "discordMessage", etc.
  source: string;       // "twitter", "discord", "github", etc.
  title?: string;       // Optional title
  text?: string;        // Main content text
  link?: string;        // URL to original content
  topics?: string[];    // AI-generated topics
  date?: number;        // Creation/publication timestamp
  metadata?: Record<string, any>; // Additional source-specific data
}
```

### Example JSON Output
Daily summaries are stored in JSON files with this structure:
```json
[
  {
    "title": "Topic Category",
    "messages": [
      {
        "text": "Summary or content text",
        "sources": [
          "https://source1.com/link",
          "https://source2.com/link"
        ],
        "images": [
          "https://image1.com/url"
        ],
        "videos": [
          "https://video1.com/url"
        ]
      }
    ]
  }
]
```

## Supported Source Types

### Twitter
- Monitors specified Twitter accounts
- Captures tweets, retweets, media
- Metadata includes engagement metrics

### Discord
- Channel messages monitoring
- Announcement tracking
- Server activity summaries

### GitHub
- Repository activity tracking
- Pull requests and commits
- Issue tracking and summaries

### Cryptocurrency Analytics
- Token price monitoring (Solana)
- Market data from CoinGecko
- Trading metrics and volume data

## Scheduled Tasks

The application runs hourly tasks via GitHub Actions:
- Twitter monitoring: every 30 minutes
- Discord monitoring: every 6 minutes
- Announcements: hourly
- GitHub data: every 6 hours
- Market analytics: every 12 hours
- Daily summaries: generated once per day

## Environment Variables Reference

```env
# Twitter Authentication
TWITTER_USERNAME=           # Account username
TWITTER_PASSWORD=           # Account password
TWITTER_EMAIL=              # Account email

# OpenAI Configuration
OPENAI_API_KEY=            # API key for GPT models

# Discord Integration
DISCORD_APP_ID=            # Discord application ID
DISCORD_TOKEN=             # Bot token

# Analytics
BIRDEYE_API_KEY=          # Optional: For Solana token analytics
```

## Storage

The application uses SQLite with two main tables:

### Items Table
```sql
CREATE TABLE items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cid TEXT,
  type TEXT NOT NULL,
  source TEXT NOT NULL,
  title TEXT,
  text TEXT,
  link TEXT,
  topics TEXT,
  date INTEGER,
  metadata TEXT
);
```

### Summary Table
```sql
CREATE TABLE summary (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL,
  title TEXT,
  categories TEXT,
  date INTEGER
);
```
