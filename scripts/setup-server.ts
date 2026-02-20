/**
 * Discord Server Setup Wizard
 *
 * Interactive menu-driven CLI for onboarding and managing Discord server
 * data pipelines. Walks through setup in order, but allows jumping to
 * any step (like the Debian installer).
 *
 * Usage:
 *   npm run setup
 *   npm run setup -- --name=m3org --guild-id=433492168825634816
 */

import * as fs from "fs";
import * as path from "path";
import * as readline from "readline";
import { spawn, spawnSync } from "child_process";
import * as dotenv from "dotenv";

dotenv.config();

const CONFIG_DIR = "./config";
const ENV_FILE = ".env";
const ENV_EXAMPLE_FILE = ".env.example";

// ============================================================================
// Readline helpers
// ============================================================================

function createRL(): readline.Interface {
  return readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
}

function ask(rl: readline.Interface, question: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(question, (answer) => resolve(answer.trim()));
  });
}

function askWithDefault(
  rl: readline.Interface,
  question: string,
  defaultVal: string
): Promise<string> {
  return new Promise((resolve) => {
    rl.question(`${question} [${defaultVal}]: `, (answer) => {
      resolve(answer.trim() || defaultVal);
    });
  });
}

function askYesNo(
  rl: readline.Interface,
  question: string,
  defaultYes = true
): Promise<boolean> {
  const hint = defaultYes ? "Y/n" : "y/N";
  return new Promise((resolve) => {
    rl.question(`${question} [${hint}]: `, (answer) => {
      const a = answer.trim().toLowerCase();
      if (a === "") resolve(defaultYes);
      else resolve(a === "y" || a === "yes");
    });
  });
}

function askChoice(
  rl: readline.Interface,
  question: string,
  options: string[]
): Promise<number> {
  return new Promise((resolve) => {
    console.log(question);
    options.forEach((opt, i) => console.log(`  [${i + 1}] ${opt}`));
    rl.question("Choice: ", (answer) => {
      const num = parseInt(answer.trim(), 10);
      if (num >= 1 && num <= options.length) resolve(num - 1);
      else {
        console.log("Invalid choice, using first option.");
        resolve(0);
      }
    });
  });
}

// ============================================================================
// Validation
// ============================================================================

function isValidSlug(name: string): boolean {
  return /^[a-z0-9]+(-[a-z0-9]+)*$/.test(name);
}

function isValidSnowflake(id: string): boolean {
  return /^\d{17,20}$/.test(id);
}

// ============================================================================
// Env file helpers
// ============================================================================

function readEnvFile(filePath: string): string {
  if (!fs.existsSync(filePath)) return "";
  return fs.readFileSync(filePath, "utf8");
}

function appendEnvVar(filePath: string, key: string, value: string): void {
  const content = readEnvFile(filePath);
  if (content.includes(`${key}=`)) {
    console.log(`  ${key} already exists in ${filePath}, skipping.`);
    return;
  }
  const line = `${key}=${value}\n`;
  fs.appendFileSync(filePath, line);
  console.log(`  Added ${key} to ${filePath}`);
}

function findEnvTokenVars(): string[] {
  const content = readEnvFile(ENV_FILE);
  const tokens: string[] = [];
  for (const line of content.split("\n")) {
    const match = line.match(/^([A-Z_]*TOKEN[A-Z_]*)=/);
    if (match && !line.startsWith("#")) {
      tokens.push(match[1]);
    }
  }
  return tokens;
}

// ============================================================================
// Config template
// ============================================================================

