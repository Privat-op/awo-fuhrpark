'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const sharp = require('sharp');
const { UPLOAD_DIR } = require('../db');
const { HttpError } = require('./validation');

const IMAGE_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const RECEIPT_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

function parseDataUrl(value, allowedTypes) {
  if (typeof value !== 'string' || !value.startsWith('data:')) {
    throw new HttpError(400, 'Die Datei konnte nicht verarbeitet werden.');
  }
  const match = /^data:([^;]+);base64,(.+)$/s.exec(value);
  if (!match) throw new HttpError(400, 'Die Datei konnte nicht verarbeitet werden.');
  const mime = match[1].toLowerCase();
  if (!allowedTypes.includes(mime)) {
    throw new HttpError(400, 'Dieser Dateityp ist nicht erlaubt.');
  }
  const buffer = Buffer.from(match[2], 'base64');
  if (!buffer.length) throw new HttpError(400, 'Die Datei ist leer.');
  return { mime, buffer };
}

function resolveUpload(relativePath) {
  if (!relativePath) return null;
  const resolved = path.resolve(UPLOAD_DIR, relativePath);
  const root = path.resolve(UPLOAD_DIR);
  if (!resolved.startsWith(root + path.sep)) throw new HttpError(400, 'Ungültiger Dateipfad.');
  return resolved;
}

function relativePath(fullPath) {
  return path.relative(UPLOAD_DIR, fullPath).split(path.sep).join('/');
}

async function storeVehicleImage(dataUrl) {
  const { buffer } = parseDataUrl(dataUrl, IMAGE_MIME_TYPES);
  if (buffer.length > 12 * 1024 * 1024) throw new HttpError(400, 'Das Bild ist zu groß (max. 12 MB).');
  try {
    const processed = await sharp(buffer, { limitInputPixels: 50_000_000 })
      .rotate()
      .resize({ width: 1600, height: 1200, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 82, mozjpeg: true })
      .toBuffer();
    const file = `${crypto.randomUUID()}.jpg`;
    const fullPath = path.join(UPLOAD_DIR, 'vehicles', file);
    fs.writeFileSync(fullPath, processed);
    return relativePath(fullPath);
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(400, 'Das Bild konnte nicht verarbeitet werden.');
  }
}

function safeReceiptName(name, extension) {
  const base = path.basename(String(name || 'beleg')).replace(/[^\w.\-äöüÄÖÜß ]+/g, '_').slice(0, 120);
  const withoutExtension = base.replace(/\.[^.]+$/, '');
  return `${withoutExtension || 'beleg'}${extension}`;
}

async function storeReceipt(receipt) {
  if (!receipt || typeof receipt !== 'object') return null;
  const { data, name } = receipt;
  if (typeof data !== 'string') throw new HttpError(400, 'Der Beleg konnte nicht verarbeitet werden.');

  if (data.startsWith('data:application/pdf;base64,')) {
    const buffer = Buffer.from(data.slice(data.indexOf(',') + 1), 'base64');
    if (buffer.length > 2.5 * 1024 * 1024) throw new HttpError(400, 'PDF-Belege dürfen maximal 2,5 MB groß sein.');
    if (buffer.subarray(0, 5).toString('ascii') !== '%PDF-') {
      throw new HttpError(400, 'Die PDF-Datei ist ungültig.');
    }
    const file = `${crypto.randomUUID()}.pdf`;
    const fullPath = path.join(UPLOAD_DIR, 'receipts', file);
    fs.writeFileSync(fullPath, buffer);
    return {
      file: relativePath(fullPath),
      name: safeReceiptName(name, '.pdf'),
      mime: 'application/pdf',
      size: buffer.length
    };
  }

  const { buffer } = parseDataUrl(data, RECEIPT_IMAGE_TYPES);
  if (buffer.length > 12 * 1024 * 1024) throw new HttpError(400, 'Der Beleg ist zu groß (max. 12 MB).');
  try {
    const processed = await sharp(buffer, { limitInputPixels: 50_000_000 })
      .rotate()
      .resize({ width: 2200, height: 3000, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 86, mozjpeg: true })
      .toBuffer();
    const file = `${crypto.randomUUID()}.jpg`;
    const fullPath = path.join(UPLOAD_DIR, 'receipts', file);
    fs.writeFileSync(fullPath, processed);
    return {
      file: relativePath(fullPath),
      name: safeReceiptName(name, '.jpg'),
      mime: 'image/jpeg',
      size: processed.length
    };
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(400, 'Der Beleg konnte nicht verarbeitet werden.');
  }
}

function deleteUpload(relative) {
  const fullPath = resolveUpload(relative);
  if (!fullPath) return;
  try {
    fs.unlinkSync(fullPath);
  } catch (error) {
    if (error.code !== 'ENOENT') console.warn('Upload konnte nicht gelöscht werden:', fullPath, error.message);
  }
}

function uploadPath(relative) {
  const fullPath = resolveUpload(relative);
  if (!fullPath || !fs.existsSync(fullPath)) return null;
  return fullPath;
}

module.exports = {
  storeVehicleImage,
  storeReceipt,
  deleteUpload,
  uploadPath
};
