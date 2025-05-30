---
id: contributing
title: Contributing
sidebar_label: Contributing
---

We welcome contributions to the AI News Aggregator project! Whether it's bug fixes, new features, documentation improvements, or new plugins, your help is appreciated.

## How to Contribute

1.  **Fork the Repository:** Start by forking the main repository to your own GitHub account.

2.  **Clone Your Fork:**
    ```bash
    git clone https://github.com/YourGitHubUser/ai-news.git # Replace YourGitHubUser
    cd ai-news
    ```

3.  **Create a Feature Branch:**
    It's best to make your changes in a new branch:
    ```bash
    git checkout -b feature/your-amazing-feature-name
    ```
    Or for a bug fix:
    ```bash
    git checkout -b fix/issue-description
    ```

4.  **Make Your Changes:** Implement your feature, fix the bug, or improve the documentation.
    *   Ensure your code adheres to the existing style and practices.
    *   If adding new features or plugins, consider adding relevant documentation or updating existing docs.
    *   If you add new dependencies, update `package.json`.

5.  **Test Your Changes:** (Details on testing strategy would go here - e.g., `npm test` if tests are set up).
    *   Ensure the application builds correctly: `npm run build`.
    *   Run the application locally with relevant configurations to test your changes.

6.  **Commit Your Changes:**
    Use clear and descriptive commit messages.
    ```bash
    git add .
    git commit -m "feat: Add amazing new feature for X"
    # or
    git commit -m "fix: Resolve issue Y in Z component"
    ```

7.  **Push to Your Fork:**
    ```bash
    git push origin feature/your-amazing-feature-name
    ```

8.  **Open a Pull Request (PR):**
    *   Go to the original repository on GitHub.
    *   You should see a prompt to create a Pull Request from your recently pushed branch. Click it.
    *   Provide a clear title and a detailed description for your PR, explaining the changes and why they were made.
    *   If your PR addresses an existing issue, link it (e.g., "Closes #123").

## Development Guidelines

-   Follow the existing coding style (e.g., TypeScript, ESLint/Prettier if configured).
-   When adding new plugins, ensure they implement the correct interfaces from `src/types.ts` or relevant plugin type definition files.
-   Update or add documentation (READMEs, Docusaurus docs) as necessary for new features or significant changes.
-   Ensure environment variables are used for sensitive data; do not hardcode API keys or secrets.

## Questions?

If you have questions or want to discuss a potential contribution, feel free to open an issue on GitHub. 