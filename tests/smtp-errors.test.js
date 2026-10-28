'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  sanitizeSmtpError,
  smtpErrorMessage
} = require('../server/lib/smtp');

test('sanitizeSmtpError: generischer Fehler wird zu SMTP_ERROR', () => {
  assert.equal(sanitizeSmtpError(new Error('SMTP ist nicht aktiviert.')), 'SMTP_ERROR');
  assert.equal(sanitizeSmtpError({ code: 'econnection' }), 'ECONNECTION');
  assert.equal(sanitizeSmtpError({ code: 'EAUTH<script>' }), 'EAUTHSCRIPT');
});

test('smtpErrorMessage: Konfigurationsfehler zeigt die konkrete Meldung', () => {
  const message = smtpErrorMessage('SMTP_ERROR', new Error('SMTP ist nicht aktiviert.'));
  assert.equal(message, 'SMTP ist nicht aktiviert.');
});

test('smtpErrorMessage: langere Meldungen werden begrenzt', () => {
  const message = smtpErrorMessage('SMTP_ERROR', new Error('x'.repeat(500)));
  assert.equal(message.length, 200);
});

test('smtpErrorMessage: 530 und 535 werden als Anmeldefehler erklart', () => {
  const envelope = smtpErrorMessage('EENVELOPE', { responseCode: 530, message: 'Client was not authenticated' });
  assert.match(envelope, /Anmeldung/);
  assert.doesNotMatch(envelope, /abgelehnt/);

  const auth = smtpErrorMessage('EAUTH', { responseCode: 535 });
  assert.match(auth, /Anmeldung/);
});

test('smtpErrorMessage: bekannte Fehlercodes bleiben erhalten', () => {
  assert.match(smtpErrorMessage('ECONNECTION'), /Verbindung/);
  assert.match(smtpErrorMessage('ETIMEDOUT'), /Zeit/);
  assert.match(smtpErrorMessage('EENVELOPE'), /abgelehnt/);
  assert.match(smtpErrorMessage('UNKNOWN'), /fehlgeschlagen/);
});
