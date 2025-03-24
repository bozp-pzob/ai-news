import { loadDirectoryModules, loadItems } from "./helpers/configHelper";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";

dotenv.config();

(async () => {
  try {
    // Fetch override args to get run specific source config
    const args = process.argv.slice(2);
    let sourceFile = "sources.json";
    
    args.forEach(arg => {
      if (arg.startsWith('--source=')) {
        sourceFile = arg.split('=')[1];
      }
    });

    const sourceClasses = await loadDirectoryModules("sources");
    
    // Load the JSON configuration file
    const configPath = path.join(__dirname, "../config", sourceFile);
    const configFile = fs.readFileSync(configPath, "utf8");
    const configJSON = JSON.parse(configFile);
    
    let sourceConfigs = await loadItems(configJSON.sources, sourceClasses, "source");

    //Create Source Tokens if needed
    for (const config of sourceConfigs) {
      if (config.instance.createToken) {
        await config.instance.createToken();
      }
    }
    
    const shutdown = async () => {
      console.log("Shutting down...");
      process.exit(0);
    };

    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);

    await shutdown();
  } catch (error) {
    console.error("Error initializing the content aggregator:", error);
    process.exit(1);
  }
})();
