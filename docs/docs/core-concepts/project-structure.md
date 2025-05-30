---
id: project-structure
title: Project Structure
sidebar_label: Project Structure
---

Understanding the project's directory layout is key to navigating the codebase.

```
.github/
  workflows/          # GitHub Actions for automated tasks (e.g., daily data fetching, builds)
config/                 # JSON configuration files defining various data pipelines
data/                   # SQLite database files (often encrypted in the repository)
docs/                   # Docusaurus documentation source files (what you're reading now!)
output/                 # Default directory for generated files (summaries, raw data exports)
src/                    # Core TypeScript source code of the application
├── README.md           # Detailed overview of the src/ directory and its subdirectories
├── aggregator/         # Contains aggregation logic (ContentAggregator, HistoricalAggregator)
├── plugins/            # Modular components: ai, enrichers, generators, sources, storage
├── helpers/            # Utility functions (config loading, date handling, file I/O, etc.)
├── types.ts            # Central TypeScript type definitions and interfaces
├── index.ts            # Main entry point for continuous, scheduled operation
└── historical.ts       # Entry point for fetching and processing past data
.env                    # Local environment variables (ignored by Git, created from example.env)
example.env             # Template for the .env file
package.json            # Project dependencies, scripts, and metadata
README.md               # Main project README file
# ... and other standard project files like tsconfig.json, .gitignore, etc.
```

**Key Directories:**

-   **`config/`**: Holds JSON files that define different data processing pipelines. Each file specifies which sources to use, how to process the data (AI providers, enrichers), where to store it, and what summaries or exports to generate.
-   **`data/`**: Typically where SQLite database files are stored. These might be encrypted if the repository is public.
-   **`docs/`**: Contains the source files for this Docusaurus documentation site.
-   **`src/`**: This is the heart of the application, containing all the TypeScript code.
    -   **`src/aggregator/`**: Manages the overall flow of fetching data from sources, processing it through enrichers, and saving it to storage.
    -   **`src/plugins/`**: The core of the modular system. It's further divided into subdirectories for each plugin type (`ai`, `enrichers`, `generators`, `sources`, `storage`). Each plugin handles a specific task.
    -   **`src/helpers/`**: Contains utility functions that support various parts of the application, such as loading configurations, handling dates, file operations, and generating AI prompts.
    -   **`src/types.ts`**: Defines all the common TypeScript interfaces and types (like `ContentItem` and `SummaryItem`) used to ensure data consistency across different modules.
    -   **`src/index.ts`**: The main script for running the aggregator in a continuous mode, periodically fetching new data and generating summaries based on configured intervals.
    -   **`src/historical.ts`**: A separate script for on-demand fetching and processing of data from past dates or date ranges.
-   **`output/`**: The default location where generated files (like Markdown summaries or JSON data exports) are saved by some generator plugins.

For a deeper dive into the `src` directory and its components, refer to the `README.md` files located within `src/` and its subdirectories (e.g., `src/plugins/README.md`). 