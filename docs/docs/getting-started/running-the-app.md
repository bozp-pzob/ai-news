---
id: running-the-app
title: Running the Application
sidebar_label: Running the App
---

Once you have [installed](./installation.md) the dependencies and [configured](./configuration.md) your environment variables and JSON pipeline files, you can run the AI News Aggregator.

## Building the Project

First, compile the TypeScript code into JavaScript:

```bash
npm run build
```

This command typically uses `tsc` (the TypeScript compiler) to output JavaScript files into a `dist/` directory (or as configured in `tsconfig.json`).

## Running the Main Continuous Process

To start the aggregator for continuous data fetching and summary generation, use the `npm start` command. This executes the `src/index.ts` script.

*   **Default Configuration:**

    ```bash
    npm start
    ```
    By default, this will attempt to load its configuration from `config/sources.json`.

*   **Using a Specific Configuration File:**

    You can specify which JSON configuration file to use with the `--source` argument:

    ```bash
    npm start -- --source=discord-raw.json
    # or
    npm start -- --source=elizaos.json
    ```
    Replace `discord-raw.json` or `elizaos.json` with the name of your desired configuration file from the `config/` directory.

*   **Output Path:**

    You can specify a base output directory for generated files (like summaries or raw data exports) using the `--output` or `-o` flag:
    ```bash
    npm start -- --source=myconfig.json --output=./data_exports/my_project
    ```
    If not specified, it defaults to `./` (the project root), and plugins might create subdirectories like `output/` within that.

*   **Other Flags for `index.ts`:**
    *   `--onlyFetch=true`: Only fetches new data from sources and stores it; skips summary generation.
    *   `--onlyGenerate=true`: Only generates summaries from already existing data in storage; skips fetching new data.
    (These can also be set within the `settings` object of a JSON configuration file, e.g., `"settings": {"runOnce": true, "onlyFetch": true}`).

## Running the Historical Script

To fetch data for past dates or generate summaries for historical periods, use the `npm run historical` command. This executes the `src/historical.ts` script.

*   **Basic Historical Run (processes yesterday by default for the specified source config):

    ```bash
    npm run historical -- --source=discord-raw.json --output=./output/discord_historical
    ```

*   **For a Specific Date:**

    ```bash
    npm run historical -- --source=elizaos.json --date=2024-01-15 --output=./output/elizaos_history
    ```

*   **For a Date Range:**

    ```bash
    # Fetch data between January 10, 2024, and January 16, 2024 (inclusive)
    npm run historical -- --source=hyperfy-discord.json --after=2024-01-10 --before=2024-01-16 --output=./output/hyperfy_range
    ```

*   **For Dates After a Specific Date (up to current date):

    ```bash
    npm run historical -- --source=discord-raw.json --after=2024-01-15 --output=./output/discord_after
    ```

*   **For Dates Before a Specific Date (from a hardcoded earliest date, e.g., 2024-01-01, up to the specified date):

    ```bash
    npm run historical -- --source=discord-raw.json --before=2024-01-10 --output=./output/discord_before
    ```
    *(Note: The `dateHelper.ts` for `--before` without `--after` might have a fixed earliest start date, review its behavior if needed)*

*   **Twitter Specific Fetch Mode for Historical Data:**

    The `TwitterSource` plugin supports different modes for fetching historical tweets.
    ```bash
    npm run historical -- --source=config_with_twitter.json --date=2023-05-10 --fetchMode=timeline
    ```
    *   `--fetchMode=search` (Default for `historical.ts` if not specified in config or CLI): Uses Twitter search. Faster, good for original tweets on specific dates.
    *   `--fetchMode=timeline`: Scans user timelines. More comprehensive for retweets but slower.

*   **Other Flags for `historical.ts`:**
    *   `--onlyFetch=true`: Only fetches historical data; skips summary generation.
    *   `--onlyGenerate=true`: Only generates summaries for historical data already in storage; skips fetching.

For a full list of options for the historical script, you can add a help flag or consult its implementation:
```bash
npm run historical -- --help
```

## Stopping the Application

For the continuous process started with `npm start` (that isn't in `runOnce` mode), you can stop it by pressing `Ctrl+C` in the terminal where it's running. The application has graceful shutdown handlers to close database connections properly. 