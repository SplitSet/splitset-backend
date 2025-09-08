const pino = require('pino');
const { nanoid } = require('nanoid');

// Create base logger
const logger = pino({
  name: 'shopify-bundle-app',
  level: process.env.LOG_LEVEL || 'info',
  formatters: {
    level: (label) => {
      return { level: label.toUpperCase() };
    },
  },
  timestamp: pino.stdTimeFunctions.isoTime,
  ...(process.env.NODE_ENV === 'production' && {
    // In production, use structured JSON logging
    transport: undefined,
  }),
  ...(process.env.NODE_ENV !== 'production' && {
    // In development, use pretty printing
    transport: {
      target: 'pino-pretty',
      options: {
        colorize: true,
        ignore: 'pid,hostname',
        translateTime: 'yyyy-mm-dd HH:MM:ss',
      },
    },
  }),
});

// Context storage for request-scoped data
class LoggerContext {
  constructor() {
    this.contexts = new Map();
  }

  create(contextId = null) {
    const id = contextId || nanoid();
    const context = {
      requestId: id,
      storeId: null,
      runId: null,
      userId: null,
      startTime: Date.now(),
    };
    
    this.contexts.set(id, context);
    return id;
  }

  update(contextId, data) {
    const context = this.contexts.get(contextId);
    if (context) {
      Object.assign(context, data);
    }
  }

  get(contextId) {
    return this.contexts.get(contextId) || {};
  }

  delete(contextId) {
    this.contexts.delete(contextId);
  }

  // Cleanup old contexts (prevent memory leaks)
  cleanup(olderThanMs = 60000) {
    const cutoff = Date.now() - olderThanMs;
    for (const [id, context] of this.contexts.entries()) {
      if (context.startTime < cutoff) {
        this.contexts.delete(id);
      }
    }
  }
}

const loggerContext = new LoggerContext();

// Cleanup old contexts every minute
setInterval(() => loggerContext.cleanup(), 60000);

// Enhanced logger with context
class ContextualLogger {
  constructor(baseLogger, contextId = null) {
    this.logger = baseLogger;
    this.contextId = contextId;
  }

  getContextData() {
    if (!this.contextId) return {};
    return loggerContext.get(this.contextId);
  }

  child(bindings = {}) {
    const contextData = this.getContextData();
    return new ContextualLogger(
      this.logger.child({ ...contextData, ...bindings }),
      this.contextId
    );
  }

  withContext(contextId) {
    return new ContextualLogger(this.logger, contextId);
  }

  log(level, msg, extra = {}) {
    const contextData = this.getContextData();
    this.logger[level]({ ...contextData, ...extra }, msg);
  }

  info(msg, extra = {}) {
    this.log('info', msg, extra);
  }

  error(msg, extra = {}) {
    this.log('error', msg, extra);
  }

  warn(msg, extra = {}) {
    this.log('warn', msg, extra);
  }

  debug(msg, extra = {}) {
    this.log('debug', msg, extra);
  }

  // Specialized logging methods
  request(req, extra = {}) {
    this.info('HTTP request', {
      method: req.method,
      url: req.url,
      userAgent: req.get('User-Agent'),
      ip: req.ip,
      ...extra
    });
  }

  response(req, res, duration, extra = {}) {
    this.info('HTTP response', {
      method: req.method,
      url: req.url,
      status: res.statusCode,
      duration,
      ...extra
    });
  }

  shopifyApi(operation, shop, extra = {}) {
    this.info('Shopify API call', {
      operation,
      shop,
      ...extra
    });
  }

  jobStart(jobType, extra = {}) {
    this.info('Job started', {
      jobType,
      ...extra
    });
  }

  jobComplete(jobType, duration, stats = {}, extra = {}) {
    this.info('Job completed', {
      jobType,
      duration,
      stats,
      ...extra
    });
  }

  jobError(jobType, error, extra = {}) {
    this.error('Job failed', {
      jobType,
      error: error.message,
      stack: error.stack,
      ...extra
    });
  }

  audit(action, details = {}) {
    this.info('Audit log', {
      action,
      timestamp: new Date().toISOString(),
      ...details
    });
  }

  performance(operation, duration, extra = {}) {
    this.info('Performance metric', {
      operation,
      duration,
      ...extra
    });
  }

  security(event, details = {}) {
    this.warn('Security event', {
      event,
      timestamp: new Date().toISOString(),
      ...details
    });
  }
}

// Express middleware for request context
const requestContextMiddleware = (req, res, next) => {
  const contextId = loggerContext.create();
  
  // Extract store info from request if available
  const storeId = req.params.storeId || req.body.storeId || req.query.storeId;
  const runId = req.headers['x-run-id'] || req.body.runId;
  
  loggerContext.update(contextId, {
    storeId,
    runId,
    method: req.method,
    url: req.url,
    userAgent: req.get('User-Agent'),
    ip: req.ip,
  });

  // Add context to request object
  req.loggerContext = contextId;
  req.logger = new ContextualLogger(logger, contextId);

  // Log request
  req.logger.request(req);

  // Measure response time
  const startTime = Date.now();

  // Override res.end to log response
  const originalEnd = res.end;
  res.end = function(chunk, encoding) {
    const duration = Date.now() - startTime;
    req.logger.response(req, res, duration);
    
    // Cleanup context after response
    setImmediate(() => {
      loggerContext.delete(contextId);
    });
    
    originalEnd.call(this, chunk, encoding);
  };

  next();
};

// Create root contextual logger
const rootLogger = new ContextualLogger(logger);

module.exports = {
  logger: rootLogger,
  requestContextMiddleware,
  loggerContext,
  ContextualLogger,
  createJobLogger: (runId, storeId) => {
    const contextId = loggerContext.create();
    loggerContext.update(contextId, { runId, storeId });
    return new ContextualLogger(logger, contextId);
  }
};
