
/**
 * CLI utility functions for Digital Gardener.
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
 * Log level hierarchy for filtering
 */
type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

/**
 * Get the current minimum log level from environment.
 * Set LOG_LEVEL=debug|info|warn|error to control output verbosity.
 */
function getMinLogLevel(): number {
  const level = (process.env.LOG_LEVEL || 'debug').toLowerCase() as LogLevel;
  return LOG_LEVELS[level] ?? LOG_LEVELS.info;
}

/**
 * Check if JSON output mode is enabled.
 * Set LOG_FORMAT=json for structured JSON log output (useful for production log aggregation).
 */
function isJsonMode(): boolean {
  return process.env.LOG_FORMAT === 'json';
}

/**
 * Format a timestamp for log output
 */
function timestamp(): string {
  return new Date().toISOString();
}

/**
 * Stringify additional arguments for log output
 */
function formatArgs(args: any[]): string {
  if (args.length === 0) return '';
  return ' ' + args.map(a => {
    if (a instanceof Error) return `${a.message}\n${a.stack || ''}`;
    if (typeof a === 'object') {
      try { return JSON.stringify(a); } catch { return String(a); }
    }
    return String(a);
  }).join(' ');
}

/**
 * Logger utility for consistent console output formatting.
 * 
 * Supports:
 * - Variadic arguments: logger.info('message', { key: 'value' })
 * - Log levels: Set LOG_LEVEL env var to filter output
 * - JSON mode: Set LOG_FORMAT=json for structured output
 * - Timestamps: Always included
 * - Error objects: Automatically formats stack traces
 * 
 * @example
 * logger.info('Server started', { port: 3000 });
 * logger.error('Request failed', error);
 * logger.warn('Deprecated feature used');
 * logger.debug('Verbose detail'); // Only shown when LOG_LEVEL=debug or DEBUG is set
 */
export const logger = {
    info: (message: string, ...args: any[]) => {
      if (getMinLogLevel() > LOG_LEVELS.info) return;
      if (isJsonMode()) {
        console.log(JSON.stringify({ level: 'info', ts: timestamp(), msg: message, ...(args.length ? { data: args.length === 1 ? args[0] : args } : {}) }));
      } else {
        console.log(`${colors.cyan}[INFO]${colors.reset}  ${colors.dim}${timestamp()}${colors.reset} ${message}${formatArgs(args)}`);
      }
    },
    success: (message: string, ...args: any[]) => {
      if (getMinLogLevel() > LOG_LEVELS.info) return;
      if (isJsonMode()) {
        console.log(JSON.stringify({ level: 'info', ts: timestamp(), msg: message, success: true, ...(args.length ? { data: args.length === 1 ? args[0] : args } : {}) }));
      } else {
        console.log(`${colors.green}[OK]${colors.reset}    ${colors.dim}${timestamp()}${colors.reset} ${message}${formatArgs(args)}`);
      }
    },
    warn: (message: string, ...args: any[]) => {
      if (getMinLogLevel() > LOG_LEVELS.warn) return;
      if (isJsonMode()) {
        console.log(JSON.stringify({ level: 'warn', ts: timestamp(), msg: message, ...(args.length ? { data: args.length === 1 ? args[0] : args } : {}) }));
      } else {
        console.log(`${colors.yellow}[WARN]${colors.reset}  ${colors.dim}${timestamp()}${colors.reset} ${message}${formatArgs(args)}`);
      }
    },
    /** @alias warn - for backward compatibility */
    warning: (message: string, ...args: any[]) => {
      logger.warn(message, ...args);
    },
    error: (message: string, ...args: any[]) => {
      if (getMinLogLevel() > LOG_LEVELS.error) return;
      if (isJsonMode()) {
        const errorData = args.find(a => a instanceof Error);
        console.error(JSON.stringify({ 
          level: 'error', ts: timestamp(), msg: message, 
          ...(errorData ? { error: errorData.message, stack: errorData.stack } : {}),
          ...(args.length ? { data: args.filter(a => !(a instanceof Error)).length ? args.filter(a => !(a instanceof Error)) : undefined } : {}) 
        }));
      } else {
        console.error(`${colors.red}[ERROR]${colors.reset} ${colors.dim}${timestamp()}${colors.reset} ${message}${formatArgs(args)}`);
      }
    },
    debug: (message: string, ...args: any[]) => {
      // Show debug messages if DEBUG env var is set OR LOG_LEVEL is debug
      if (!process.env.DEBUG && getMinLogLevel() > LOG_LEVELS.debug) return;
      if (isJsonMode()) {
        console.log(JSON.stringify({ level: 'debug', ts: timestamp(), msg: message, ...(args.length ? { data: args.length === 1 ? args[0] : args } : {}) }));
      } else {
        console.log(`${colors.dim}[DEBUG]${colors.reset} ${colors.dim}${timestamp()}${colors.reset} ${message}${formatArgs(args)}`);
      }
    },
    channel: (message: string, ...args: any[]) => {
      if (getMinLogLevel() > LOG_LEVELS.info) return;
      if (isJsonMode()) {
        console.log(JSON.stringify({ level: 'info', ts: timestamp(), msg: message, channel: true, ...(args.length ? { data: args.length === 1 ? args[0] : args } : {}) }));
      } else {
        console.log(`${colors.magenta}[CHAN]${colors.reset}  ${colors.dim}${timestamp()}${colors.reset} ${message}${formatArgs(args)}`);
      }
    },
    progress: (message: string) => {
      // Progress output bypasses JSON mode (it's a terminal-only feature)
      process.stdout.write(`\r${colors.blue}[PROG]${colors.reset}  ${message}`);
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