function generateConfig(
  name: string,
  tokenEnvVar: string,
  guildIdEnvVar: string,
  channelIds: string[] = [],
  mediaEnabled = false
): object {
  const pascalName = name
    .split("-")
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join("");

  return {
    settings: { runOnce: true },
    sources: [
      {
        type: "DiscordRawDataSource",
        name: `${name.replace(/-/g, "")}DiscordRaw`,
        interval: 360000,
        params: {
          botToken: `process.env.${tokenEnvVar}`,
          guildId: `process.env.${guildIdEnvVar}`,
          channelIds,
          storage: "SQLiteStorage",
          mediaDownload: {
            enabled: mediaEnabled,
            outputPath: `./${name}-media`,
            maxFileSize: 52428800,
            rateLimit: 100,
            retryAttempts: 3,
          },
        },
      },
    ],
    ai: [
      {
        type: "OpenAIProvider",
        name: "summaryOpenAiProvider",
        params: {
          apiKey: "process.env.OPENAI_API_KEY",
          model: "anthropic/claude-sonnet-4.5",
          temperature: 0,
          useOpenRouter: true,
          siteUrl: "process.env.SITE_URL",
          siteName: "process.env.SITE_NAME",
          fallbackModel: "openrouter/sonoma-sky-alpha",
        },
      },
    ],
    enrichers: [],
    storage: [
      {
        type: "SQLiteStorage",
        name: "SQLiteStorage",
        params: { dbPath: `data/${name}.sqlite` },
      },
    ],
    generators: [
      {
        type: "RawDataExporter",
        name: `${pascalName}RawExporter`,
        interval: 3600000,
        params: {
          storage: "SQLiteStorage",
          source: "discordRawData",
          outputPath: `./output/${name}/raw`,
        },
      },
      {
        type: "DiscordSummaryGenerator",
        name: `${pascalName}DiscordSummaryGenerator`,
        interval: 3600000,
        params: {
          provider: "summaryOpenAiProvider",
          storage: "SQLiteStorage",
          summaryType: `${name.replace(/-/g, "")}DiscordSummary`,
          source: "discordRawData",
          outputPath: `./output/${name}/summaries`,
        },
      },
    ],
  };
}

// ============================================================================
// Run subprocess
// ============================================================================

function runCommand(cmd: string, args: string[]): Promise<number> {
  return new Promise((resolve) => {
    console.log(`\n  $ ${cmd} ${args.join(" ")}\n`);
    const child = spawn(cmd, args, {
      stdio: "inherit",
      shell: true,
      cwd: process.cwd(),
    });
    child.on("close", (code) => resolve(code ?? 1));
  });
}

// ============================================================================
// Channel helpers
// ============================================================================

interface DiscoveredChannel {
  id: string;
  name: string;
  categoryName: string | null;
  isMuted: boolean;
}

function getDiscoveredChannels(dbPath: string): DiscoveredChannel[] {
  try {
    const result = spawnSync(
      "sqlite3",
      [
        dbPath,
        "-json",
        "SELECT id, name, categoryName, isMuted FROM discord_channels WHERE isMuted = 0 ORDER BY categoryName, position",
      ],
      { encoding: "utf8" }
    );
    if (result.status !== 0 || !result.stdout.trim()) return [];
    return JSON.parse(result.stdout);
  } catch {
    return [];
  }
}

function updateConfigChannelIds(configPath: string, channelIds: string[]): void {
  const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
  if (config.sources?.[0]?.params) {
    config.sources[0].params.channelIds = channelIds;
  }
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n");
}

function getDbDateRange(dbPath: string): { min: string; max: string } | null {
  try {
    const result = spawnSync(
      "sqlite3",
      [
        dbPath,
        "SELECT MIN(date), MAX(date) FROM items WHERE type='discordRawData'",
      ],
      { encoding: "utf8" }
    );
    if (result.status !== 0 || !result.stdout.trim()) return null;
    const [min, max] = result.stdout.trim().split("|");
    if (!min || !max) return null;
    return { min: min.split("T")[0], max: max.split("T")[0] };
  } catch {
    return null;
  }
}

function updateConfigMedia(configPath: string, enabled: boolean): void {
  const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
  if (config.sources?.[0]?.params?.mediaDownload) {
    config.sources[0].params.mediaDownload.enabled = enabled;
  }
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n");
}

interface AnalyzedChannel {
  id: string;
  name: string;
  categoryName: string | null;
  aiRecommendation: string | null;
  aiReason: string | null;
  currentVelocity: number;
}

function getAnalyzedChannels(dbPath: string, channelIds: string[]): AnalyzedChannel[] {
  if (channelIds.length === 0) return [];
  try {
    const idList = channelIds.map((id) => `'${id}'`).join(",");
    const result = spawnSync(
      "sqlite3",
      [
        dbPath,
        "-json",
        `SELECT id, name, categoryName, aiRecommendation, aiReason, currentVelocity FROM discord_channels WHERE id IN (${idList}) ORDER BY CASE aiRecommendation WHEN 'TRACK' THEN 1 WHEN 'MAYBE' THEN 2 WHEN 'SKIP' THEN 3 ELSE 4 END, categoryName, name`,
      ],
      { encoding: "utf8" }
    );
    if (result.status !== 0 || !result.stdout.trim()) return [];
    return JSON.parse(result.stdout);
  } catch {
    return [];
  }
}

