import { SQLiteStorage } from "./plugins/storage/SQLiteStorage";
import { OpenAIProvider } from "./plugins/ai/OpenAIProvider";
import { DailySummaryGenerator } from "./plugins/generators/DailySummaryGenerator";
import dotenv from "dotenv";

dotenv.config();

(async () => {
  const openAiProvider = new OpenAIProvider({
    apiKey: process.env.OPENAI_API_KEY || '',
    model: process.env.USE_OPENROUTER === 'true' ? `openai/gpt-4o-mini` : `gpt-4o-mini`,
    temperature: 0,
    useOpenRouter: process.env.USE_OPENROUTER === 'true',
    siteUrl: process.env.SITE_URL,
    siteName: process.env.SITE_NAME
  });


  const storage = new SQLiteStorage({ dbPath: "data/db.sqlite" });
  await storage.init();

  const summaryGenerator = new DailySummaryGenerator({
    openAiProvider,
    storage,
    summaryType: "dailySummary",
    source: "aiSummary",
  });

  const today = new Date();
  
  // Fetch overide args to get specific date
  const args = process.argv.slice(2);
  let dateStr = today.toISOString().slice(0, 10);
  args.forEach(arg => {
    if (arg.startsWith('--date=')) {
      dateStr = arg.split('=')[1];
    }
  });

  console.log(`Creating summary for date ${dateStr}`);
  await summaryGenerator.generateAndStoreSummary(dateStr);

  console.log("Fetched and stored items in a unified manner!");
})();
