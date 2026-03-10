#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const dataDir = path.join(root, 'data');
const archiveDir = path.join(dataDir, 'archive');
const latestPath = path.join(dataDir, 'latest.json');
const indexPath = path.join(dataDir, 'index.json');

if (!fs.existsSync(archiveDir)) fs.mkdirSync(archiveDir, { recursive: true });

const input = process.argv[2];
if (!input) {
  console.error('Usage: node scripts/publish_daily.js <json-file>');
  process.exit(1);
}

const raw = JSON.parse(fs.readFileSync(path.resolve(input), 'utf8'));
if (!raw.date) {
  console.error('Input JSON must contain date, e.g. 2026-03-10');
  process.exit(1);
}

// 1) latest
fs.writeFileSync(latestPath, JSON.stringify(raw, null, 2));

// 2) archive
const dayFile = path.join(archiveDir, `${raw.date}.json`);
fs.writeFileSync(dayFile, JSON.stringify(raw, null, 2));

// 3) index
let idx = { dates: [] };
if (fs.existsSync(indexPath)) idx = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
const set = new Set([raw.date, ...(idx.dates || [])]);
idx.dates = Array.from(set).sort((a, b) => (a < b ? 1 : -1));
fs.writeFileSync(indexPath, JSON.stringify(idx, null, 2));

console.log(`Published ${raw.date}`);