async function reviewChannels(
  rl: readline.Interface,
  channels: AnalyzedChannel[],
  configChannelIds: string[]
): Promise<string[]> {
  const configSet = new Set(configChannelIds);
  // Pre-select: TRACK = on, MAYBE = off, SKIP = off, no recommendation + in config = on
  const selected = new Set<string>();
  for (const ch of channels) {
    if (ch.aiRecommendation === "TRACK") {
      selected.add(ch.id);
    } else if (!ch.aiRecommendation && configSet.has(ch.id)) {
      selected.add(ch.id);
    }
  }

  const printList = () => {
    console.log("\n  Channel Review (toggle numbers, ranges, 'done' to confirm)\n");

    let lastRec = "";
    let i = 1;
    for (const ch of channels) {
      const rec = ch.aiRecommendation || "UNANALYZED";

      // Print section header when recommendation changes
      if (rec !== lastRec) {
        const header =
          rec === "TRACK"
            ? "  --- TRACK (recommended) ---"
            : rec === "MAYBE"
            ? "\n  --- MAYBE (review these) ---"
            : rec === "SKIP"
            ? "\n  --- SKIP (not recommended) ---"
            : "\n  --- UNANALYZED ---";
        console.log(header);
        lastRec = rec;
      }

      const check = selected.has(ch.id) ? "[x]" : "[ ]";
      const vel = ch.currentVelocity > 0 ? `${ch.currentVelocity.toFixed(1)}/day` : "";
      const reason = ch.aiReason ? `  ${ch.aiReason}` : "";
      const cat = ch.categoryName ? `[${ch.categoryName}]` : "";
      console.log(
        `    ${String(i).padStart(2)}. ${check} #${ch.name.padEnd(22)} ${vel.padStart(8)}  ${cat}${reason}`
      );
      i++;
    }
    console.log(
      `\n  Selected: ${selected.size}/${channels.length} channels`
    );
  };

  while (true) {
    printList();
    const input = await ask(rl, "\n> ");

    if (input.toLowerCase() === "done" || input === "") {
      break;
    }

    if (input.toLowerCase() === "all") {
      for (const ch of channels) selected.add(ch.id);
      continue;
    }

    if (input.toLowerCase() === "none") {
      selected.clear();
      continue;
    }

    // Parse numbers and ranges to toggle
    for (const part of input.split(",")) {
      const trimmed = part.trim();
      const rangeMatch = trimmed.match(/^(\d+)\s*-\s*(\d+)$/);
      if (rangeMatch) {
        const start = parseInt(rangeMatch[1], 10);
        const end = parseInt(rangeMatch[2], 10);
        for (let n = start; n <= end; n++) {
          if (n >= 1 && n <= channels.length) {
            const id = channels[n - 1].id;
            if (selected.has(id)) selected.delete(id);
            else selected.add(id);
          }
        }
      } else {
        const n = parseInt(trimmed, 10);
        if (n >= 1 && n <= channels.length) {
          const id = channels[n - 1].id;
          if (selected.has(id)) selected.delete(id);
          else selected.add(id);
        }
      }
    }
  }

  return channels.filter((ch) => selected.has(ch.id)).map((ch) => ch.id);
}

function getConfigChannelIds(configPath: string): string[] {
  try {
    const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
    return config.sources?.[0]?.params?.channelIds || [];
  } catch {
    return [];
  }
}

