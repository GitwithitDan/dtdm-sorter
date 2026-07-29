const express = require('express');
const { randomUUID } = require('crypto');
const drive = require('../driveClient');
const registryStore = require('../registry');
const routerLib = require('../router');

const router = express.Router();

router.post('/', async (req, res) => {
  try {
    const { name, mode, instruction, categories } = req.body;
    if (!name || !mode || !instruction) {
      return res.status(400).json({ error: 'name, mode, and instruction are required' });
    }

    const rootId = await registryStore.getRootFolder();
    const instanceFolder = await drive.findOrCreateFolder(name, rootId);
    const intakeFolder = await drive.findOrCreateFolder('Intake', instanceFolder.id);
    const outboxFolder = await drive.findOrCreateFolder('Outbox', instanceFolder.id);
    await routerLib.ensureReviewQueueFolder(outboxFolder.id);

    const resolvedCategories = [];
    if (Array.isArray(categories)) {
      for (const c of categories) {
        const folder = await routerLib.ensureCategoryFolder(outboxFolder.id, c.name);
        resolvedCategories.push({ name: c.name, description: c.description || '', folderId: folder.id });
      }
    }

    const instance = {
      id: randomUUID(),
      name,
      sortMode: mode,
      instruction,
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

    res.json({
      instance,
      intakeFolderUrl: `https://drive.google.com/drive/folders/${intakeFolder.id}`,
      outboxFolderUrl: `https://drive.google.com/drive/folders/${outboxFolder.id}`,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/', async (req, res) => {
  try {
    const registry = await registryStore.loadRegistry();
    res.json(registry.instances);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
