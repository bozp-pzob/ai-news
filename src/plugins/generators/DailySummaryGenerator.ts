// src/plugins/generators/DailySummaryGenerator.ts

import { OpenAIProvider } from "../ai/OpenAIProvider";
import { SQLiteStorage } from "../storage/SQLiteStorage";
import { ContentItem, SummaryItem } from "../../types";
import { createJSONPromptForTopics, createMarkdownPromptForJSON } from "../../helpers/promptHelper";
import fs from "fs";
import path from "path";

const hour = 60 * 60 * 1000;

interface DailySummaryGeneratorConfig {
  provider: OpenAIProvider;
  storage: SQLiteStorage;
  summaryType: string;
  source: string;
  outputPath?: string; // New optional parameter for output path
}

export class DailySummaryGenerator {
  private provider: OpenAIProvider;
  private storage: SQLiteStorage;
  private summaryType: string;
  private source: string;
  private blockedTopics: string[] = ['open source'];
  private outputPath: string;

  constructor(config: DailySummaryGeneratorConfig) {
    this.provider = config.provider;
    this.storage = config.storage;
    this.summaryType = config.summaryType;
    this.source = config.source;
    this.outputPath = config.outputPath || './'; // Default to current directory if not specified
  }

  
  public async generateAndStoreSummary(dateStr: string): Promise<void> {
    try {
      const currentTime = new Date(dateStr).getTime() / 1000;
      const targetTime = currentTime + ( 60 * 60 * 24);
      const contentItems: ContentItem[] = await this.storage.getContentItemsBetweenEpoch(currentTime, targetTime, this.summaryType);

      if (contentItems.length === 0) {
        console.warn(`No content found for date ${dateStr} to generate summary.`);
        return;
      }

      const groupedContent = this.groupObjectsByTopics(contentItems);

      const allSummaries: any[] = [];

      let maxTopicsToSummarize = 0;

      for (const grouped of groupedContent) {
        try {
          if (!grouped ) continue;
          const { topic, objects } = grouped;
          
          if (!topic || !objects || objects.length <= 0 || maxTopicsToSummarize >= 10) continue;

          const prompt = createJSONPromptForTopics(topic, objects, dateStr);
          const summaryText = await this.provider.summarize(prompt);
          const summaryJSONString = summaryText.replace(/```json\n|```/g, "");
          let summaryJSON = JSON.parse(summaryJSONString);
          summaryJSON["topic"] = topic;
  
          allSummaries.push(summaryJSON);
          maxTopicsToSummarize++;
        }
        catch (e) {
          console.log( e );
        }
      }

      const mdPrompt = createMarkdownPromptForJSON(allSummaries, dateStr);
      const markdownReport = await this.provider.summarize(mdPrompt);
      const markdownString = markdownReport.replace(/```markdown\n|```/g, "");

      const summaryItem: SummaryItem = {
        type: this.summaryType,
        title: `Daily Summary for ${dateStr}`,
        categories: JSON.stringify(allSummaries, null, 2),
        markdown: markdownString,
        date: currentTime,
      };

      await this.storage.saveSummaryItem(summaryItem);

      await this.writeSummaryToFile(dateStr, currentTime, allSummaries);

      await this.writeMDToFile(dateStr, markdownString);

      console.log(`Daily summary for ${dateStr} generated and stored successfully.`);
    } catch (error) {
      console.error(`Error generating daily summary for ${dateStr}:`, error);
    }
  }

  public async checkIfFileMatchesDB(dateStr: string, summary: SummaryItem) {
    try {
      let jsonParsed = await this.readSummaryFromFile(dateStr);

      let summaryParsed = {
        type: summary.type,
        title: summary.title,
        categories: JSON.parse(summary.categories || "[]"),
        date: summary.date
      };

      if (!this.deepEqual(jsonParsed, summaryParsed)) {
        console.log("JSON file didn't match database, resaving summary to file.");
        await this.writeSummaryToFile(dateStr, summary.date || new Date().getTime(), summaryParsed.categories);
      }
    }
    catch (error) {
      console.error(`Error checkIfFileMatchesDB:`, error);
    }
  }

  public async generateContent() {
    try {
      const today = new Date();

      let summary: SummaryItem[] = await this.storage.getSummaryBetweenEpoch((today.getTime() - ( hour * 24 )) / 1000,today.getTime() / 1000);
      
      if ( summary && summary.length <= 0 ) {
        const summaryDate = new Date(today);
        summaryDate.setDate(summaryDate.getDate() - 1);
        
        const dateStr = summaryDate.toISOString().slice(0, 10);
        console.log(`Summarizing data from for daily report`);
      
        await this.generateAndStoreSummary(dateStr);
        
        console.log(`Daily report is complete`);
      }
      else {
        console.log('Summary already generated for today, validating file is correct');
        const summaryDate = new Date(today);
        summaryDate.setDate(summaryDate.getDate() - 1);
        
        const dateStr = summaryDate.toISOString().slice(0, 10);

        await this.checkIfFileMatchesDB(dateStr, summary[0]);
      }
    } catch (error) {
      console.error(`Error creating daily report:`, error);
    }
  }