async function selectChannels(
  rl: readline.Interface,
  channels: DiscoveredChannel[]
): Promise<string[]> {
  const byCategory = new Map<string, DiscoveredChannel[]>();
  for (const ch of channels) {
    const cat = ch.categoryName || "(Uncategorized)";
    if (!byCategory.has(cat)) byCategory.set(cat, []);
    byCategory.get(cat)!.push(ch);
  }

  console.log("\nAccessible channels:\n");
  const indexed: DiscoveredChannel[] = [];
  let i = 1;
  for (const [cat, chs] of byCategory) {
    console.log(`  ${cat}:`);
    for (const ch of chs) {
      console.log(`    [${String(i).padStart(2)}] #${ch.name} (${ch.id})`);
      indexed.push(ch);
      i++;
    }
  }

  console.log(
    `\nEnter channel numbers (comma-separated, ranges like 1-5, or "all"):`
  );
  const input = await ask(rl, "> ");

  if (input.toLowerCase() === "all") {
    return indexed.map((ch) => ch.id);
  }

  const selected = new Set<number>();
  for (const part of input.split(",")) {
    const trimmed = part.trim();
    const rangeMatch = trimmed.match(/^(\d+)\s*-\s*(\d+)$/);
    if (rangeMatch) {
      const start = parseInt(rangeMatch[1], 10);
      const end = parseInt(rangeMatch[2], 10);
      for (let n = start; n <= end; n++) selected.add(n);
    } else {
      const n = parseInt(trimmed, 10);
      if (!isNaN(n)) selected.add(n);
    }
  }

  return Array.from(selected)
    .filter((n) => n >= 1 && n <= indexed.length)
    .map((n) => indexed[n - 1].id);
}

// ============================================================================
// CLI arg parsing
// ============================================================================

interface PresetArgs {
  name?: string;
  guildId?: string;
}

function parsePresetArgs(): PresetArgs {
  const result: PresetArgs = {};
  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith("--name=")) result.name = arg.split("=")[1];
    else if (arg.startsWith("--guild-id=")) result.guildId = arg.split("=")[1];
  }
  return result;
}

// ============================================================================
// Wizard state
// ============================================================================

interface WizardState {
  name: string;
  guildId: string;
  tokenEnvVar: string;
  guildIdEnvVar: string;
  configPath: string;
  selectedChannels: string[];
  mediaEnabled: boolean;
  steps: Record<string, "pending" | "done" | "skipped">;
  // Track fetched date range so backfill can use it as defaults
  fetchedFrom?: string; // YYYY-MM-DD
  fetchedTo?: string;   // YYYY-MM-DD
}

const STEPS = [
  { id: "server-info", label: "Server info & config" },
  { id: "discover", label: "Discover channels" },
  { id: "select", label: "Select channels" },
  { id: "fetch", label: "Fetch recent data" },
  { id: "backfill", label: "Backfill historical data" },
  { id: "media", label: "Media download" },
  { id: "analyze", label: "LLM channel analysis" },
  { id: "channel-registry", label: "Build channel registry" },
  { id: "user-registry", label: "Build user registry" },
  { id: "summary", label: "Summary & finish" },
];

function printMenu(state: WizardState, nextStep: number): void {
  console.log("\n--- Setup Menu ---\n");
  for (let i = 0; i < STEPS.length; i++) {
    const step = STEPS[i];
    const status = state.steps[step.id];
    const icon =
      status === "done" ? "[x]" : status === "skipped" ? "[-]" : "[ ]";
    const marker = i === nextStep ? " <--" : "";
    console.log(`  ${i + 1}. ${icon} ${step.label}${marker}`);
  }
  console.log("");
}

async function promptMenu(
  rl: readline.Interface,
  state: WizardState,
  nextStep: number
): Promise<number> {
  printMenu(state, nextStep);
  const input = await askWithDefault(
    rl,
    "Enter to continue, step number to jump, or q to finish",
    String(nextStep + 1)
  );
  if (input.toLowerCase() === "q") return -1;
  const num = parseInt(input, 10);
  if (num >= 1 && num <= STEPS.length) return num - 1;
  return nextStep;
}

// ============================================================================
// Step implementations
// ============================================================================

