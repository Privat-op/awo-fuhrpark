'use strict';

(function () {
  const block = document.getElementById('passkeyLogin');
  const button = document.getElementById('passkeyLoginButton');
  const status = document.getElementById('passkeyLoginStatus');
  if (!block || !button || !status) return;
  if (block.dataset.enabled !== '1') return;
  if (!window.PublicKeyCredential || !window.SimpleWebAuthnBrowser) return;

  block.hidden = false;

  function showError(message) {
    status.textContent = message;
    status.hidden = false;
  }

  async function postJson(url, body) {
    const csrf = document.querySelector('input[name="_csrf"]')?.value || '';
    const response = await fetch(url, {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        'content-type': 'application/json',
        'x-csrf-token': csrf
      },
      body: JSON.stringify(body)
    });
    const data = await response.json().catch(() => null);
    return { response, data };
  }

  button.addEventListener('click', async () => {
    status.hidden = true;
    status.textContent = '';
    button.disabled = true;
    try {
      const optionsResult = await postJson('/api/auth/passkey/options', {});
      if (!optionsResult.response.ok) {
        showError(optionsResult.data?.error || 'Passkey-Anmeldung ist derzeit nicht möglich.');
        return;
      }
      const assertion = await window.SimpleWebAuthnBrowser.startAuthentication({
        optionsJSON: optionsResult.data.options
      });
      const verifyResult = await postJson('/api/auth/passkey/verify', { response: assertion });
      if (!verifyResult.response.ok) {
        showError(verifyResult.data?.error || 'Passkey-Anmeldung fehlgeschlagen.');
        return;
      }
      window.location.assign(verifyResult.data?.redirect || '/');
    } catch (error) {
      if (error?.name === 'NotAllowedError') {
        showError('Passkey-Anmeldung wurde abgebrochen.');
      } else {
        showError('Passkey-Anmeldung ist derzeit nicht möglich.');
      }
    } finally {
      button.disabled = false;
    }
  });
})();
