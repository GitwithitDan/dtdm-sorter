const drive = require('./driveClient');
const registryStore = require('./registry');
const extractor = require('./extractor');
const classifier = require('./classifier');
const router = require('./router');
const alerts = require('./alerts');
const { SorterApiError } = require('./anthropicClient');

const DEFAULT_THRESHOLD = 0.75;
const DISCOVER_BATCH_SIZE = 25;

async function processInstance(instance) {
  const newFiles = await drive.listNewFiles(instance.intakeFolderId);
  if (!newFiles.length) return { instanceId: instance.id, name: instance.name, processed: 0 };

  const threshold = instance.confidenceThreshold || DEFAULT_THRESHOLD;
  const fileMode = instance.fileMode || 'copy';
  const reviewFolder = await router.ensureReviewQueueFolder(instance.outboxFolderId);

  const withContent = [];
  for (const file of newFiles) {
    const buffer = await drive.downloadFileBuffer(file.id, file.mimeType);
    const content = await extractor.extractText(buffer, file.mimeType, file.name);
    withContent.push({ file, content });
  }

  let processedCount = 0;
  let registryChanged = false;

  if (instance.sortMode === 'discover_then_sort' && (!instance.categories || instance.categories.length === 0)) {
    const batch = withContent.slice(0, DISCOVER_BATCH_SIZE);
    const proposal = await classifier.generateCategories(instance.instruction, batch);
    const categories = (proposal && proposal.categories) || [];
    for (const cat of categories) {
      const folder = await router.ensureCategoryFolder(instance.outboxFolderId, cat.name);
      cat.folderId = folder.id;
    }
    instance.categories = categories;
    registryChanged = true;
  }

  for (const { file, content } of withContent) {
    let result;
    let targetFolderId = null;
    let flaggedForReview = false;

    if (instance.sortMode === 'filter') {
      result = await classifier.classifyFilter(instance.instruction, file.name, content);
      const confidence = result.confidence || 0;
      if (result.match && confidence >= threshold) {
        const folder = await router.ensureCategoryFolder(instance.outboxFolderId, 'Matched');
        targetFolderId = folder.id;
      } else if (result.match) {
        flaggedForReview = true;
      } else {
        await drive.markProcessed(file.id, instance.id);
        processedCount++;
        continue;
      }
    } else if (instance.sortMode === 'fixed_category') {
      result = await classifier.classifyFixedCategory(instance.categories, file.name, content);
      const confidence = result.confidence || 0;
      if (result.category && result.category !== 'NO_MATCH' && confidence >= threshold) {
        const folder = await router.ensureCategoryFolder(instance.outboxFolderId, result.category);
        targetFolderId = folder.id;
      } else if (result.category && result.category !== 'NO_MATCH') {
        flaggedForReview = true;
      } else {
        const folder = await router.ensureNoMatchFolder(instance.outboxFolderId);
        targetFolderId = folder.id;
      }
    } else {
      result = await classifier.classifyGrowable(instance.categories, file.name, content);
      const confidence = result.confidence || 0;
      if (result.is_new_category) {
        const folder = await router.ensureCategoryFolder(instance.outboxFolderId, result.category);
        instance.categories.push({
          name: result.category,
          description: result.new_category_description || '',
          folderId: folder.id,
        });
        registryChanged = true;
        targetFolderId = folder.id;
      } else if (confidence >= threshold) {
        const folder = await router.ensureCategoryFolder(instance.outboxFolderId, result.category);
        targetFolderId = folder.id;
      } else {
        flaggedForReview = true;
      }
    }

    if (flaggedForReview) {
      await router.placeFile(file, reviewFolder.id, instance.intakeFolderId, fileMode);
    } else if (targetFolderId) {
      await router.placeFile(file, targetFolderId, instance.intakeFolderId, fileMode);
    }

    await drive.markProcessed(file.id, instance.id);
    processedCount++;
  }

  if (registryChanged) {
    await registryStore.upsertInstance(instance);
  }

  return { instanceId: instance.id, name: instance.name, processed: processedCount };
}

async function runPollCycle() {
  if (await alerts.isPaused()) {
    return [{
      status: 'paused',
      message: `Sorter is paused. Delete "${alerts.ALERT_FILENAME}" from the Sorter root folder in Drive once the underlying API issue is resolved.`,
    }];
  }

  const registry = await registryStore.loadRegistry();
  const results = [];

  for (const instance of registry.instances) {
    if (instance.status !== 'active') continue;
    try {
      const result = await processInstance(instance);
      results.push(result);
    } catch (err) {
      if (err instanceof SorterApiError) {
        await alerts.writeAlert(err.category, err.message);
        results.push({
          instanceId: instance.id,
          name: instance.name,
          error: err.message,
          apiPaused: true,
        });
        break; // system-wide issue -- stop this cycle, don't hit the same broken key again
      }
      results.push({ instanceId: instance.id, name: instance.name, error: err.message });
    }
  }

  return results;
}

module.exports = { runPollCycle, processInstance };