async function stepServerInfo(
  rl: readline.Interface,
  state: WizardState,
  preset: PresetArgs
): Promise<void> {
  console.log("\n=== Step 1: Server Info & Config ===\n");

  // Name
  if (!state.name) {
    if (preset.name) {
      state.name = preset.name;
      console.log(`Server name: ${state.name}`);
    } else {
      state.name = await ask(rl, "Server name (slug, e.g. m3org): ");
    }
  } else {
    console.log(`Server name: ${state.name}`);
  }

  if (!isValidSlug(state.name)) {
    console.error(
      `Invalid name "${state.name}". Use lowercase, numbers, hyphens.`
    );
    state.name = await ask(rl, "Server name: ");
    if (!isValidSlug(state.name)) {
      console.error("Still invalid. Aborting.");
      process.exit(1);
    }
  }

  state.configPath = path.join(CONFIG_DIR, `${state.name}.json`);

  if (fs.existsSync(state.configPath)) {
    const overwrite = await askYesNo(
      rl,
      `Config ${state.configPath} already exists. Overwrite?`,
      false
    );
    if (!overwrite) {
      // Load existing config's channels
      state.selectedChannels = getConfigChannelIds(state.configPath);
      if (state.selectedChannels.length > 0) {
        console.log(
          `  Loaded ${state.selectedChannels.length} existing channel IDs from config.`
        );
      }
    }
  }

  // Guild ID
  if (!state.guildId) {
    if (preset.guildId) {
      state.guildId = preset.guildId;
      console.log(`Guild ID: ${state.guildId}`);
    } else {
      state.guildId = await ask(rl, "Discord Guild ID: ");
    }
  } else {
    console.log(`Guild ID: ${state.guildId}`);
  }

  if (!isValidSnowflake(state.guildId)) {
    console.error("Invalid Guild ID. Must be 17-20 digits.");
    process.exit(1);
  }

  // Bot token
  if (!state.tokenEnvVar) {
    const existingTokens = findEnvTokenVars();
    if (existingTokens.length > 0) {
      const options = [...existingTokens, "Create new token env var"];
      const choice = await askChoice(rl, "\nWhich bot token?", options);
      if (choice === existingTokens.length) {
        state.tokenEnvVar = await ask(
          rl,
          "New env var name (e.g. MY_DISCORD_TOKEN): "
        );
        const tokenValue = await ask(rl, `Value for ${state.tokenEnvVar}: `);
        appendEnvVar(ENV_FILE, state.tokenEnvVar, tokenValue);
      } else {
        state.tokenEnvVar = existingTokens[choice];
      }
    } else {
      state.tokenEnvVar = await askWithDefault(
        rl,
        "Bot token env var name",
        "DISCORD_TOKEN"
      );
      if (!process.env[state.tokenEnvVar]) {
        const tokenValue = await ask(rl, `Value for ${state.tokenEnvVar}: `);
        appendEnvVar(ENV_FILE, state.tokenEnvVar, tokenValue);
      }
    }
  }
  console.log(`  Token: ${state.tokenEnvVar}`);

  // Guild ID env var
  state.guildIdEnvVar = `${state.name.replace(/-/g, "_").toUpperCase()}_DISCORD_GUILD_ID`;
  console.log(`  Guild ID env var: ${state.guildIdEnvVar}`);
  appendEnvVar(ENV_FILE, state.guildIdEnvVar, state.guildId);

  // Add to .env.example
  if (fs.existsSync(ENV_EXAMPLE_FILE)) {
    const exampleContent = readEnvFile(ENV_EXAMPLE_FILE);
    if (!exampleContent.includes(state.guildIdEnvVar)) {
      const lines = exampleContent.split("\n");
      const idx = lines.findIndex((l) =>
        l.includes("DISCORD_GUILD_ID") && !l.startsWith("#")
      );
      if (idx >= 0) {
        lines.splice(
          idx + 1,
          0,
          `${state.guildIdEnvVar}=your_${state.name.replace(/-/g, "_")}_guild_id_here`
        );
        fs.writeFileSync(ENV_EXAMPLE_FILE, lines.join("\n"));
        console.log(`  Added to ${ENV_EXAMPLE_FILE}`);
      }
    }
  }

  // Generate config
  const config = generateConfig(
    state.name,
    state.tokenEnvVar,
    state.guildIdEnvVar,
    state.selectedChannels,
    state.mediaEnabled
  );
  fs.writeFileSync(state.configPath, JSON.stringify(config, null, 2) + "\n");
  console.log(`  Created ${state.configPath}`);

  state.steps["server-info"] = "done";
}

async function stepDiscover(
  rl: readline.Interface,
  state: WizardState
): Promise<void> {
  console.log("\n=== Step 2: Discover Channels ===\n");

  const code = await runCommand("npm", [
    "run",
    "channels",
    "--",
    "discover",
    `--source=${state.name}.json`,
  ]);

  state.steps["discover"] = code === 0 ? "done" : "pending";
  if (code !== 0) {
    console.log(
      `\n  Retry: npm run channels -- discover --source=${state.name}.json`
    );
  }
}

