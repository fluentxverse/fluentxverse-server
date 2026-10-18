/**
 * Structured Logger for FluentXVerse
 * 
 * Features:
 * - Log levels (debug, info, warn, error)
 * - Request ID tracking
 * - Automatic PII/secret sanitization
 * - JSON output for production, pretty print for dev
 * - Context enrichment (user, request, etc.)
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogContext {
  requestId?: string;
  userId?: string;
  userType?: 'student' | 'tutor' | 'admin';
  method?: string;
  path?: string;
  statusCode?: number;
  duration?: number;
  ip?: string;
  userAgent?: string;
  [key: string]: unknown;
}

interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  context?: LogContext;
  error?: {
    name: string;
    message: string;
    stack?: string;
  };
}

// Sensitive field patterns to redact
const SENSITIVE_PATTERNS = [
  /password/i,
  /secret/i,
  /token/i,
  /authorization/i,
  /cookie/i,
  /apikey/i,
  /api_key/i,
  /private/i,
  /credential/i,
  /bearer/i,
];

// Sensitive value patterns to detect and redact
const SENSITIVE_VALUE_PATTERNS = [
  /^eyJ[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+\.[A-Za-z0-9-_]*$/, // JWT
  /^0x[a-fA-F0-9]{40}$/, // Ethereum address (partial redact)
  /^\$2[ayb]\$.{56}$/, // bcrypt hash
];

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

class Logger {
  private minLevel: LogLevel;
  private isProduction: boolean;
  private serviceName: string;

  constructor() {
    this.isProduction = process.env.NODE_ENV === 'production';
    this.minLevel = (process.env.LOG_LEVEL as LogLevel) || (this.isProduction ? 'info' : 'debug');
    this.serviceName = process.env.SERVICE_NAME || 'fluentxverse-api';
  }

  /**
   * Check if a field name is sensitive
   */
  private isSensitiveKey(key: string): boolean {
    return SENSITIVE_PATTERNS.some(pattern => pattern.test(key));
  }

  /**
   * Check if a value looks sensitive
   */
  private isSensitiveValue(value: unknown): boolean {
    if (typeof value !== 'string') return false;
    return SENSITIVE_VALUE_PATTERNS.some(pattern => pattern.test(value));
  }

  /**
   * Redact sensitive data from objects
   */
  private sanitize(obj: unknown, depth = 0): unknown {
    if (depth > 10) return '[MAX_DEPTH]';
    
    if (obj === null || obj === undefined) return obj;
    
    if (typeof obj === 'string') {
      // Redact JWTs and other sensitive string patterns
      if (this.isSensitiveValue(obj)) {
        if (obj.startsWith('eyJ')) return '[REDACTED_JWT]';
        if (obj.startsWith('0x') && obj.length === 42) {
          return `${obj.slice(0, 6)}...${obj.slice(-4)}`; // Partial address
        }
        return '[REDACTED]';
      }
      return obj;
    }
    
    if (Array.isArray(obj)) {
      return obj.map(item => this.sanitize(item, depth + 1));
    }
    
    if (typeof obj === 'object') {
      const sanitized: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
        if (this.isSensitiveKey(key)) {
          sanitized[key] = '[REDACTED]';
        } else {
          sanitized[key] = this.sanitize(value, depth + 1);
        }
      }
      return sanitized;
    }
    
    return obj;
  }

  /**
   * Format log entry
   */
  private format(entry: LogEntry): string {
    if (this.isProduction) {
      // JSON format for production (easier to parse in log aggregators)
      return JSON.stringify({
        ...entry,
        service: this.serviceName,
        env: process.env.NODE_ENV || 'development',
      });
    }
    
    // Pretty format for development
    const levelColors: Record<LogLevel, string> = {
      debug: '\x1b[90m', // gray
      info: '\x1b[36m',  // cyan
      warn: '\x1b[33m',  // yellow
      error: '\x1b[31m', // red
    };
    const reset = '\x1b[0m';
    const color = levelColors[entry.level];
    
    let output = `${color}[${entry.timestamp}] ${entry.level.toUpperCase()}${reset}: ${entry.message}`;
    
    if (entry.context && Object.keys(entry.context).length > 0) {
      const contextStr = Object.entries(entry.context)
        .map(([k, v]) => `${k}=${typeof v === 'object' ? JSON.stringify(v) : v}`)
        .join(' ');
      output += ` ${'\x1b[90m'}${contextStr}${reset}`;
    }
    
    if (entry.error) {
      output += `\n${color}Error: ${entry.error.message}${reset}`;
      if (entry.error.stack && !this.isProduction) {
        output += `\n${entry.error.stack}`;
      }
    }
    
    return output;
  }

  /**
   * Core log method
   */
  private log(level: LogLevel, message: string, context?: LogContext, error?: Error): void {
    if (LOG_LEVELS[level] < LOG_LEVELS[this.minLevel]) return;

    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      context: context ? this.sanitize(context) as LogContext : undefined,
    };

    if (error) {
      entry.error = {
        name: error.name,
        message: error.message,
        stack: this.isProduction ? undefined : error.stack,
      };
    }

    const output = this.format(entry);
    
    if (level === 'error') {
      console.error(output);
    } else if (level === 'warn') {
      console.warn(output);
    } else {
    }
  }

  // Public logging methods
  debug(message: string, context?: LogContext): void {
    this.log('debug', message, context);
  }

  info(message: string, context?: LogContext): void {
    this.log('info', message, context);
  }

  warn(message: string, context?: LogContext): void {
    this.log('warn', message, context);
  }

  error(message: string, error?: Error | unknown, context?: LogContext): void {
    const err = error instanceof Error ? error : undefined;
    if (error && !(error instanceof Error)) {
      context = { ...context, errorData: error };
    }
    this.log('error', message, context, err);
  }

  /**
   * Create a child logger with preset context
   */
  child(context: LogContext): ChildLogger {
    return new ChildLogger(this, context);
  }

  /**
   * Log HTTP request (for middleware)
   */
  request(req: {
    method: string;
    path: string;
    ip?: string;
    userAgent?: string;
    requestId?: string;
    userId?: string;
    userType?: string;
  }): void {
    this.info('Incoming request', {
      method: req.method,
      path: req.path,
      ip: req.ip,
      userAgent: req.userAgent,
      requestId: req.requestId,
      userId: req.userId,
      userType: req.userType as LogContext['userType'],
    });
  }

  /**
   * Log HTTP response (for middleware)
   */
  response(res: {
    method: string;
    path: string;
    statusCode: number;
    duration: number;
    requestId?: string;
  }): void {
    const level: LogLevel = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info';
    this.log(level, 'Request completed', {
      method: res.method,
      path: res.path,
      statusCode: res.statusCode,
      duration: res.duration,
      requestId: res.requestId,
    });
  }
}

/**
 * Child logger with preset context
 */
class ChildLogger {
  constructor(
    private parent: Logger,
    private context: LogContext
  ) {}

  private merge(additionalContext?: LogContext): LogContext {
    return { ...this.context, ...additionalContext };
  }

  debug(message: string, context?: LogContext): void {
    this.parent.debug(message, this.merge(context));
  }

  info(message: string, context?: LogContext): void {
    this.parent.info(message, this.merge(context));
  }

  warn(message: string, context?: LogContext): void {
    this.parent.warn(message, this.merge(context));
  }

  error(message: string, error?: Error | unknown, context?: LogContext): void {
    this.parent.error(message, error, this.merge(context));
  }
}

// Export singleton instance
export const logger = new Logger();

// Export for creating request-scoped loggers
export function createRequestLogger(requestId: string, userId?: string, userType?: string) {
  return logger.child({ requestId, userId, userType: userType as LogContext['userType'] });
}

// Generate unique request ID
export function generateRequestId(): string {
  return `req_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export default logger;
