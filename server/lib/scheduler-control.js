'use strict';

const { createLogger } = require('./logger');

const logger = createLogger('scheduler');

const entries = new Map();

function stopEntry(entry) {
  try {
    entry.handle?.stop?.();
  } catch {
    // A failing stop must not block a restart.
  }
  entry.handle = null;
}

function registerScheduler(name, starter) {
  entries.set(name, { starter, handle: null });
}

function startScheduler(name) {
  const entry = entries.get(name);
  if (!entry) return null;
  stopEntry(entry);
  try {
    entry.handle = entry.starter() || null;
  } catch (error) {
    logger.warn('Scheduler konnte nicht gestartet werden.', { error, scheduler: name });
    entry.handle = null;
  }
  return entry.handle;
}

function startAllSchedulers() {
  for (const name of entries.keys()) startScheduler(name);
}

function restartScheduler(name) {
  return startScheduler(name);
}

function restartAllSchedulers() {
  startAllSchedulers();
}

function schedulerNames() {
  return [...entries.keys()];
}

function resetSchedulers() {
  for (const entry of entries.values()) stopEntry(entry);
  entries.clear();
}

module.exports = {
  registerScheduler,
  startScheduler,
  startAllSchedulers,
  restartScheduler,
  restartAllSchedulers,
  schedulerNames,
  resetSchedulers
};
