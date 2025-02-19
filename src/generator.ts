import { loadDirectoryModules, loadItems, loadProviders, loadStorage } from "./helpers/configHelper";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";

dotenv.config();

(async () => {
  const args = process.argv.slice(2);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  let sourceFile = "sources.json"
  let dateStr = today.toISOString().slice(0, 10);
  args.forEach(arg => {
    if (arg.startsWith('--date=')) {
      dateStr = arg.split('=')[1];
    }
    if (arg.startsWith('--source=')) {
      sourceFile = arg.split('=')[1];
    }
  });
  
  const aiClasses = await loadDirectoryModules("ai");
  const generatorClasses = await loadDirectoryModules("generators");
  const storageClasses = await loadDirectoryModules("storage");
  
  // Load the JSON configuration file
  const configPath = path.join(__dirname, "../config", sourceFile);
  const configFile = fs.readFileSync(configPath, "utf8");
  const configJSON = JSON.parse(configFile);
  
  let aiConfigs = await loadItems(configJSON.ai, aiClasses, "ai");
  let generatorConfigs = await loadItems(configJSON.generators, generatorClasses, "generators");
  let storageConfigs = await loadItems(configJSON.storage, storageClasses, "storage");

  // If any configs depends on the AI provider, set it here
  generatorConfigs = await loadProviders(generatorConfigs, aiConfigs);

  // If any configs depends on the storage, set it here
  generatorConfigs = await loadStorage(generatorConfigs, storageConfigs);
  
  // Fetch overide args to get specific date
  console.log(`Creating summary for date ${dateStr}`);
  
  for ( const generator of generatorConfigs ) {
    await generator.instance.storage.init();
    generator.instance.generateContent();
    await generator.instance.generateAndStoreSummary(dateStr);
  };

  console.log("Fetched and stored items in a unified manner!");
})();
