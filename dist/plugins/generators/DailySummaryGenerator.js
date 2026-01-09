"use strict";
/**
 * @fileoverview Implementation of a daily summary generator for content aggregation
 * Handles generation of daily summaries from various content sources using AI-powered summarization
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.DailySummaryGenerator = void 0;
const promptHelper_1 = require("../../helpers/promptHelper");
const mediaHelper_1 = require("../../helpers/mediaHelper");
const generalHelper_1 = require("../../helpers/generalHelper");
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const hour = 60 * 60 * 1000;
/**
 * DailySummaryGenerator class that generates daily summaries of content
 * Uses AI to summarize content items and organizes them by topics
 */
class DailySummaryGenerator {
    /**
     * Creates a new DailySummaryGenerator instance
     * @param {DailySummaryGeneratorConfig} config - Configuration object for the generator
     */
    constructor(config) {
        /** List of topics to exclude from summaries */
        this.blockedTopics = ['open source'];
        /** Media lookup instance (lazy loaded) */
        this.mediaLookup = null;
        this.provider = config.provider;
        this.storage = config.storage;
        this.summaryType = config.summaryType;
        this.source = config.source;
        this.outputPath = config.outputPath || './';
        this.maxGroupsToSummarize = config.maxGroupsToSummarize || 10;
        this.groupBySourceType = config.groupBySourceType || false;
        this.mediaManifestPath = config.mediaManifestPath;
    }
    /**
     * Get or initialize the MediaLookup instance
     */
    async getMediaLookup() {
        if (this.mediaLookup) {
            return this.mediaLookup;
        }
        // Try configured path first, then auto-discover
        let manifestPath = this.mediaManifestPath;
        if (!manifestPath && this.source) {
            manifestPath = (0, mediaHelper_1.findManifestPath)(this.source, this.outputPath) || undefined;
        }
        if (manifestPath) {
            console.log(`[DailySummaryGenerator] Loading media manifest from: ${manifestPath}`);
            this.mediaLookup = await (0, mediaHelper_1.createMediaLookup)(manifestPath);
            if (this.mediaLookup) {
                const stats = this.mediaLookup.getStats();
                console.log(`[DailySummaryGenerator] Media loaded: ${stats.totalImages} images, ${stats.totalVideos} videos`);
            }
        }
        return this.mediaLookup;
    }
    /**
     * Performs hierarchical summarization to handle large datasets within token limits
     * Recursively summarizes chunks until all content fits in one final summary
     * @param summaries - Array of summary objects to process
     * @param dateStr - Date string for context
     * @param chunkSize - Number of summaries to process per chunk (default: 8)
     * @returns Final markdown summary
     */
    async hierarchicalSummarize(summaries, dateStr, chunkSize = 8) {
        if (!summaries || summaries.length === 0) {
            return `# Daily Report - ${dateStr}\n\nNo content to summarize.`;
        }
        // Base case: if we have few enough summaries, summarize directly
        if (summaries.length <= chunkSize) {
            console.log(`[INFO] Direct summarization of ${summaries.length} summaries`);
            const mdPrompt = (0, promptHelper_1.createMarkdownPromptForJSON)(summaries, dateStr);
            return await (0, generalHelper_1.retryOperation)(() => this.provider.summarize(mdPrompt));
        }
        // Recursive case: break into chunks and summarize each chunk
        console.log(`[INFO] Hierarchical summarization: ${summaries.length} summaries in chunks of ${chunkSize}`);
        const chunks = [];
        for (let i = 0; i < summaries.length; i += chunkSize) {
            chunks.push(summaries.slice(i, i + chunkSize));
        }
        // Summarize each chunk in parallel
        const chunkSummaries = await Promise.all(chunks.map(async (chunk, index) => {
            console.log(`[INFO] Processing chunk ${index + 1}/${chunks.length} (${chunk.length} items)`);
            const chunkPrompt = (0, promptHelper_1.createMarkdownPromptForJSON)(chunk, `${dateStr} - Part ${index + 1}`);
            const chunkResult = await (0, generalHelper_1.retryOperation)(() => this.provider.summarize(chunkPrompt));
            // Return as a structured object for next level
            return {
                topic: `Summary Part ${index + 1}`,
                content: [{
                        text: chunkResult.replace(/```markdown\n|```/g, ""),
                        sources: [],
                        images: [],
                        videos: []
                    }]
            };
        }));
        // Recursively summarize the chunk results
        console.log(`[INFO] Combining ${chunkSummaries.length} chunk summaries`);
        return await this.hierarchicalSummarize(chunkSummaries, dateStr, chunkSize);
    }
    /**
     * Generates and stores a daily summary for a specific date
     * @param {string} dateStr - ISO date string to generate summary for
     * @returns {Promise<void>}
     */
    async generateAndStoreSummary(dateStr) {
        try {
            const currentTime = new Date(dateStr).getTime() / 1000;
            const targetTime = currentTime + (60 * 60 * 24);
            // Fetch items based on whether a specific source type was configured
            let contentItems;
            if (this.source) {
                console.log(`Fetching content for type: ${this.source}`);
                contentItems = await this.storage.getContentItemsBetweenEpoch(currentTime, targetTime, this.source);
            }
            else {
                console.log(`Fetching all content types for summary generation.`);
                contentItems = await this.storage.getContentItemsBetweenEpoch(currentTime, targetTime); // Fetch all types
            }
            if (contentItems.length === 0) {
                console.warn(`No content found for date ${dateStr} to generate summary.`);
                return;
            }
            // Load media lookup for CDN URL enrichment
            const mediaLookup = await this.getMediaLookup();
            const mediaOptions = mediaLookup
                ? { mediaLookup, dateStr, maxImagesPerSource: 5, maxVideosPerSource: 3 }
                : undefined;
            if (mediaOptions) {
                const mediaForDate = mediaLookup.getMediaForDate(dateStr);
                console.log(`[DailySummaryGenerator] Found ${mediaForDate.length} media items for ${dateStr}`);
            }
            const groupedContent = this.groupObjects(contentItems);
            const allSummaries = [];
            let groupsToSummarize = 0;
            for (const grouped of groupedContent) {
                try {
                    if (!grouped)
                        continue;
                    const { topic, objects } = grouped;
                    if (!topic || !objects || objects.length <= 0 || groupsToSummarize >= this.maxGroupsToSummarize)
                        continue;
                    const prompt = (0, promptHelper_1.createJSONPromptForTopics)(topic, objects, dateStr, mediaOptions);
                    const summaryText = await (0, generalHelper_1.retryOperation)(() => this.provider.summarize(prompt));
                    const summaryJSONString = summaryText.replace(/```json\n|```/g, "");
                    let summaryJSON = JSON.parse(summaryJSONString);
                    summaryJSON["topic"] = topic;
                    allSummaries.push(summaryJSON);
                    groupsToSummarize++;
                }
                catch (e) {
                    console.log(e);
                }
            }
            const markdownReport = await this.hierarchicalSummarize(allSummaries, dateStr);
            const markdownString = markdownReport.replace(/```markdown\n|```/g, "");
            const summaryItem = {
                type: this.summaryType,
                title: `Daily Report - ${dateStr}`,
                categories: JSON.stringify(allSummaries, null, 2),
                markdown: markdownString,
                date: currentTime,
            };
            await this.storage.saveSummaryItem(summaryItem);
            await this.writeSummaryToFile(dateStr, currentTime, allSummaries);
            await this.writeMDToFile(dateStr, markdownString);
            console.log(`Daily report for ${dateStr} generated and stored successfully.`);
        }
        catch (error) {
            console.error(`Error generating daily summary for ${dateStr}:`, error);
        }
    }
    /**
     * Checks if a file's content matches the database record and updates if needed
     * @param {string} dateStr - ISO date string to check
     * @param {SummaryItem} summary - Summary item from database
     * @returns {Promise<void>}
     */
    async checkIfFileMatchesDB(dateStr, summary) {
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
    /**
     * Generates content for the current day if not already generated
     * @returns {Promise<void>}
     */
    async generateContent() {
        try {
            const today = new Date();
            let summary = await this.storage.getSummaryBetweenEpoch((today.getTime() - (hour * 24)) / 1000, today.getTime() / 1000);
            if (summary && summary.length <= 0) {
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
        }
        catch (error) {
            console.error(`Error creating daily report:`, error);
        }
    }
    /**
     * Deep equality comparison of two objects
     * @private
     * @param {any} obj1 - First object to compare
     * @param {any} obj2 - Second object to compare
     * @returns {boolean} True if objects are deeply equal
     */
    deepEqual(obj1, obj2) {
        return JSON.stringify(obj1) === JSON.stringify(obj2);
    }
    /**
     * Reads a summary from a JSON file
     * @private
     * @param {string} dateStr - ISO date string for the summary
     * @returns {Promise<any>} Parsed summary data
     */
    async readSummaryFromFile(dateStr) {
        try {
            const jsonDir = path_1.default.join(this.outputPath, 'json');
            this.ensureDirectoryExists(jsonDir);
            const filePath = path_1.default.join(jsonDir, `${dateStr}.json`);
            const data = fs_1.default.readFileSync(filePath, 'utf8');
            return JSON.parse(data);
        }
        catch (error) {
            console.error(`Error reading the file ${dateStr}:`, error);
        }
    }
    /**
     * Writes a summary to a JSON file
     * @private
     * @param {string} dateStr - ISO date string for the summary
     * @param {number} currentTime - Current timestamp
     * @param {any[]} allSummaries - Array of summaries to write
     * @returns {Promise<void>}
     */
    async writeSummaryToFile(dateStr, currentTime, allSummaries) {
        try {
            const jsonDir = path_1.default.join(this.outputPath, 'json');
            this.ensureDirectoryExists(jsonDir);
            const filePath = path_1.default.join(jsonDir, `${dateStr}.json`);
            fs_1.default.writeFileSync(filePath, JSON.stringify({
                type: this.summaryType,
                title: `Daily Report - ${dateStr}`,
                categories: allSummaries,
                date: currentTime,
            }, null, 2));
        }
        catch (error) {
            console.error(`Error saving daily summary to json file ${dateStr}:`, error);
        }
    }
    /**
     * Writes a summary to a Markdown file
     * @private
     * @param {string} dateStr - ISO date string for the summary
     * @param {string} content - Markdown content to write
     * @returns {Promise<void>}
     */
    async writeMDToFile(dateStr, content) {
        try {
            const mdDir = path_1.default.join(this.outputPath, 'md');
            this.ensureDirectoryExists(mdDir);
            const filePath = path_1.default.join(mdDir, `${dateStr}.md`);
            fs_1.default.writeFileSync(filePath, content);
        }
        catch (error) {
            console.error(`Error saving daily summary to markdown file ${dateStr}:`, error);
        }
    }
    /**
     * Ensures a directory exists, creating it if necessary
     * @private
     * @param {string} dirPath - Path to the directory
     */
    ensureDirectoryExists(dirPath) {
        if (!fs_1.default.existsSync(dirPath)) {
            fs_1.default.mkdirSync(dirPath, { recursive: true });
        }
    }
    /**
     * Groups content items, handling special cases for GitHub and crypto content
     * @private
     * @param {any[]} objects - Array of content items to group
     * @returns {any[]} Array of grouped content
     */
    groupObjects(objects) {
        const topicMap = new Map();
        objects.forEach(obj => {
            // Handle GitHub content
            if (obj.source.indexOf('github') >= 0) {
                let github_topic;
                if (obj.type === 'githubPullRequestContributor' || obj.type === 'githubPullRequest') {
                    github_topic = 'pull_request';
                }
                else if (obj.type === 'githubIssueContributor' || obj.type === 'githubIssue') {
                    github_topic = 'issue';
                }
                else if (obj.type === 'githubCommitContributor') {
                    github_topic = 'commit';
                }
                else if (obj.type === 'githubStatsSummary') {
                    github_topic = 'github_summary';
                }
                else if (obj.type === 'githubTopContributors') {
                    return; // Deprecated - skip this item
                }
                else if (obj.type === 'githubCompletedItem') {
                    github_topic = 'completed_items';
                }
                else {
                    github_topic = 'github_other';
                }
                if (!obj.topics) {
                    obj.topics = [];
                }
                if (!obj.topics.includes(github_topic)) {
                    obj.topics.push(github_topic);
                }
                if (!topicMap.has(github_topic)) {
                    topicMap.set(github_topic, []);
                }
                topicMap.get(github_topic).push(obj);
            }
            // Handle crypto analytics content
            else if (obj.cid.indexOf('analytics') >= 0) {
                let token_topic = 'crypto market';
                if (!obj.topics) {
                    obj.topics = [];
                }
                if (!topicMap.has(token_topic)) {
                    topicMap.set(token_topic, []);
                }
                topicMap.get(token_topic).push(obj);
            }
            // Handle general content with topics
            else {
                if (obj.topics && obj.topics.length > 0 && !this.groupBySourceType) {
                    obj.topics.forEach((topic) => {
                        let shortCase = topic.toLowerCase();
                        if (!this.blockedTopics.includes(shortCase)) {
                            if (!topicMap.has(shortCase)) {
                                topicMap.set(shortCase, []);
                            }
                            topicMap.get(shortCase).push(obj);
                        }
                    });
                }
                else {
                    let shortCase = obj.type.toLowerCase();
                    if (!this.blockedTopics.includes(shortCase)) {
                        if (!topicMap.has(shortCase)) {
                            topicMap.set(shortCase, []);
                        }
                        topicMap.get(shortCase).push(obj);
                    }
                }
            }
        });
        // Sort topics by number of items and handle miscellaneous content
        const sortedTopics = Array.from(topicMap.entries()).sort((a, b) => b[1].length - a[1].length);
        const alreadyAdded = {};
        const miscTopics = {
            topic: 'miscellaneous',
            objects: [],
            allTopics: []
        };
        let groupedTopics = [];
        sortedTopics.forEach(([topic, associatedObjects]) => {
            const mergedTopics = new Set();
            let topicAlreadyAdded = false;
            associatedObjects.forEach((obj) => {
                if (obj.topics) {
                    obj.topics.forEach((t) => {
                        let lower = t.toLowerCase();
                        if (alreadyAdded[lower]) {
                            topicAlreadyAdded = true;
                        }
                        else {
                            mergedTopics.add(lower);
                        }
                    });
                }
            });
            // Handle GitHub topics separately
            if (topic === 'pull_request' || topic === 'issue' || topic === 'commit' ||
                topic === 'github_summary' || topic === 'contributors' || topic === 'completed_items') {
                if (!topicAlreadyAdded) {
                    alreadyAdded[topic] = true;
                    groupedTopics.push({
                        topic,
                        objects: associatedObjects,
                        allTopics: Array.from(mergedTopics)
                    });
                }
            }
            // Group small topics into miscellaneous
            else if (associatedObjects && associatedObjects.length <= 1) {
                let objectIds = associatedObjects.map((object) => object.id);
                let alreadyAddedToMisc = miscTopics["objects"].find((object) => objectIds.indexOf(object.id) >= 0);
                if (!alreadyAddedToMisc) {
                    miscTopics["objects"] = miscTopics["objects"].concat(associatedObjects);
                    miscTopics["allTopics"] = miscTopics["allTopics"].concat(Array.from(mergedTopics));
                }
            }
            // Add other topics normally
            else if (!topicAlreadyAdded) {
                alreadyAdded[topic] = true;
                groupedTopics.push({
                    topic,
                    objects: associatedObjects,
                    allTopics: Array.from(mergedTopics)
                });
            }
        });
        groupedTopics.push(miscTopics);
        return groupedTopics;
    }
}
exports.DailySummaryGenerator = DailySummaryGenerator;
DailySummaryGenerator.constructorInterface = {
    parameters: [
        {
            name: 'provider',
            type: 'AIProvider',
            required: true,
            description: 'AI Provider plugin for the generator to use to create the Daily Summary.'
        },
        {
            name: 'storage',
            type: 'StoragePlugin',
            required: true,
            description: 'Storage Plugin to store the generated Daily Summary.'
        },
        {
            name: 'summaryType',
            type: 'string',
            required: true,
            description: 'Type for summary to store in the database.'
        },
        {
            name: 'source',
            type: 'string',
            required: false,
            description: 'Specific source to generate the summary off.'
        },
        {
            name: 'outputPath',
            type: 'string',
            required: false,
            description: 'Location to store summary for md and json generation'
        },
        {
            name: 'maxGroupsToSummarize',
            type: 'string',
            required: false,
            description: 'Max number of groups to generate summaries off ( Default 10 ).'
        },
        {
            name: 'groupBySourceType',
            type: 'boolean',
            required: false,
            description: 'Group by source type from storage, instead of topics generated from enriching.'
        },
        {
            name: 'mediaManifestPath',
            type: 'string',
            required: false,
            description: 'Path to media manifest JSON for CDN URL enrichment in summaries.'
        }
    ]
};
