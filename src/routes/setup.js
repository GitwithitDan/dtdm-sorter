const express = require('express');
const path = require('path');
const { randomUUID } = require('crypto');
const { callMessages, MODEL, SorterApiError } = require('../anthropicClient');
const drive = require('../driveClient');
const registryStore = require('../registry');
const routerLib = require('../router');
const alerts = require('../alerts');

const router = express.Router();

router.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '..', '..', 'public', 'setup.html'));
});

const TOOLS = [
  {
    name: 'create_sorting_instance',
    description:
      'Create a new file-sorting instance: an intake folder, an outbox, and the classification instructions that will govern it.',
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Short instance name, used as the Drive folder name' },
        mode: { type: 'string', enum: ['filter', 'fixed_category', 'discover_then_sort'] },
        instruction: { type: 'string', description: 'Cleaned restatement of the sorting instruction' },
        categories: {
          type: 'array',
          items: {
            type: 'object',
            properties: { name: { type: 'string' }, description: { type: 'string' } },
            required: ['name', 'description'],
          },
        },
      },
      required: ['name', 'mode', 'instruction'],
    },
  },
];

async function executeCreateInstance(input) {
  const rootId = await registryStore.getRootFolder();
  const instanceFolder = await drive.findOrCreateFolder(input.name, rootId);
  const intakeFolder = await drive.findOrCreateFolder('Intake', instanceFolder.id);
  const outboxFolder = await drive.findOrCreateFolder('Outbox', instanceFolder.id);
  await routerLib.ensureReviewQueueFolder(outboxFolder.id);

  const resolvedCategories = [];
  if (Array.isArray(input.categories)) {
    for (const c of input.categories) {
      const folder = await routerLib.ensureCategoryFolder(outboxFolder.id, c.name);
      resolvedCategories.push({ name: c.name, description: c.description || '', folderId: folder.id });
    }
  }

  const instance = {
    id: randomUUID(),
    name: input.name,
    sortMode: input.mode,
    instruction: input.instruction,
    categories: resolvedCategories,
    confidenceThreshold: 0.75,
    fileMode: 'copy',
    status: 'active',
    intakeFolderId: intakeFolder.id,
    outboxFolderId: outboxFolder.id,
    instanceFolderId: instanceFolder.id,
    createdAt: new Date().toISOString(),
  };

  await registryStore.upsertInstance(instance);
  return {
    instance,
    intakeFolderUrl: `https://drive.google.com/drive/folders/${intakeFolder.id}`,
  };
}

router.post('/chat', async (req, res) => {
  const { message } = req.body;
  if (!message) {
    return res.status(400).json({ error: 'message is required' });
  }

  if (await alerts.isPaused()) {
    return res.json({
      reply: `Sorter is currently paused due to an API issue. Check "${alerts.ALERT_FILENAME}" in the Sorter root folder in Drive for details -- delete it once resolved to resume.`,
    });
  }

  try {
    const system = `You set up new Sorter instances from a single user instruction. Always resolve the instruction into exactly one call to create_sorting_instance -- never ask a clarifying question, never wait for confirmation. Decide the mode yourself: "filter" for a single yes/no criterion, "fixed_category" when the user names specific categories, "discover_then_sort" when no categories are given or implied -- in that case pass an empty categories array. Pick a short, clear instance name if the user didn't give one.`;

    const response = await callMessages({
      model: MODEL,
      max_tokens: 1024,
      system,
      tools: TOOLS,
      messages: [{ role: 'user', content: message }],
    });

    const toolUse = response.content.find((b) => b.type === 'tool_use');
    if (!toolUse) {
      const textBlock = response.content.find((b) => b.type === 'text');
      return res.json({
        reply: textBlock ? textBlock.text : "Couldn't resolve that into a sorting instance -- try rephrasing.",
      });
    }

    const result = await executeCreateInstance(toolUse.input);
    res.json({
      reply: `Created "${result.instance.name}" (${result.instance.sortMode}). Intake folder: ${result.intakeFolderUrl}`,
      instance: result.instance,
    });
  } catch (err) {
    if (err instanceof SorterApiError) {
      await alerts.writeAlert(err.category, err.message);
      return res.json({
        reply: `Couldn't create the instance -- ${err.message} A details file has been written to the Sorter root folder in Drive; sorting is paused until it's resolved.`,
      });
    }
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