async function stepSelect(
  rl: readline.Interface,
  state: WizardState
): Promise<void> {
  console.log("\n=== Step 3: Select Channels ===\n");

  const dbPath = path.resolve(process.cwd(), `data/${state.name}.sqlite`);
  const channels = getDiscoveredChannels(dbPath);

  if (channels.length === 0) {
    console.log("  No channels in registry. Run discovery first (step 2).");
    return;
  }

  const currentIds = getConfigChannelIds(state.configPath);
  if (currentIds.length > 0) {
    console.log(`  Currently tracking ${currentIds.length} channels.`);
    const reselect = await askYesNo(rl, "  Re-select channels?", false);
    if (!reselect) {
      state.selectedChannels = currentIds;
      state.steps["select"] = "done";
      return;
    }
  }

  state.selectedChannels = await selectChannels(rl, channels);

  if (state.selectedChannels.length > 0) {
    updateConfigChannelIds(state.configPath, state.selectedChannels);
    console.log(
      `\n  Added ${state.selectedChannels.length} channels to ${state.configPath}`
    );
    state.steps["select"] = "done";
  } else {
    console.log("\n  No channels selected.");
  }
}

async function stepFetch(
  rl: readline.Interface,
  state: WizardState
): Promise<void> {
  console.log("\n=== Step 4: Fetch Recent Data ===\n");

  if (state.selectedChannels.length === 0) {
    console.log("  No channels configured. Run select first (step 3).");
    return;
  }

  const daysInput = await askWithDefault(
    rl,
    "How many days of recent data to fetch?",
    "7"
  );
  const fetchDays = Math.max(1, Math.min(30, parseInt(daysInput, 10) || 7));

  const today = new Date();
  const startDate = new Date(today);
  startDate.setDate(startDate.getDate() - fetchDays + 1);
  const afterDate = new Date(startDate);
  afterDate.setDate(afterDate.getDate() - 1);
  const afterStr = afterDate.toISOString().split("T")[0];
  const beforeStr = today.toISOString().split("T")[0];

  console.log(
    `\n  Fetching ${fetchDays} day(s): ${startDate.toISOString().split("T")[0]} to ${beforeStr}`
  );

  const code = await runCommand("npm", [
    "run",
    "historical",
    "--",
    `--source=${state.name}.json`,
    `--after=${afterStr}`,
    `--before=${beforeStr}`,
    `--output=./output/${state.name}`,
  ]);

  if (code === 0) {
    state.steps["fetch"] = "done";
    state.fetchedFrom = startDate.toISOString().split("T")[0];
    state.fetchedTo = beforeStr;
    console.log(
      `\n  Fetched data from ${state.fetchedFrom} to ${state.fetchedTo}.`
    );
    console.log(
      `  To backfill earlier data, use step 5 with a date before ${state.fetchedFrom}.`
    );
  } else {
    state.steps["fetch"] = "pending";
  }
}

async function stepBackfill(
  rl: readline.Interface,
  state: WizardState
): Promise<void> {
  console.log("\n=== Step 5: Backfill Historical Data ===\n");

  if (state.selectedChannels.length === 0) {
    console.log("  No channels configured. Run select first (step 3).");
    return;
  }

  console.log("  This fetches older data beyond what's already in the database.");
  console.log("  Useful for building up history for analytics.");

  const dbPath = path.resolve(process.cwd(), `data/${state.name}.sqlite`);
  const dbRange = getDbDateRange(dbPath);
  if (dbRange) {
    console.log(`  Data in database: ${dbRange.min} to ${dbRange.max}`);
  } else if (state.fetchedFrom) {
    console.log(`  Last fetch: ${state.fetchedFrom} to ${state.fetchedTo}`);
  }
  console.log("");

  // Default: 30 days before the earliest data in DB
  const earliestData = dbRange?.min || state.fetchedFrom;
  const defaultEnd = earliestData
    ? (() => { const d = new Date(earliestData); d.setDate(d.getDate() - 1); return d.toISOString().split("T")[0]; })()
    : new Date().toISOString().split("T")[0];
  const defaultStart = (() => { const d = new Date(defaultEnd); d.setDate(d.getDate() - 30); return d.toISOString().split("T")[0]; })();

  const afterStr = await askWithDefault(rl, "Start date (YYYY-MM-DD, exclusive)", defaultStart);
  const beforeStr = await askWithDefault(rl, "End date (YYYY-MM-DD, inclusive)", defaultEnd);

  if (!/^\d{4}-\d{2}-\d{2}$/.test(afterStr) || !/^\d{4}-\d{2}-\d{2}$/.test(beforeStr)) {
    console.log("  Invalid date format. Use YYYY-MM-DD.");
    return;
  }

  const code = await runCommand("npm", [
    "run",
    "historical",
    "--",
    `--source=${state.name}.json`,
    `--after=${afterStr}`,
    `--before=${beforeStr}`,
    `--output=./output/${state.name}`,
  ]);

  state.steps["backfill"] = code === 0 ? "done" : "pending";
}

