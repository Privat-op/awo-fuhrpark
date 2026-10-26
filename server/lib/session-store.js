'use strict';

const session = require('express-session');

class SQLiteSessionStore extends session.Store {
  constructor(db, options = {}) {
    super();
    this.db = db;
    this.defaultTtlMs = options.defaultTtlMs || 8 * 60 * 60 * 1000;
    this.cleanupTimer = setInterval(() => {
      try {
        this.db.prepare('DELETE FROM sessions WHERE expire < ?').run(Date.now());
      } catch (error) {
        console.error('Session-Bereinigung fehlgeschlagen:', error.message);
      }
    }, 15 * 60 * 1000);
    this.cleanupTimer.unref?.();
  }

  get(sid, callback) {
    try {
      const row = this.db.prepare('SELECT sess, expire FROM sessions WHERE sid = ?').get(sid);
      if (!row) return callback(null, null);
      if (row.expire < Date.now()) {
        this.db.prepare('DELETE FROM sessions WHERE sid = ?').run(sid);
        return callback(null, null);
      }
      return callback(null, JSON.parse(row.sess));
    } catch (error) {
      return callback(error);
    }
  }

  set(sid, sess, callback = () => {}) {
    try {
      const cookieExpires = sess?.cookie?.expires ? new Date(sess.cookie.expires).getTime() : null;
      const expire = cookieExpires || Date.now() + this.defaultTtlMs;
      this.db.prepare(`
        INSERT INTO sessions (sid, sess, expire) VALUES (?, ?, ?)
        ON CONFLICT(sid) DO UPDATE SET sess = excluded.sess, expire = excluded.expire
      `).run(sid, JSON.stringify(sess), expire);
      callback(null);
    } catch (error) {
      callback(error);
    }
  }

  touch(sid, sess, callback = () => {}) {
    this.set(sid, sess, callback);
  }

  destroy(sid, callback = () => {}) {
    try {
      this.db.prepare('DELETE FROM sessions WHERE sid = ?').run(sid);
      callback(null);
    } catch (error) {
      callback(error);
    }
  }

  clear(callback = () => {}) {
    try {
      this.db.prepare('DELETE FROM sessions').run();
      callback(null);
    } catch (error) {
      callback(error);
    }
  }

  length(callback) {
    try {
      const row = this.db.prepare('SELECT COUNT(*) AS count FROM sessions').get();
      callback(null, row.count);
    } catch (error) {
      callback(error);
    }
  }

  all(callback) {
    try {
      const rows = this.db.prepare('SELECT sid, sess FROM sessions').all();
      callback(null, rows.map((row) => JSON.parse(row.sess)));
    } catch (error) {
      callback(error);
    }
  }
}

module.exports = SQLiteSessionStore;
