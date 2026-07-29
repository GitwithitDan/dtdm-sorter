const drive = require('./driveClient');

const REVIEW_QUEUE_NAME = '_ReviewQueue';
const NO_MATCH_NAME = '_NoMatch';

async function ensureReviewQueueFolder(outboxFolderId) {
  return drive.findOrCreateFolder(REVIEW_QUEUE_NAME, outboxFolderId);
}

async function ensureNoMatchFolder(outboxFolderId) {
  return drive.findOrCreateFolder(NO_MATCH_NAME, outboxFolderId);
}

async function ensureCategoryFolder(outboxFolderId, categoryName) {
  return drive.findOrCreateFolder(categoryName, outboxFolderId);
}

async function placeFile(file, targetFolderId, intakeFolderId, fileMode) {
  if (fileMode === 'move') {
    await drive.moveFile(file.id, targetFolderId, intakeFolderId);
  } else {
    await drive.copyFile(file.id, targetFolderId, file.name);
  }
}

module.exports = {
  ensureReviewQueueFolder,
  ensureNoMatchFolder,
  ensureCategoryFolder,
  placeFile,
  REVIEW_QUEUE_NAME,
  NO_MATCH_NAME,
};