async function stepMedia(
  rl: readline.Interface,
  state: WizardState
): Promise<void> {
  console.log("\n=== Step 6: Media Download ===\n");

  const currentConfig = JSON.parse(
    fs.readFileSync(state.configPath, "utf8")
  );
  const currentlyEnabled =
    currentConfig.sources?.[0]?.params?.mediaDownload?.enabled || false;
  console.log(`  Currently ${currentlyEnabled ? "enabled" : "disabled"}.`);
  console.log(`  Media path: ./${state.name}-media/`);
  console.log("  Downloads images, videos, and attachments from messages.\n");

  const enable = await askYesNo(rl, "Enable media download?", false);
  state.mediaEnabled = enable;
  updateConfigMedia(state.configPath, enable);
  console.log(`  Media download ${enable ? "enabled" : "disabled"} in config.`);

  if (enable) {
    const dbPath = path.resolve(process.cwd(), `data/${state.name}.sqlite`);
    const dbRange = getDbDateRange(dbPath);
    if (dbRange) {
      console.log(`  Data in database: ${dbRange.min} to ${dbRange.max}`);
    } else {
      console.log("  No data in database yet. Fetch data first (steps 4-5).");
    }
    const runNow = dbRange && await askYesNo(
      rl,
      "Download media for all fetched data?",
      false
    );
    if (runNow) {
      await runCommand("npm", [
        "run",
        "download-media",
        "--",
        "--db", `./data/${state.name}.sqlite`,
        "--output", `./${state.name}-media`,
        "--by-channel",
        "--start", dbRange!.min,
        "--end", dbRange!.max,
      ]);
    }
  }

  state.steps["media"] = "done";
}

async function stepAnalyze(
  rl: readline.Interface,
  state: WizardState
): Promise<void> {
  console.log("\n=== Step 7: LLM Channel Analysis ===\n");

  console.log("  Analyzes ingested messages to recommend TRACK/MAYBE/SKIP.");
  console.log("  Requires fetched data (step 4 or 5).\n");

  const code = await runCommand("npm", [
    "run",
    "channels",
    "--",
    "analyze",
    "--all",
    `--source=${state.name}.json`,
  ]);

  if (code === 0) {
    state.steps["analyze"] = "done";

    // Interactive channel review
    const dbPath = path.resolve(process.cwd(), `data/${state.name}.sqlite`);
    const currentIds = getConfigChannelIds(state.configPath);
    const analyzed = getAnalyzedChannels(dbPath, currentIds);

    if (analyzed.length > 0) {
      console.log("\n  Review your channels based on LLM analysis.");
      console.log("  TRACK channels are pre-selected. MAYBE/SKIP are not.");
      console.log("  Toggle numbers to check/uncheck, type 'done' to confirm.\n");

      const finalIds = await reviewChannels(rl, analyzed, currentIds);
      updateConfigChannelIds(state.configPath, finalIds);
      state.selectedChannels = finalIds;
      console.log(
        `\n  Config updated: ${finalIds.length} channels tracked.`
      );
    }
  }
}

