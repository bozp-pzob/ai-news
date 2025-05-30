---
id: introduction
title: Introduction
slug: /
sidebar_label: Introduction
---

# Welcome to the AI News Aggregator Documentation

The AI News Aggregator is a modular, TypeScript-based application designed to collect, enrich, analyze, and summarize content from a variety of online sources. It leverages a flexible plugin system and AI capabilities to provide powerful data aggregation and insights.

This documentation will guide you through understanding its features, setting up your environment, configuring the application, and understanding its architecture.

## Key Features Overview

- **Modular Plugin System:** Easily extendable with plugins for data sources, AI processing, content enrichment, summary generation, and storage.
- **Diverse Data Sources:** Pre-built plugins for platforms like Discord, GitHub, Twitter, and various Cryptocurrency Analytics APIs (Codex, CoinGecko, DexScreener), plus support for generic REST APIs.
- **AI-Powered Processing:** Automated content summarization and optional enrichments (e.g., topic extraction, image generation) using configurable AI providers like OpenAI and OpenRouter.
- **Flexible Storage & Output:** Utilizes SQLite for persistent data storage and can generate summaries and data exports in JSON and Markdown formats.
- **Historical Data Capabilities:** Includes a dedicated script for fetching and processing data from past dates or date ranges.
- **Configuration-Driven:** Application behavior is primarily controlled by JSON configuration files and environment variables for sensitive data.

## Getting Started

To get started with the AI News Aggregator, head over to the [Installation](./getting-started/installation.md) guide.

If you want to understand more about the different components, the [Core Concepts](./core-concepts/project-structure.md) section is a good place to begin. 