require('dotenv').config();
const path = require('path');
const express = require('express');
const cron = require('node-cron');
const instancesRoute = require('./routes/instances');
const setupRoute = require('./routes/setup');
const { runPollCycle } = require('./poll');
const alerts = require('./alerts');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

app.use('/instances', instancesRoute);
app.use('/setup', setupRoute);

app.post('/poll/run', async (req, res) => {
  try {
    const results = await runPollCycle();
    res.json({ results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/health', async (req, res) => {
  try {
    const paused = await alerts.isPaused();
    res.json({ status: 'ok', paused });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Sorter engine listening on port ${PORT}`);
});

const cronExpr = process.env.POLL_INTERVAL_CRON || '*/5 * * * *';
cron.schedule(cronExpr, () => {
  runPollCycle()
    .then((results) => console.log('poll cycle complete', results))
    .catch((err) => console.error('poll cycle failed', err));
});
