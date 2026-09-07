import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { LogLevel } from '../types.js';

const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  DEBUG: 10,
  INFO: 20,
  WARN: 30,
  ERROR: 40,
  NONE: 100,
};

// ANSI color sequences (100% native Node.js)
const ANSI_RESET = '\x1b[0m';
const ANSI_RED = '\x1b[31m';
const ANSI_ORANGE = '\x1b[38;5;208m';
const ANSI_GREEN = '\x1b[32m';
const ANSI_BLUE = '\x1b[34m';

const ANSI_COLOR_BY_LEVEL: Record<Exclude<LogLevel, 'NONE'>, string> = {
  ERROR: ANSI_RED,
  WARN: ANSI_ORANGE,
  INFO: ANSI_GREEN,
  DEBUG: ANSI_BLUE,
};

// oxlint-disable-next-line eslint/no-control-regex
const STRIP_ANSI_REGEX = /\x1b\[[0-9;]*m/g;

export interface LoggerOptions {
  readonly verbose?: boolean | 'ERROR' | 'WARN' | 'INFO' | 'DEBUG';
  readonly logLevel?: LogLevel;
  readonly logFile?: string;
}

export class Logger {
  readonly level: LogLevel;
  private readonly logFile: string | null = null;
  private readonly priority: number;

  constructor(options: LoggerOptions = {}) {
    this.level = this.resolveLogLevel(options.verbose, options.logLevel);
    this.priority = LOG_LEVEL_PRIORITY[this.level];

    if (options.logFile && typeof options.logFile === 'string' && options.logFile.trim()) {
      const fullPath = resolve(options.logFile.trim());
      try {
        mkdirSync(dirname(fullPath), { recursive: true });
        this.logFile = fullPath;
      } catch {
        this.logFile = null;
      }
    }
  }

  private resolveLogLevel(verbose?: boolean | string, explicitLevel?: LogLevel): LogLevel {
    if (explicitLevel && explicitLevel in LOG_LEVEL_PRIORITY) {
      return explicitLevel;
    }
    if (typeof verbose === 'string') {
      const upper = verbose.toUpperCase() as LogLevel;
      if (upper in LOG_LEVEL_PRIORITY) {
        return upper;
      }
    }
    if (verbose === true) {
      return 'DEBUG';
    }
    return 'NONE';
  }

  isEnabledFor(level: Exclude<LogLevel, 'NONE'>): boolean {
    if (this.level === 'NONE') return false;
    return LOG_LEVEL_PRIORITY[level] >= this.priority;
  }

  private formatMessage(level: Exclude<LogLevel, 'NONE'>, message: string, useColor: boolean): string {
    const timestamp = new Date().toISOString();
    const color = ANSI_COLOR_BY_LEVEL[level];
    if (useColor) {
      return `${color}[${level}]${ANSI_RESET} [${timestamp}] ${message}`;
    }
    return `[${level}] [${timestamp}] ${message}`;
  }

  private write(level: Exclude<LogLevel, 'NONE'>, message: string): void {
    if (!this.isEnabledFor(level)) return;

    // Console output with native ANSI colors
    const coloredOutput = this.formatMessage(level, message, true);
    if (level === 'ERROR' || level === 'WARN') {
      process.stderr.write(coloredOutput + '\n');
    } else {
      process.stdout.write(coloredOutput + '\n');
    }

    // Optional file output (clean text without ANSI escape sequences)
    if (this.logFile) {
      try {
        const plainOutput = this.formatMessage(level, message, false).replace(STRIP_ANSI_REGEX, '');
        appendFileSync(this.logFile, plainOutput + '\n', 'utf-8');
      } catch {
        // Silently skip if file write fails to prevent interrupting document generation
      }
    }
  }

  error(message: string): void {
    this.write('ERROR', message);
  }

  warn(message: string): void {
    this.write('WARN', message);
  }

  info(message: string): void {
    this.write('INFO', message);
  }

  debug(message: string): void {
    this.write('DEBUG', message);
  }
}

export function createLogger(options: LoggerOptions = {}): Logger {
  return new Logger(options);
}
