const Anthropic = require('@anthropic-ai/sdk');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const MODEL = process.env.CLAUDE_MODEL || 'claude-sonnet-5';

const MAX_RETRIES = 3;
const BASE_DELAY_MS = 2000;
const MAX_DELAY_MS = 30000;

class SorterApiError extends Error {
  constructor(category, message, status) {
    super(message);
    this.name = 'SorterApiError';
    this.category = category; // 'auth' | 'credits' | 'rate_limit_exhausted' | 'overloaded_exhausted' | 'unknown'
    this.status = status;
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isCreditExhaustion(err) {
  const msg = (err.message || '').toLowerCase();
  return err.status === 400 && (
    msg.includes('credit balance') ||
    msg.includes('credit_balance') ||
    msg.includes('insufficient credit')
  );
}

function retryDelayMs(err, attempt) {
  const header = err.headers && (err.headers['retry-after'] || err.headers['Retry-After']);
  if (header) {
    const seconds = parseInt(header, 10);
    if (!isNaN(seconds)) return seconds * 1000;
  }
  return Math.min(BASE_DELAY_MS * Math.pow(2, attempt), MAX_DELAY_MS);
}

// Wraps client.messages.create -- pass the same params you'd give the SDK directly.
// Throws a SorterApiError on anything that shouldn't be retried further.
async function callMessages(params) {
  let attempt = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      return await client.messages.create(params);
    } catch (err) {
      const status = err.status;

      if (status === 401) {
        throw new SorterApiError('auth', 'Anthropic API key is invalid or missing.', 401);
      }

      if (isCreditExhaustion(err)) {
        throw new SorterApiError('credits', err.message || 'Anthropic credit balance is too low.', 400);
      }

      if (status === 429) {
        if (attempt >= MAX_RETRIES) {
          throw new SorterApiError('rate_limit_exhausted', `Rate limit retries exhausted: ${err.message}`, 429);
        }
        await sleep(retryDelayMs(err, attempt));
        attempt++;
        continue;
      }

      if (status === 529) {
        if (attempt >= MAX_RETRIES) {
          throw new SorterApiError('overloaded_exhausted', `Anthropic overloaded, retries exhausted: ${err.message}`, 529);
        }
        await sleep(retryDelayMs(err, attempt));
        attempt++;
        continue;
      }

      if (attempt < MAX_RETRIES && (!status || status >= 500)) {
        await sleep(retryDelayMs(err, attempt));
        attempt++;
        continue;
      }

      throw new SorterApiError('unknown', err.message || 'Unknown Anthropic API error.', status || 0);
    }
  }
}

module.exports = { callMessages, SorterApiError, MODEL };
