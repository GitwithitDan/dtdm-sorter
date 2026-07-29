const drive = require('./driveClient');
const registryStore = require('./registry');

const ALERT_FILENAME = 'SORTER PAUSED - API ISSUE.txt';

const LABELS = {
  auth: 'Invalid or missing Anthropic API key',
  credits: 'Anthropic credit balance too low',
  rate_limit_exhausted: 'Rate limit retries exhausted',
  overloaded_exhausted: 'Anthropic API overloaded, retries exhausted',
  unknown: 'Unknown Anthropic API error',
};

function buildAlertContent(category, message) {
  const label = LABELS[category] || 'API issue';
  return [
    'SORTER PAUSED',
    '',
    `Reason: ${label}`,
    `Category: ${category}`,
    `Time: ${new Date().toISOString()}`,
    '',
    'Details:',
    message,
    '',
    'All sorting instances are paused. No further Claude API calls will be made until this file is deleted.',
    'Fix the underlying issue (check the API key, add credits, or wait out an outage), then delete this file from the Sorter root folder to resume.',
  ].join('\n');
}

async function writeAlert(category, message) {
  const rootId = await registryStore.getRootFolder();
  const existing = await drive.findFile(ALERT_FILENAME, rootId);
  const content = buildAlertContent(category, message);
  if (existing) {
    await drive.writeTextFile(existing.id, rootId, ALERT_FILENAME, content, 'text/plain');
  } else {
    await drive.writeTextFile(null, rootId, ALERT_FILENAME, content, 'text/plain');
  }
}

async function isPaused() {
  const rootId = await registryStore.getRootFolder();
  const existing = await drive.findFile(ALERT_FILENAME, rootId);
  return !!existing;
}

module.exports = { writeAlert, isPaused, ALERT_FILENAME };
