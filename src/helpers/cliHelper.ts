
/**
 * cli utility functions for the AI News Aggregator.
 * This module provides cli helper functions used across the application.
 * 
 * @module helpers
 */

/**
 * Console color codes for formatted logging output
 */
export const colors = {
    reset: '\x1b[0m',
    bright: '\x1b[1m',
    dim: '\x1b[2m',
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    magenta: '\x1b[35m',
    cyan: '\x1b[36m',
    white: '\x1b[37m',
    bgRed: '\x1b[41m',
    bgGreen: '\x1b[42m',
    bgYellow: '\x1b[43m',
    bgBlue: '\x1b[44m',
    bgMagenta: '\x1b[45m',
    bgCyan: '\x1b[46m',
    bgWhite: '\x1b[47m'
};

/**
 * Logger utility for consistent console output formatting
 */
export const logger = {
    info: (message: string) => console.log(`${colors.cyan}[INFO]${colors.reset} ${message}`),
    success: (message: string) => console.log(`${colors.green}[SUCCESS]${colors.reset} ${message}`),
    warning: (message: string) => console.log(`${colors.yellow}[WARNING]${colors.reset} ${message}`),
    error: (message: string) => console.error(`${colors.red}[ERROR]${colors.reset} ${message}`),
    debug: (message: string) => {
      // Only show debug messages if DEBUG environment variable is set
      if (process.env.DEBUG) {
        console.log(`${colors.dim}[DEBUG]${colors.reset} ${message}`);
      }
    },
    channel: (message: string) => console.log(`${colors.magenta}[CHANNEL]${colors.reset} ${message}`),
    progress: (message: string) => {
      // Clear the current line and write the progress message
      process.stdout.write(`\r${colors.blue}[PROGRESS]${colors.reset} ${message}`);
    },
    clearLine: () => {
      process.stdout.write('\r\x1b[K');
    }
};


export function formatTimeForFilename(date: Date): string {
  return date.toLocaleString('en-US', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'UTC'
  }).replace(/[/:]/g, '').replace(/,/g, '').replace(/\s/g, '');
}

/**
 * Creates a visual progress bar
 * @param {number} current - Current progress value
 * @param {number} total - Total progress value
 * @param {number} [width=30] - Width of the progress bar in characters
 * @returns {string} Formatted progress bar string
 */
export function createProgressBar(current: number, total: number, width: number = 30): string {
  const percentage = total > 0 ? (current / total) * 100 : 0;
  const filledWidth = Math.round((width * current) / total);
  const bar = '█'.repeat(filledWidth) + '░'.repeat(width - filledWidth);
  return `[${bar}] ${percentage.toFixed(1)}%`;
}

/**
 * Formats a number with thousands separators
 * @param {number} num - Number to format
 * @returns {string} Formatted number string
 */
export function formatNumber(num: number): string {
  return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}