const drive = require('./driveClient');

const ROOT_FOLDER_NAME = process.env.SORTER_ROOT_FOLDER_NAME || 'Sorter';
const REGISTRY_FILENAME = '_sorter_registry.json';

let cachedRootFolderId = null;
let cachedRegistryFileId = null;

async function getRootFolder() {
  if (cachedRootFolderId) return cachedRootFolderId;
  const folder = await drive.findOrCreateFolder(ROOT_FOLDER_NAME, null);
  cachedRootFolderId = folder.id;
  return folder.id;
}

async function getRegistryFile() {
  const rootId = await getRootFolder();
  if (cachedRegistryFileId) return { id: cachedRegistryFileId, parentId: rootId };
  const existing = await drive.findFile(REGISTRY_FILENAME, rootId);
  if (existing) {
    cachedRegistryFileId = existing.id;
    return { id: existing.id, parentId: rootId };
  }
  const created = await drive.writeTextFile(
    null,
    rootId,
    REGISTRY_FILENAME,
    JSON.stringify({ instances: [] }, null, 2),
    'application/json'
  );
  cachedRegistryFileId = created.id;
  return { id: created.id, parentId: rootId };
}

async function loadRegistry() {
  const { id } = await getRegistryFile();
  const text = await drive.readTextFile(id);
  try {
    return typeof text === 'string' ? JSON.parse(text) : text;
  } catch (e) {
    return { instances: [] };
  }
}

async function saveRegistry(registry) {
  const { id, parentId } = await getRegistryFile();
  await drive.writeTextFile(id, parentId, REGISTRY_FILENAME, JSON.stringify(registry, null, 2), 'application/json');
}

async function upsertInstance(instance) {
  const registry = await loadRegistry();
  const idx = registry.instances.findIndex((i) => i.id === instance.id);
  if (idx >= 0) {
    registry.instances[idx] = instance;
  } else {
    registry.instances.push(instance);
  }
  await saveRegistry(registry);
  return instance;
}

module.exports = {
  getRootFolder,
  loadRegistry,
  saveRegistry,
  upsertInstance,
};