  private deepEqual(obj1: any, obj2: any) {
    return JSON.stringify(obj1) === JSON.stringify(obj2);
  }

  private async readSummaryFromFile(dateStr: string) {
    try {
      // Ensure directories exist
      const jsonDir = path.join(this.outputPath, 'json');
      this.ensureDirectoryExists(jsonDir);
      
      const filePath = path.join(jsonDir, `${dateStr}.json`);
      const data = fs.readFileSync(filePath, 'utf8');

      return JSON.parse(data);
    }
    catch (error) {
      console.error(`Error reading the file ${dateStr}:`, error);
    }
  }

  private async writeSummaryToFile(dateStr: string, currentTime: number, allSummaries: any[]) {
    try {
      // Ensure directories exist
      const jsonDir = path.join(this.outputPath, 'json');
      this.ensureDirectoryExists(jsonDir);
      
      const filePath = path.join(jsonDir, `${dateStr}.json`);
      fs.writeFileSync(filePath, JSON.stringify({
        type: this.summaryType,
        title: `Daily Summary for ${dateStr}`,
        categories: allSummaries,
        date: currentTime,
      }, null, 2));
    }
    catch (error) {
      console.error(`Error saving daily summary to json file ${dateStr}:`, error);
    }
  }

  private async writeMDToFile(dateStr: string, content: string) {
    try {
      // Ensure directories exist
      const mdDir = path.join(this.outputPath, 'md');
      this.ensureDirectoryExists(mdDir);
      
      const filePath = path.join(mdDir, `${dateStr}.md`);
      fs.writeFileSync(filePath, content);
    } catch (error) {
      console.error(`Error saving daily summary to markdown file ${dateStr}:`, error);
    }
  }

  private ensureDirectoryExists(dirPath: string) {
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
    }
  }

  private groupObjectsByTopics(objects : any[]): any[] {
    const topicMap = new Map();

    objects.forEach(obj => {
      if (obj.source.indexOf('github') >= 0) {
        let github_topic = obj.type === 'githubPullRequestContributor' ? 'pull_request' : obj.type === 'githubIssueContributor' ? 'issue' : 'commmit';
        if (! obj.topics) {
          obj.topics = [];
        }

        if (!topicMap.has(github_topic)) {
          topicMap.set(github_topic, []);
        }
        topicMap.get(github_topic).push(obj);
      }
      else if (obj.cid.indexOf('analytics') >= 0 ) {
        let token_topic = 'crypto market';
        if (! obj.topics) {
          obj.topics = [];
        }

        if (!topicMap.has(token_topic)) {
          topicMap.set(token_topic, []);
        }
        topicMap.get(token_topic).push(obj);

      }
      else {
        if (obj.topics) {
          obj.topics.forEach((topic:any) => {
            let shortCase = topic.toLowerCase();
            if ( ! this.blockedTopics.includes(shortCase) ) {
              if (!topicMap.has(shortCase)) {
                topicMap.set(shortCase, []);
              }
              topicMap.get(shortCase).push(obj);
            }
          });
        }
      }
    });

    const sortedTopics = Array.from(topicMap.entries()).sort((a, b) => b[1].length - a[1].length);
    const alreadyAdded : any = {};

    const miscTopics : any = {
      topic: 'Misceleanous',
      objects: [],
      allTopics: []
    };

    let groupedTopics : any[] = [];

    sortedTopics.forEach(([topic, associatedObjects]) => {
      const mergedTopics = new Set();
      let topicAlreadyAdded = false;
      associatedObjects.forEach((obj:any) => {
        obj.topics.forEach((t:any) => {
          let lower = t.toLowerCase();

          if (alreadyAdded[lower]) {
            topicAlreadyAdded = true;
          }
          else {
            mergedTopics.add(lower);
          }
        });
      });
      if ( associatedObjects && associatedObjects.length  <= 1 ) {
        let objectIds = associatedObjects.map((object: any) => object.id);
        let alreadyAddedToMisc = miscTopics["objects"].find((object: any) => objectIds.indexOf(object.id) >= 0 );
        if ( ! alreadyAddedToMisc ) {
          miscTopics["objects"] = miscTopics["objects"].concat(associatedObjects);
          miscTopics["allTopics"] = miscTopics["allTopics"].concat(Array.from(mergedTopics));
        }
      } 
      else if ( ! topicAlreadyAdded ) {
        alreadyAdded[topic] = true;

        groupedTopics.push( {
          topic,
          objects: associatedObjects,
          allTopics: Array.from(mergedTopics)
        } );
      }
    });
    
    groupedTopics.push( miscTopics );

    return groupedTopics;
  }
}
