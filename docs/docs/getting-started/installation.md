---
id: installation
title: Installation & Setup
sidebar_label: Installation & Setup
---

import Tabs from '@theme/Tabs';
import TabItem from '@theme/TabItem';

Before you begin, ensure you have the following prerequisites installed on your system:

-   **Node.js:** Version 18 or higher is recommended. You can download it from [nodejs.org](https://nodejs.org/).
-   **npm (Node Package Manager):** Typically comes bundled with Node.js.
-   **TypeScript:** While `npm install` will install it as a project dependency, having it globally (`npm install -g typescript`) can be useful.
-   **SQLite3 (Command-Line Tool):** Required for database operations.

    <Tabs groupId="os" defaultValue="mac">
    <TabItem value="mac" label="macOS">
    Install SQLite via Homebrew:
    ```bash
    brew install sqlite
    ```
    </TabItem>
    <TabItem value="linux" label="Debian/Ubuntu Linux">
    Install SQLite using apt:
    ```bash
    sudo apt-get update
    sudo apt-get install sqlite3
    ```
    </TabItem>
    <TabItem value="windows" label="Windows">
    Download the SQLite command-line tools (sqlite-tools-win32-x*.zip) from the [SQLite Download Page](https://www.sqlite.org/download.html) and add the directory containing `sqlite3.exe` to your system's PATH.
    </TabItem>
    </Tabs>

## Installation Steps

1.  **Clone the Repository:**

    ```bash
    git clone https://github.com/m3-org/ai-news.git
    cd ai-news
    ```

2.  **Install Dependencies:**

    The project uses `npm` to manage dependencies. Run the following command in the project root directory:

    ```bash
    npm install
    ```

3.  **Set Up Environment Variables:**

    The application requires API keys and other sensitive information to be stored in an environment file.

    *   Copy the example environment file:
        ```bash
        cp example.env .env
        ```
    *   Open the newly created `.env` file in a text editor.
    *   Fill in your actual API keys, tokens, and other necessary values as indicated by the placeholders and comments in the file. Refer to the [Configuration](./configuration.md#local-env-file) section for more details on the required variables.

    **Important:** The `.env` file is included in `.gitignore` and should **never** be committed to version control.

After these steps, the application code and its dependencies will be installed, and you'll be ready to configure and run it. Next, proceed to the [Configuration](./configuration.md) guide. 