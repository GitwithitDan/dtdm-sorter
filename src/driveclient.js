const { google } = require('googleapis');

function getOAuthClient() {
  const oAuth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET
  );
  oAuth2Client.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN });
  return oAuth2Client;
}

function getDrive() {
  return google.drive({ version: 'v3', auth: getOAuthClient() });
}

async function findFolder(name, parentId) {
  const drive = getDrive();
  const parentClause = parentId ? `and '${parentId}' in parents` : "and 'root' in parents";
  const safeName = name.replace(/'/g, "\\'");
  const q = `name = '${safeName}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false ${parentClause}`;
  const res = await drive.files.list({ q, fields: 'files(id, name)', spaces: 'drive' });
  return res.data.files && res.data.files.length ? res.data.files[0] : null;
}

async function createFolder(name, parentId) {
  const drive = getDrive();
  const fileMetadata = {
    name,
    mimeType: 'application/vnd.google-apps.folder',
    parents: parentId ? [parentId] : undefined,
  };
  const res = await drive.files.create({ requestBody: fileMetadata, fields: 'id, name' });
  return res.data;
}

async function findOrCreateFolder(name, parentId) {
  const existing = await findFolder(name, parentId);
  if (existing) return existing;
  return createFolder(name, parentId);
}

async function listNewFiles(folderId) {
  const drive = getDrive();
  const q = `'${folderId}' in parents and trashed = false and not properties has { key='sorted' and value='true' }`;
  const res = await drive.files.list({
    q,
    fields: 'files(id, name, mimeType, size, properties)',
    pageSize: 50,
  });
  return res.data.files || [];
}

async function downloadFileBuffer(fileId, mimeType) {
  const drive = getDrive();
  if (mimeType === 'application/vnd.google-apps.document') {
    const res = await drive.files.export(
      { fileId, mimeType: 'text/plain' },
      { responseType: 'arraybuffer' }
    );
    return Buffer.from(res.data);
  }
  const res = await drive.files.get(
    { fileId, alt: 'media' },
    { responseType: 'arraybuffer' }
  );
  return Buffer.from(res.data);
}

async function markProcessed(fileId, instanceId) {
  const drive = getDrive();
  await drive.files.update({
    fileId,
    requestBody: {
      properties: { sorted: 'true', sorted_by: instanceId },
    },
  });
}

async function moveFile(fileId, newParentId, oldParentId) {
  const drive = getDrive();
  await drive.files.update({
    fileId,
    addParents: newParentId,
    removeParents: oldParentId,
    fields: 'id, parents',
  });
}

async function copyFile(fileId, newParentId, newName) {
  const drive = getDrive();
  const res = await drive.files.copy({
    fileId,
    requestBody: { parents: [newParentId], name: newName },
  });
  return res.data;
}

async function findFile(name, parentId) {
  const drive = getDrive();
  const safeName = name.replace(/'/g, "\\'");
  const q = `name = '${safeName}' and '${parentId}' in parents and trashed = false`;
  const res = await drive.files.list({ q, fields: 'files(id, name)' });
  return res.data.files && res.data.files.length ? res.data.files[0] : null;
}

async function readTextFile(fileId) {
  const drive = getDrive();
  const res = await drive.files.get({ fileId, alt: 'media' }, { responseType: 'text' });
  return res.data;
}

async function writeTextFile(fileId, parentId, name, content) {
  const drive = getDrive();
  const media = { mimeType: 'application/json', body: content };
  if (fileId) {
    const res = await drive.files.update({ fileId, media, fields: 'id' });
    return res.data;
  }
  const res = await drive.files.create({
    requestBody: { name, parents: [parentId] },
    media,
    fields: 'id',
  });
  return res.data;
}

module.exports = {
  findFolder,
  createFolder,
  findOrCreateFolder,
  listNewFiles,
  downloadFileBuffer,
  markProcessed,
  moveFile,
  copyFile,
  findFile,
  readTextFile,
  writeTextFile,
};