async function stepChannelRegistry(
  rl: readline.Interface,
  state: WizardState
): Promise<void> {
  console.log("\n=== Step 8: Build Channel Registry ===\n");

  console.log("  Backfills channel metadata from ingested raw data.\n");

  const code = await runCommand("npm", [
    "run",
    "channels",
    "--",
    "build-registry",
    `--source=${state.name}.json`,
  ]);

  state.steps["channel-registry"] = code === 0 ? "done" : "pending";
}

async function stepUserRegistry(
  rl: readline.Interface,
  state: WizardState
): Promise<void> {
  console.log("\n=== Step 9: Build User Registry ===\n");

  console.log("  Maps Discord nicknames to usernames for analytics.\n");

  const code = await runCommand("npm", [
    "run", "users", "--", "build-registry", `--source=${state.name}.json`,
  ]);

  state.steps["user-registry"] = code === 0 ? "done" : "pending";
}

async function stepSummary(
  rl: readline.Interface,
  state: WizardState
): Promise<void> {
  console.log("\n=== Setup Complete ===\n");

  console.log("Status:");
  for (const step of STEPS) {
    const status = state.steps[step.id];
    const icon =
      status === "done" ? "[x]" : status === "skipped" ? "[-]" : "[ ]";
    console.log(`  ${icon} ${step.label}`);
  }

  console.log(`\nConfig:    ${state.configPath}`);
  console.log(`Database:  data/${state.name}.sqlite`);
  console.log(`Raw data:  output/${state.name}/raw/`);
  console.log(`Summaries: output/${state.name}/summaries/`);
  console.log(`Channels:  ${state.selectedChannels.length} tracked`);

  console.log("\nUseful commands:");
  console.log(
    `  Fetch data:          npm run historical -- --source=${state.name}.json --after=YYYY-MM-DD --before=YYYY-MM-DD --output=./output/${state.name}`
  );
  console.log(
    `  Analyze channels:    npm run channels -- analyze --all --source=${state.name}.json`
  );
  console.log(
    `  List channels:       npm run channels -- list --source=${state.name}.json`
  );
  console.log(
    `  Channel registry:    npm run channels -- build-registry --source=${state.name}.json`
  );
  console.log(
    `  User registry:       npm run users -- build-registry`
  );
  console.log(
    `  Enrich nicknames:    npm run enrich-nicknames -- --all --use-index`
  );
  console.log(
    `  Download media:      npm run download-media -- --source=${state.name}.json`
  );
  console.log("");

  state.steps["summary"] = "done";
}

// ============================================================================
// Main loop
// ============================================================================

async function main() {
  const preset = parsePresetArgs();
  const rl = createRL();

  console.log("\n========================================");
  console.log("  Discord Server Setup Wizard");
  console.log("========================================\n");
  console.log("Walk through each step in order, or jump to any step.\n");

  const state: WizardState = {
    name: preset.name || "",
    guildId: preset.guildId || "",
    tokenEnvVar: "",
    guildIdEnvVar: "",
    configPath: "",
    selectedChannels: [],
    mediaEnabled: false,
    steps: {},
  };

  for (const step of STEPS) {
    state.steps[step.id] = "pending";
  }

  const stepFns: Record<
    string,
    (rl: readline.Interface, state: WizardState) => Promise<void>
  > = {
    "server-info": (r, s) => stepServerInfo(r, s, preset),
    discover: stepDiscover,
    select: stepSelect,
    fetch: stepFetch,
    backfill: stepBackfill,
    media: stepMedia,
    analyze: stepAnalyze,
    "channel-registry": stepChannelRegistry,
    "user-registry": stepUserRegistry,
    summary: stepSummary,
  };

  let currentStep = 0;

  while (currentStep >= 0 && currentStep < STEPS.length) {
    const step = STEPS[currentStep];

    // Show menu and let user choose
    const chosen = await promptMenu(rl, state, currentStep);

    if (chosen === -1) {
      // User pressed q — show summary and exit
      await stepSummary(rl, state);
      break;
    }

    const chosenStep = STEPS[chosen];
    const fn = stepFns[chosenStep.id];

    if (fn) {
      await fn(rl, state);
    }

    // Auto-advance to next incomplete step
    let next = chosen + 1;
    while (next < STEPS.length && state.steps[STEPS[next].id] === "done") {
      next++;
    }
    currentStep = next;

    // If we just finished the last step, exit
    if (chosenStep.id === "summary") break;
  }

  rl.close();
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
