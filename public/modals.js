'use strict';

/* =========================================================
   Dialoge & Formulare
   ========================================================= */

let lastModalTrigger = null;

function showModal({ title, eyebrow = '', subtitle = '', body = '', footer = '', size = '', onReady = null }) {
  const hasOpenModal = modalRoot.children.length > 0;
  if (!hasOpenModal) lastModalTrigger = document.activeElement;

  modalRoot.innerHTML = `
    <div class="modal-backdrop">
      <div class="modal ${size}" role="dialog" aria-modal="true" aria-labelledby="modalTitle">
        <div class="modal-head">
          <div class="modal-head-copy">
            ${eyebrow ? `<p class="eyebrow">${esc(eyebrow)}</p>` : ''}
            <h2 class="modal-title" id="modalTitle">${esc(title)}</h2>
            ${subtitle ? `<p class="modal-sub">${esc(subtitle)}</p>` : ''}
          </div>
          <button class="icon-btn modal-close" type="button" data-close-modal aria-label="Dialog schließen">${icon('x')}</button>
        </div>
        <div class="modal-body">${body}</div>
        ${footer ? `<div class="modal-foot">${footer}</div>` : ''}
      </div>
    </div>`;

  document.body.classList.add('modal-open');
  const backdrop = modalRoot.querySelector('.modal-backdrop');
  if (backdrop) backdrop.scrollTop = 0;
  if (typeof onReady === 'function') onReady();

  requestAnimationFrame(() => {
    const target = modalRoot.querySelector('[data-autofocus]') ||
      modalRoot.querySelector('.modal-body input:not([type="hidden"]):not([disabled]), .modal-body select:not([disabled]), .modal-body textarea:not([disabled])') ||
      modalRoot.querySelector('.modal-close');
    if (target) target.focus({ preventScroll: true });
  });
}

function closeModal(restoreFocus = true) {
  const trigger = lastModalTrigger;
  modalRoot.innerHTML = '';
  document.body.classList.remove('modal-open');
  lastModalTrigger = null;
  if (restoreFocus && trigger && document.contains(trigger)) {
    requestAnimationFrame(() => trigger.focus({ preventScroll: true }));
  }
}

function modalCloseBlocked() {
  const required = modalRoot.querySelector('[data-ack-required]');
  return Boolean(required && !required.checked);
}

function clearFormError(form) {
  const alert = form.querySelector('.form-alert');
  if (alert) {
    alert.classList.remove('is-visible');
    const text = alert.querySelector('span');
    if (text) text.textContent = '';
  }
}

function showFormError(form, message) {
  const alert = form.querySelector('.form-alert');
  if (alert) {
    alert.classList.add('is-visible');
    const text = alert.querySelector('span');
    if (text) text.textContent = message;
  }
  alert?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function formAlertMarkup() {
  return `<div class="form-alert">${icon('alert')}<span></span></div>`;
}

function fieldErrorMarkup() {
  return '';
}

function openConfirm({ title = 'Sind Sie sicher?', text = '', confirmLabel = 'Bestätigen', danger = true, onConfirm }) {
  showModal({
    title,
    eyebrow: 'Bestätigung',
    size: 'modal-sm',
    body: `
      <div class="confirm-icon">${icon(danger ? 'alert' : 'info')}</div>
      <p class="confirm-copy">${text}</p>`,
    footer: `
      <button class="btn btn-ghost" type="button" data-close-modal>Abbrechen</button>
      <button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" type="button" id="confirmAction" data-autofocus>${esc(confirmLabel)}</button>`
  });
  const button = $('#confirmAction');
  if (button) {
    button.addEventListener('click', () => {
      closeModal(false);
      onConfirm?.();
    });
  }
}

/* =========================================================
   Buchungen
   ========================================================= */
function locationOptionsMarkup(selectedId = '') {
  const locations = (db.locations || []).filter((location) => location.active || location.id === selectedId);
  return [
    '<option value="">Kein Standort</option>',
    ...locations.map((location) => `<option value="${esc(location.id)}" ${location.id === selectedId ? 'selected' : ''}>${esc(location.name)}${location.active ? '' : ' · inaktiv'}</option>`)
  ].join('');
}

function costCenterSelectMarkup(id, selectedId = '') {
  return `
    <div class="field field-full">
      <label for="${id}">Kostenstelle</label>
      <select class="select" id="${id}" name="costCenterId">${costCenterOptionsMarkup(selectedId)}</select>
      <p class="field-hint" id="${id}Hint"></p>
    </div>`;
}

function costCenterSelectionHint(selectedId, defaultId, { driver = null, vehicle = null, user = null } = {}) {
  if (!selectedId) return 'Ohne Kostenstelle – es wird keine Zuordnung übernommen.';
  const source = driver?.costCenterId === selectedId
    ? 'Fahrer:in'
    : vehicle?.costCenterId === selectedId
      ? 'Fahrzeug'
      : user?.costCenterId === selectedId
        ? 'Benutzerkonto'
        : '';
  if (selectedId === defaultId && source) return `Vorbelegt aus ${source}; die Auswahl kann geändert werden.`;
  return 'Explizit ausgewählt; die Zuordnung wird als Snapshot gespeichert.';
}

function leasingBookingHintMarkup(vehicle) {
  const leasing = vehicle?.leasing;
  if (!leasing || !Array.isArray(leasing.warnings) || !leasing.warnings.length) return '';
  return leasing.warnings.map((warning) => `
    <div class="info-banner ${warning.severity === 'danger' ? 'is-danger' : ''}" style="margin-top:10px">
      ${icon('alert')}
      <div><strong>${esc(warning.title)}</strong><p>${esc(warning.text)}</p></div>
    </div>`).join('');
}

function openBookingModal(prefill = {}) {
  if (!can('bookings_create')) {
    toast('Keine Berechtigung', 'Ihre Rolle darf keine Buchungen anlegen.', 'error');
    return;
  }
  const availableVehicles = db.vehicles;
  const prefillVehicle = prefill.vehicleId ? getVehicle(prefill.vehicleId) : null;
  const selectedVehicle = (prefillVehicle && vehicleIsBookable(prefillVehicle) ? prefillVehicle : null)
    || availableVehicles.find((vehicle) => vehicleIsBookable(vehicle))
    || availableVehicles[0];
  const drivers = db.drivers.filter((driver) => driver.status !== 'away');
  const selectedDriver = prefill.driverId ? getDriver(prefill.driverId) : drivers[0];
  if (!availableVehicles.length) {
    toast('Kein Fahrzeug vorhanden', 'Bitte legen Sie zuerst ein Fahrzeug an.', 'info');
    return;
  }
  if (!availableVehicles.some((vehicle) => vehicleIsBookable(vehicle))) {
    toast('Kein buchbares Fahrzeug', 'Für neue Buchungen ist aktuell kein Fahrzeug freigegeben.', 'info');
    return;
  }
  if (!drivers.length) {
    toast('Keine Fahrer:in verfügbar', 'Bitte legen Sie zuerst eine Fahrer:in an.', 'info');
    return;
  }
  const date = prefill.date || todayISO();
  const startTime = prefill.startTime || '09:00';
  const endTime = prefill.endTime || '11:00';
  const purpose = prefill.purpose || '';
  const canSelectCostCenter = can('cost_centers_view');
  const defaultCostCenterId = defaultBookingCostCenterId({ driver: selectedDriver, vehicle: selectedVehicle, user: currentUser });

  const vehicleOptions = vehicleChoiceOptionsMarkup(availableVehicles, selectedVehicle?.id);
  const driverOptions = drivers.map((driver) => `<option value="${driver.id}" ${driver.id === selectedDriver?.id ? 'selected' : ''}>${esc(driver.name)} · ${esc(driver.role)}</option>`).join('');

  showModal({
    title: 'Neue Buchung',
    eyebrow: 'Fahrtenplanung',
    subtitle: 'Reservieren Sie ein Fahrzeug und eine Fahrer:in für die geplante Fahrt.',
    body: `
      <form id="bookingForm" novalidate autocomplete="off">
        ${formAlertMarkup()}
        <div class="form-grid">
          <div class="field field-full">
            <label for="bookingVehicle">Fahrzeug <span class="optional">*</span></label>
            <select class="select" id="bookingVehicle" name="vehicleId" required>
              ${vehicleOptions}
            </select>
            <p class="field-hint">Bitte prüfen Sie den Status und die Verfügbarkeit des Fahrzeugs.</p>
            <div id="bookingLeasingHint" hidden></div>
          </div>
          <div class="field field-full">
            <label for="bookingDriver">Fahrer:in <span class="optional">*</span></label>
            <select class="select" id="bookingDriver" name="driverId" required>
              ${driverOptions}
            </select>
          </div>
          ${canSelectCostCenter ? costCenterSelectMarkup('bookingCostCenter', defaultCostCenterId) : ''}
          <div class="field">
            <label for="bookingDate">Datum <span class="optional">*</span></label>
            <input class="input" id="bookingDate" name="date" type="date" value="${esc(date)}" required>
          </div>
          <div class="field">
            <label for="bookingPurpose">Einsatzzweck <span class="optional">*</span></label>
            <input class="input" id="bookingPurpose" name="purpose" type="text" value="${esc(purpose)}" placeholder="z. B. Hausbesuche" maxlength="100" required>
          </div>
          <div class="field">
            <label for="bookingStart">Von <span class="optional">*</span></label>
            <input class="input" id="bookingStart" name="startTime" type="time" value="${esc(startTime)}" step="300" required>
          </div>
          <div class="field">
            <label for="bookingEnd">Bis <span class="optional">*</span></label>
            <input class="input" id="bookingEnd" name="endTime" type="time" value="${esc(endTime)}" step="300" required>
          </div>
          <div class="field field-full">
            <label for="bookingNotes">Notizen <span class="optional">optional</span></label>
            <textarea class="textarea" id="bookingNotes" name="notes" rows="2" maxlength="400" placeholder="Weitere Informationen zur Fahrt …">${esc(prefill.notes || '')}</textarea>
          </div>
        </div>
      </form>`,
    footer: `
      <button class="btn btn-ghost" type="button" data-close-modal>Abbrechen</button>
      <button class="btn btn-primary" type="submit" form="bookingForm">${icon('calendar-check')} Buchung speichern</button>`
  });

  const form = $('#bookingForm');
  const vehicleSelect = $('#bookingVehicle');
  const leasingHint = $('#bookingLeasingHint');
  const refreshLeasingHint = () => {
    if (!leasingHint) return;
    const markup = leasingBookingHintMarkup(getVehicle(vehicleSelect?.value));
    leasingHint.innerHTML = markup;
    leasingHint.hidden = !markup;
  };
  vehicleSelect?.addEventListener('change', refreshLeasingHint);
  refreshLeasingHint();

  const driverSelect = $('#bookingDriver');
  const costCenterSelect = $('#bookingCostCenter');
  const costCenterHint = $('#bookingCostCenterHint');
  let costCenterTouched = false;
  const refreshCostCenter = () => {
    if (!costCenterSelect) return;
    const driver = getDriver(driverSelect?.value);
    const vehicle = getVehicle(vehicleSelect?.value);
    const nextDefault = defaultBookingCostCenterId({ driver, vehicle, user: currentUser });
    if (!costCenterTouched && costCenterSelect.value !== nextDefault) costCenterSelect.value = nextDefault;
    if (costCenterHint) {
      costCenterHint.textContent = costCenterSelectionHint(costCenterSelect.value, nextDefault, { driver, vehicle, user: currentUser });
    }
  };
  costCenterSelect?.addEventListener('change', () => {
    costCenterTouched = true;
    refreshCostCenter();
  });
  driverSelect?.addEventListener('change', refreshCostCenter);
  vehicleSelect?.addEventListener('change', refreshCostCenter);
  refreshCostCenter();

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    clearFormError(form);
    const data = new FormData(form);
    const vehicleId = String(data.get('vehicleId') || '');
    const driverId = String(data.get('driverId') || '');
    const bookingDate = String(data.get('date') || '');
    const from = String(data.get('startTime') || '');
    const to = String(data.get('endTime') || '');
    const bookingPurpose = String(data.get('purpose') || '').trim();
    const notes = String(data.get('notes') || '').trim();
    const vehicle = getVehicle(vehicleId);

    if (!vehicleId || !driverId || !bookingDate || !from || !to || !bookingPurpose) {
      showFormError(form, 'Bitte füllen Sie alle Pflichtfelder aus.');
      return;
    }
    if (to <= from) {
      showFormError(form, 'Das Ende der Buchung muss nach dem Beginn liegen.');
      return;
    }
    if (vehicle?.blocked) {
      showFormError(form, 'Dieses Fahrzeug ist dauerhaft gesperrt und kann nicht gebucht werden.');
      return;
    }

    const submitButton = modalRoot.querySelector('button[form="bookingForm"]');
    if (submitButton) submitButton.disabled = true;
    try {
      const state = await apiFetch('/api/bookings', {
        method: 'POST',
        body: {
          vehicleId,
          driverId,
          date: bookingDate,
          startTime: from,
          endTime: to,
          purpose: bookingPurpose,
          notes,
          ...(costCenterSelect ? { costCenterId: costCenterSelect.value || null } : {})
        }
      });
      const leasingWarning = state.leasingWarning;
      applyServerState(state);
      closeModal(false);
      renderCurrentView();
      toast('Buchung angelegt', `${vehicle ? vehicle.name : 'Fahrzeug'} · ${formatDate(bookingDate)}, ${from}–${to} Uhr`);
      if (leasingWarning) toast('Leasing-Hinweis', leasingWarning, 'info');
    } catch (error) {
      showFormError(form, error.message);
    } finally {
      if (submitButton) submitButton.disabled = false;
    }
  });
}

function openBookingRequestModal(prefill = {}) {
  if (!db.ownTrips?.canRequest) {
    toast('Keine Berechtigung', 'Für Buchungsanfragen fehlt die Freigabe „Buchung anfragen“.', 'error');
    return;
  }
  const vehicles = db.ownTrips.vehicles || [];
  if (!vehicles.length) {
    toast('Kein Fahrzeug vorhanden', 'Es ist aktuell kein Fahrzeug für Buchungsanfragen hinterlegt.', 'info');
    return;
  }
  if (!vehicles.some((vehicle) => vehicleIsBookable(vehicle))) {
    toast('Kein buchbares Fahrzeug', 'Für neue Buchungsanfragen ist aktuell kein Fahrzeug freigegeben.', 'info');
    return;
  }
  const selectedVehicle = prefill.vehicleId
    ? vehicles.find((vehicle) => vehicle.id === prefill.vehicleId && vehicleIsBookable(vehicle))
    : vehicles.find((vehicle) => vehicleIsBookable(vehicle)) || vehicles[0];
  const canSelectCostCenter = can('cost_centers_view');
  const defaultCostCenterId = defaultBookingCostCenterId({ driver: db.ownTrips.driver, vehicle: selectedVehicle, user: currentUser });
  const date = prefill.date || todayISO();
  const startTime = prefill.startTime || '09:00';
  const endTime = prefill.endTime || '11:00';
  const vehicleOptions = vehicleChoiceOptionsMarkup(vehicles, selectedVehicle?.id);

  showModal({
    title: 'Buchung anfragen',
    eyebrow: 'Meine Fahrten',
    subtitle: `Anfrage für ${db.ownTrips.driver.name} – die Genehmigung erfolgt durch die Fuhrparkleitung.`,
    body: `
      <form id="bookingRequestForm" novalidate autocomplete="off">
        ${formAlertMarkup()}
        <div class="info-banner">
          ${icon('info')}
          <div><strong>Keine Reservierung durch die Anfrage</strong><p>Die Anfrage wird nur gespeichert. Erst die Genehmigung legt eine geplante Buchung an und prüft den Zeitraum verbindlich auf Konflikte.</p></div>
        </div>
        <div class="form-grid">
          <div class="field field-full">
            <label for="requestVehicle">Fahrzeug <span class="optional">*</span></label>
            <select class="select" id="requestVehicle" name="vehicleId" required>${vehicleOptions}</select>
            <div id="requestLeasingHint" hidden></div>
          </div>
          ${canSelectCostCenter ? costCenterSelectMarkup('requestCostCenter', defaultCostCenterId) : ''}
          <div class="field">
            <label for="requestDate">Datum <span class="optional">*</span></label>
            <input class="input" id="requestDate" name="date" type="date" value="${esc(date)}" required>
          </div>
          <div class="field">
            <label for="requestPurpose">Einsatzzweck <span class="optional">*</span></label>
            <input class="input" id="requestPurpose" name="purpose" type="text" value="${esc(prefill.purpose || '')}" placeholder="z. B. Hausbesuche" maxlength="200" required>
          </div>
          <div class="field">
            <label for="requestStart">Von <span class="optional">*</span></label>
            <input class="input" id="requestStart" name="startTime" type="time" value="${esc(startTime)}" step="300" required>
          </div>
          <div class="field">
            <label for="requestEnd">Bis <span class="optional">*</span></label>
            <input class="input" id="requestEnd" name="endTime" type="time" value="${esc(endTime)}" step="300" required>
          </div>
          <div class="field field-full">
            <label for="requestNotes">Notizen <span class="optional">optional</span></label>
            <textarea class="textarea" id="requestNotes" name="notes" rows="2" maxlength="1000" placeholder="Weitere Informationen zur Fahrt …">${esc(prefill.notes || '')}</textarea>
          </div>
        </div>
      </form>`,
    footer: `
      <button class="btn btn-ghost" type="button" data-close-modal>Abbrechen</button>
      <button class="btn btn-primary" type="submit" form="bookingRequestForm">${icon('calendar-check')} Anfrage senden</button>`
  });

  const form = $('#bookingRequestForm');
  const requestVehicleSelect = $('#requestVehicle');
  const requestLeasingHint = $('#requestLeasingHint');
  const refreshRequestLeasingHint = () => {
    if (!requestLeasingHint) return;
    const vehicle = vehicles.find((entry) => entry.id === requestVehicleSelect?.value);
    const markup = leasingBookingHintMarkup(vehicle);
    requestLeasingHint.innerHTML = markup;
    requestLeasingHint.hidden = !markup;
  };
  requestVehicleSelect?.addEventListener('change', refreshRequestLeasingHint);
  refreshRequestLeasingHint();

  const requestCostCenterSelect = $('#requestCostCenter');
  const requestCostCenterHint = $('#requestCostCenterHint');
  let requestCostCenterTouched = false;
  const refreshRequestCostCenter = () => {
    if (!requestCostCenterSelect) return;
    const vehicle = vehicles.find((entry) => entry.id === requestVehicleSelect?.value);
    const nextDefault = defaultBookingCostCenterId({ driver: db.ownTrips.driver, vehicle, user: currentUser });
    if (!requestCostCenterTouched && requestCostCenterSelect.value !== nextDefault) requestCostCenterSelect.value = nextDefault;
    if (requestCostCenterHint) {
      requestCostCenterHint.textContent = costCenterSelectionHint(requestCostCenterSelect.value, nextDefault, {
        driver: db.ownTrips.driver,
        vehicle,
        user: currentUser
      });
    }
  };
  requestCostCenterSelect?.addEventListener('change', () => {
    requestCostCenterTouched = true;
    refreshRequestCostCenter();
  });
  requestVehicleSelect?.addEventListener('change', refreshRequestCostCenter);
  refreshRequestCostCenter();

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    clearFormError(form);
    const data = new FormData(form);
    const vehicleId = String(data.get('vehicleId') || '');
    const bookingDate = String(data.get('date') || '');
    const from = String(data.get('startTime') || '');
    const to = String(data.get('endTime') || '');
    const purpose = String(data.get('purpose') || '').trim();
    const vehicle = vehicles.find((entry) => entry.id === vehicleId);
    if (!vehicleId || !bookingDate || !from || !to || !purpose) {
      showFormError(form, 'Bitte füllen Sie alle Pflichtfelder aus.');
      return;
    }
    if (to <= from) {
      showFormError(form, 'Das Ende der Anfrage muss nach dem Beginn liegen.');
      return;
    }
    if (vehicle?.blocked) {
      showFormError(form, 'Dieses Fahrzeug ist dauerhaft gesperrt. Bitte wählen Sie ein anderes Fahrzeug.');
      return;
    }
    const submitButton = modalRoot.querySelector('button[form="bookingRequestForm"]');
    if (submitButton) submitButton.disabled = true;
    try {
      const state = await apiFetch('/api/booking-requests', {
        method: 'POST',
        body: {
          vehicleId,
          date: bookingDate,
          startTime: from,
          endTime: to,
          purpose,
          notes: String(data.get('notes') || '').trim(),
          ...(requestCostCenterSelect ? { costCenterId: requestCostCenterSelect.value || null } : {})
        }
      });
      const warning = state.requestWarning;
      const leasingWarning = state.leasingWarning;
      applyServerState(state);
      closeModal(false);
      renderCurrentView();
      toast('Buchungsanfrage gesendet', `${vehicle ? vehicle.name : 'Fahrzeug'} · ${formatDate(bookingDate)}, ${from}–${to} Uhr`);
      if (warning) toast('Hinweis zur Verfügbarkeit', warning, 'info');
      if (leasingWarning) toast('Leasing-Hinweis', leasingWarning, 'info');
    } catch (error) {
      showFormError(form, error.message);
    } finally {
      if (submitButton) submitButton.disabled = false;
    }
  });
}

function openRejectBookingRequestModal(requestId) {
  if (!can('booking_requests_manage')) {
    toast('Keine Berechtigung', 'Für das Ablehnen von Buchungsanfragen fehlt die Berechtigung.', 'error');
    return;
  }
  const request = db.bookingRequests?.find((item) => item.id === requestId);
  if (!request) return;
  showModal({
    title: 'Buchungsanfrage ablehnen',
    eyebrow: 'Entscheidung',
    subtitle: `${request.requesterName || 'Fahrer:in'} · ${request.vehicleName} · ${formatDate(request.start)}`,
    body: `
      <form id="rejectBookingRequestForm" novalidate>
        ${formAlertMarkup()}
        <div class="form-grid">
          <div class="field field-full">
            <label for="rejectDecisionNote">Begründung <span class="optional">optional</span></label>
            <textarea class="textarea" id="rejectDecisionNote" name="decisionNote" rows="3" maxlength="500" placeholder="Hinweis für die anfragende Person …"></textarea>
          </div>
        </div>
      </form>`,
    footer: `
      <button class="btn btn-ghost" type="button" data-close-modal>Abbrechen</button>
      <button class="btn btn-danger" type="submit" form="rejectBookingRequestForm">${icon('x')} Anfrage ablehnen</button>`
  });
  const form = $('#rejectBookingRequestForm');
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    clearFormError(form);
    const submitButton = modalRoot.querySelector('button[form="rejectBookingRequestForm"]');
    if (submitButton) submitButton.disabled = true;
    try {
      const state = await apiFetch(`/api/booking-requests/${encodeURIComponent(requestId)}/reject`, {
        method: 'POST',
        body: { decisionNote: String(new FormData(form).get('decisionNote') || '').trim() }
      });
      applyServerState(state);
      closeModal(false);
      renderCurrentView();
      toast('Buchungsanfrage abgelehnt', 'Die anfragende Person sieht die Entscheidung in „Meine Fahrten“.');
    } catch (error) {
      showFormError(form, error.message);
    } finally {
      if (submitButton) submitButton.disabled = false;
    }
  });
}

function openBookingDetails(bookingId) {
  const booking = db.bookings.find((item) => item.id === bookingId);
  if (!booking) return;
  const vehicle = bookingVehicle(booking);
  const driver = bookingDriver(booking);
  const distance = booking.startKm != null && booking.endKm != null ? Math.max(0, Number(booking.endKm) - Number(booking.startKm)) : null;
  const canManage = canOn('booking', booking.id, 'bookings_manage');
  const canStart = canManage && booking.status === 'planned';
  const canEnd = canManage && booking.status === 'active';
  const canCancel = canManage && booking.status === 'planned';
  const canDelete = canManage && booking.status === 'canceled';

  const footerActions = [
    canDelete ? `<button class="btn btn-danger-ghost" type="button" data-action="delete-booking" data-id="${booking.id}">${icon('trash')} Löschen</button>` : '',
    canCancel ? `<button class="btn btn-danger-ghost" type="button" data-action="cancel-booking" data-id="${booking.id}">${icon('x')} Stornieren</button>` : '',
    canStart ? `<button class="btn btn-primary" type="button" data-action="start-booking" data-id="${booking.id}">${icon('play')} Fahrt starten</button>` : '',
    canEnd ? `<button class="btn btn-primary" type="button" data-action="end-booking" data-id="${booking.id}">${icon('stop')} Fahrt beenden</button>` : '',
    !canStart && !canEnd && !canCancel && !canDelete ? `<button class="btn btn-ghost" type="button" data-close-modal>Schließen</button>` : ''
  ].join('');

  showModal({
    title: booking.purpose,
    eyebrow: 'Buchungsdetails',
    subtitle: `${formatDateLong(booking.start.slice(0, 10))} · ${formatTimeRange(booking.start, booking.end)}`,
    size: 'modal-lg',
    body: `
      <div class="detail-hero" style="--vehicle-soft:${vehicle ? hexToRgba(vehicle.color, 0.12) : '#f4f5f7'}">
        <div class="detail-art">${vehicle ? vehicleArt(vehicle.type, vehicle.color) : icon('car')}</div>
        <div class="detail-title">
          <h3>${esc(vehicle ? vehicle.name : 'Fahrzeug')}</h3>
          <div class="vehicle-sub"><span class="plate">${esc(vehicle ? vehicle.plate : '—')}</span><span>·</span><span>${esc(vehicle ? vehicle.location : '')}</span></div>
          <div style="margin-top:8px">${statusBadge(booking.status)}</div>
        </div>
      </div>
      <div class="detail-stats">
        <div class="detail-stat"><span>${icon('calendar')} Datum</span><strong>${formatDate(booking.start)}</strong></div>
        <div class="detail-stat"><span>${icon('clock')} Zeitraum</span><strong>${formatTimeRange(booking.start, booking.end)}</strong></div>
        <div class="detail-stat"><span>${icon('route')} Distanz</span><strong>${distance != null ? formatKm(distance) : 'Noch offen'}</strong></div>
      </div>
      <div class="detail-section">
        <p class="detail-section-title">Fahrtdetails</p>
        <div class="detail-list">
          <div class="detail-list-item">
            <span class="mini-icon tint-blue">${icon('users')}</span>
            <div class="main"><strong>Fahrer:in</strong><span>${esc(driver ? `${driver.name} · ${driver.role}` : 'Nicht zugewiesen')}</span></div>
          </div>
          <div class="detail-list-item">
            <span class="mini-icon tint-amber">${icon('gauge')}</span>
            <div class="main"><strong>Kilometerstand</strong><span>${booking.startKm != null ? `${formatKm(booking.startKm)}${booking.endKm != null ? ` → ${formatKm(booking.endKm)}` : ' · Fahrt läuft'}` : 'Wird beim Start erfasst'}</span></div>
          </div>
          <div class="detail-list-item">
            <span class="mini-icon tint-gray">${icon('receipt')}</span>
            <div class="main"><strong>Kostenstelle</strong><span>${booking.costCenterId ? esc(costCenterLabel({ companyCode: booking.companyCode, code: booking.costCenterCode, name: booking.costCenterName })) : 'Ohne Kostenstelle'}</span></div>
          </div>
          <div class="detail-list-item">
            <span class="mini-icon tint-gray">${icon('book')}</span>
            <div class="main"><strong>Notizen</strong><span>${booking.notes ? esc(booking.notes) : 'Keine Notizen hinterlegt.'}</span></div>
          </div>
        </div>
      </div>`,
    footer: footerActions || `<button class="btn btn-ghost" type="button" data-close-modal>Schließen</button>`
  });
}

function openEndTripModal(bookingId) {
  if (!canExecuteOwnBooking(bookingId)) {
    toast('Keine Berechtigung', 'Für diese Buchung fehlt die Berechtigung zum Beenden.', 'error');
    return;
  }
  const booking = getBookingForAction(bookingId);
  if (!booking) return;
  const vehicle = bookingVehicle(booking);
  if (!vehicle) return;
  const startKm = booking.startKm != null ? Number(booking.startKm) : Number(vehicle.mileage);
  const suggestedEnd = Math.max(Number(vehicle.mileage), startKm) + 10;

  showModal({
    title: 'Fahrt beenden',
    eyebrow: 'Fahrtenbuch',
    subtitle: `${esc(vehicle.name)} · ${formatTimeRange(booking.start, booking.end)}`,
    body: `
      <form id="endTripForm" novalidate>
        ${formAlertMarkup()}
        <div class="form-grid">
          <div class="field">
            <label for="startKmDisplay">Startkilometer</label>
            <input class="input" id="startKmDisplay" type="text" value="${formatNumber(startKm)} km" disabled>
          </div>
          <div class="field">
            <label for="endKm">Endkilometer <span class="optional">*</span></label>
            <input class="input" id="endKm" name="endKm" type="number" min="${startKm}" step="1" value="${suggestedEnd}" required>
          </div>
          <div class="field field-full">
            <p class="field-hint" id="endKmHint">Die Differenz wird automatisch dem Fahrtenbuch hinzugefügt.</p>
          </div>
        </div>
      </form>`,
    footer: `
      <button class="btn btn-ghost" type="button" data-close-modal>Abbrechen</button>
      <button class="btn btn-primary" type="submit" form="endTripForm">${icon('check')} Fahrt abschließen</button>`
  });

  const form = $('#endTripForm');
  const input = $('#endKm', form);
  const hint = $('#endKmHint', form);
  const updateHint = () => {
    const value = Number(input.value);
    if (!value || value < startKm) {
      hint.textContent = 'Der Endkilometerstand muss mindestens dem Startkilometerstand entsprechen.';
      hint.style.color = 'var(--red)';
    } else {
      hint.textContent = `Distanz: ${formatNumber(value - startKm)} km · wird dem Fahrtenbuch hinzugefügt.`;
      hint.style.color = '';
    }
  };
  input.addEventListener('input', updateHint);
  updateHint();

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    clearFormError(form);
    const endKm = Number(input.value);
    if (!Number.isFinite(endKm) || !Number.isInteger(endKm)) {
      showFormError(form, 'Bitte geben Sie einen gültigen Endkilometerstand ein.');
      return;
    }
    if (endKm < startKm) {
      showFormError(form, 'Der Endkilometerstand darf nicht kleiner als der Startkilometerstand sein.');
      return;
    }
    const submitButton = modalRoot.querySelector('button[form="endTripForm"]');
    if (submitButton) submitButton.disabled = true;
    try {
      const state = await apiFetch(`/api/bookings/${encodeURIComponent(booking.id)}/end`, {
        method: 'POST',
        body: { endKm }
      });
      const leasingWarning = state.leasingWarning;
      applyServerState(state);
      closeModal(false);
      renderCurrentView();
      toast('Fahrt abgeschlossen', `${formatNumber(endKm - startKm)} km wurden dem Fahrtenbuch hinzugefügt.`);
      if (leasingWarning) toast('Leasing-Hinweis', leasingWarning, 'info');
    } catch (error) {
      showFormError(form, error.message);
    } finally {
      if (submitButton) submitButton.disabled = false;
    }
  });
}

/* =========================================================
   Fahrzeuge
   ========================================================= */
function resizeVehicleImage(file) {
  return new Promise((resolve, reject) => {
    if (!file || !file.type.startsWith('image/')) {
      reject(new Error('Bitte wählen Sie eine Bilddatei aus.'));
      return;
    }
    if (file.size > 15 * 1024 * 1024) {
      reject(new Error('Das Bild ist größer als 15 MB. Bitte wählen Sie eine kleinere Datei.'));
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Die Datei konnte nicht gelesen werden.'));
    reader.onload = () => {
      const image = new Image();
      image.onerror = () => reject(new Error('Das Bildformat wird nicht unterstützt.'));
      image.onload = () => {
        const maxDimension = 1200;
        const scale = Math.min(1, maxDimension / Math.max(image.width, image.height));
        const width = Math.max(1, Math.round(image.width * scale));
        const height = Math.max(1, Math.round(image.height * scale));
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext('2d');
        if (!context) {
          reject(new Error('Das Bild konnte nicht verarbeitet werden.'));
          return;
        }
        context.fillStyle = '#ffffff';
        context.fillRect(0, 0, width, height);
        context.drawImage(image, 0, 0, width, height);
        let dataUrl = canvas.toDataURL('image/jpeg', 0.82);
        if (dataUrl.length > 900000) dataUrl = canvas.toDataURL('image/jpeg', 0.68);
        resolve(dataUrl);
      };
      image.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Die Datei konnte nicht gelesen werden.'));
    reader.onload = () => resolve(reader.result);
    reader.readAsDataURL(file);
  });
}

async function prepareCostReceipt(file) {
  if (!file) return null;
  if (file.type.startsWith('image/')) {
    const data = await resizeVehicleImage(file);
    return { name: file.name, type: 'image/jpeg', data, size: file.size };
  }
  if (file.type === 'application/pdf') {
    if (file.size > 2 * 1024 * 1024) {
      throw new Error('PDF-Belege dürfen maximal 2 MB groß sein.');
    }
    const data = await readFileAsDataUrl(file);
    return { name: file.name, type: 'application/pdf', data, size: file.size };
  }
  throw new Error('Bitte wählen Sie eine JPG-, PNG- oder PDF-Datei aus.');
}

function openVehicleModal(vehicleId = null) {
  const allowed = vehicleId ? canOn('vehicle', vehicleId, 'vehicles_manage') : canBase('vehicles_manage');
  if (!allowed) {
    toast('Keine Berechtigung', 'Ihre Rolle darf dieses Fahrzeug nicht bearbeiten.', 'error');
    return;
  }
  const existing = vehicleId ? getVehicle(vehicleId) : null;
  const defaults = {
    name: '', plate: '', type: 'Pkw', fuel: 'Diesel', seats: 5, status: 'available', ownershipType: 'owned',
    location: '', department: '', mileage: 0, nextService: addDays(todayISO(), 90),
    tuv: addDays(todayISO(), 365), insurance: '', notes: '', image: '', blocked: false, blockedReason: '',
    leasing: null
  };
  const vehicle = existing || defaults;
  const ownership = vehicle.ownershipType || (vehicle.leasing ? 'leasing' : 'owned');
  const leasing = vehicle.leasing || {};
  const title = existing ? 'Fahrzeug bearbeiten' : 'Fahrzeug anlegen';
  let pendingImage = vehicle.image || '';
  let newImageData = null;
  let removeImage = false;

  const imagePreview = pendingImage
    ? `<img src="${esc(pendingImage)}" alt="Vorschau des Fahrzeugbildes">`
    : `<span class="image-upload-empty">${icon('car')}<span>Noch kein Foto</span></span>`;

  showModal({
    title,
    eyebrow: 'Fuhrpark',
    subtitle: existing ? `${vehicle.name} · ${vehicle.plate}` : 'Neues Fahrzeug in die Flotte aufnehmen.',
    size: 'modal-lg',
    body: `
      <form id="vehicleForm" novalidate autocomplete="off">
        ${formAlertMarkup()}
        <div class="form-grid">
          <div class="field field-full">
            <label>Fahrzeugbild <span class="optional">optional</span></label>
            <div class="image-upload" id="vehicleImageUpload">
              <div class="image-upload-preview" id="vehicleImagePreview">${imagePreview}</div>
              <div class="image-upload-copy">
                <strong>Foto hinzufügen</strong>
                <p>JPG oder PNG. Das Bild wird automatisch verkleinert und sicher auf dem Server gespeichert.</p>
                <div class="image-upload-actions">
                  <label class="btn btn-ghost btn-sm" for="vehicleImageInput">${icon('download')} Bild auswählen</label>
                  <button class="btn btn-ghost btn-sm" type="button" id="vehicleImageRemove" ${pendingImage ? '' : 'hidden'}>${icon('trash')} Entfernen</button>
                </div>
              </div>
              <input class="sr-only" id="vehicleImageInput" type="file" accept="image/*">
            </div>
            <p class="field-hint">Das Foto erscheint auf der Fahrzeugkarte und in den Fahrzeugdetails.</p>
          </div>
          <div class="form-section-title">Fahrzeugdaten</div>
          <div class="field">
            <label for="vehicleName">Bezeichnung <span class="optional">*</span></label>
            <input class="input" id="vehicleName" name="name" type="text" value="${esc(vehicle.name)}" placeholder="z. B. VW Caddy 5" required>
          </div>
          <div class="field">
            <label for="vehiclePlate">Kennzeichen <span class="optional">*</span></label>
            <input class="input" id="vehiclePlate" name="plate" type="text" value="${esc(vehicle.plate)}" placeholder="HB-AW 123" required>
          </div>
          <div class="field">
            <label for="vehicleType">Fahrzeugtyp</label>
            <select class="select" id="vehicleType" name="type">
              ${['Pkw', 'Transporter', 'Bus'].map((type) => `<option value="${type}" ${vehicle.type === type ? 'selected' : ''}>${type}</option>`).join('')}
            </select>
          </div>
          <div class="field">
            <label for="vehicleFuel">Kraftstoff</label>
            <select class="select" id="vehicleFuel" name="fuel">
              ${['Diesel', 'Benzin', 'Elektro', 'Hybrid'].map((fuel) => `<option value="${fuel}" ${vehicle.fuel === fuel ? 'selected' : ''}>${fuel}</option>`).join('')}
            </select>
          </div>
          <div class="field">
            <label for="vehicleSeats">Sitzplätze</label>
            <input class="input" id="vehicleSeats" name="seats" type="number" min="1" max="20" step="1" value="${vehicle.seats}" required>
          </div>
          <div class="field">
            <label for="vehicleStatus">Status</label>
            <select class="select" id="vehicleStatus" name="status">
              ${Object.entries(VEHICLE_STATUS).map(([value, meta]) => `<option value="${value}" ${vehicle.status === value ? 'selected' : ''}>${meta.label}</option>`).join('')}
            </select>
          </div>
          <div class="field field-full">
            <label>Eigentum</label>
            <div class="checkbox-grid" role="radiogroup" aria-label="Eigentum oder Leasing">
              ${vehicleOwnershipMarkup(ownership)}
            </div>
            <p class="field-hint">Bei Eigentum werden Leasingfelder ignoriert; gespeicherte Werte bleiben erhalten.</p>
          </div>
          <div class="field">
            <label for="vehicleLocation">Standort (Freitext)</label>
            <input class="input" id="vehicleLocation" name="location" type="text" value="${esc(vehicle.location)}" placeholder="z. B. Kita Pusteblume">
          </div>
          ${db.features?.locationsEnabled ? `<div class="field">
            <label for="vehicleLocationId">Standortzuordnung</label>
            <select class="select" id="vehicleLocationId" name="locationId">${locationOptionsMarkup(vehicle.locationId)}</select>
            <p class="field-hint">Steuert die Sichtbarkeit bei aktivierter Standortfunktion.</p>
          </div>` : ''}
          <div class="field">
            <label for="vehicleDepartment">Abteilung / Einrichtung</label>
            <input class="input" id="vehicleDepartment" name="department" type="text" value="${esc(vehicle.department)}" placeholder="z. B. Ambulante Pflege">
          </div>
          ${can('cost_centers_view') ? `<div class="field">
            <label for="vehicleCostCenter">Kostenstelle</label>
            <select class="select" id="vehicleCostCenter" name="costCenterId">${costCenterOptionsMarkup(vehicle.costCenterId)}</select>
            <p class="field-hint">Default für Buchungen und Kosten dieses Fahrzeugs.</p>
          </div>` : ''}
          <div class="form-section-title">Betrieb & Termine</div>
          <div class="field">
            <label for="vehicleMileage">Kilometerstand</label>
            <input class="input" id="vehicleMileage" name="mileage" type="number" min="0" step="1" value="${Number(vehicle.mileage) || 0}">
          </div>
          <div class="field">
            <label for="vehicleInsurance">Versicherung</label>
            <input class="input" id="vehicleInsurance" name="insurance" type="text" value="${esc(vehicle.insurance)}" placeholder="z. B. VGH · Flottentarif">
          </div>
          <div class="field">
            <label for="vehicleService">Nächste Inspektion</label>
            <input class="input" id="vehicleService" name="nextService" type="date" value="${esc(vehicle.nextService)}">
          </div>
          <div class="field">
            <label for="vehicleTuv">Nächste HU/AU</label>
            <input class="input" id="vehicleTuv" name="tuv" type="date" value="${esc(vehicle.tuv)}">
          </div>
          <div id="vehicleLeasingSection" ${vehicleLeasingSectionHidden(ownership)}>
          <div class="form-section-title">Leasing</div>
          <div class="field">
            <label for="vehicleLeasingStart">Leasingbeginn <span class="optional">optional</span></label>
            <input class="input" id="vehicleLeasingStart" name="leasingStart" type="date" value="${esc(leasing.start || '')}">
          </div>
          <div class="field">
            <label for="vehicleLeasingEnd">Leasingende</label>
            <input class="input" id="vehicleLeasingEnd" name="leasingEnd" type="date" value="${esc(leasing.end || '')}">
          </div>
          <div class="field">
            <label for="vehicleLeasingStartKm">Startkilometer</label>
            <input class="input" id="vehicleLeasingStartKm" name="leasingStartKm" type="number" min="0" step="1" value="${leasing.startKm ?? ''}" placeholder="Kilometerstand bei Leasingbeginn">
          </div>
          <div class="field">
            <label for="vehicleLeasingKmLimit">Gesamt-Kilometerlimit</label>
            <input class="input" id="vehicleLeasingKmLimit" name="leasingKmLimit" type="number" min="1" step="1" value="${leasing.kmLimit ?? ''}" placeholder="z. B. 120000">
          </div>
          <div class="field field-full">
            <p class="field-hint">Leasingende und Kilometerlimit gemeinsam hinterlegen. Ohne Angaben bleibt das Fahrzeug außerhalb der Leasingüberwachung; bestehende Daten bleiben unverändert.</p>
          </div>
          </div>
          <div class="form-section-title">Dauerhafte Sperre</div>
          <div class="field field-full">
            <label class="check-row"><input type="checkbox" id="vehicleBlocked" name="blocked" ${vehicle.blocked ? 'checked' : ''}> Fahrzeug dauerhaft für neue Buchungen und Anfragen sperren</label>
            <p class="field-hint">Bestehende Buchungen, Fahrtstart und Fahrtende bleiben unverändert. Die Sperre wird auditiert.</p>
          </div>
          <div class="field field-full" id="vehicleBlockedReasonField" ${vehicle.blocked ? '' : 'hidden'}>
            <label for="vehicleBlockedReason">Grund der Sperre <span class="optional">optional</span></label>
            <textarea class="textarea" id="vehicleBlockedReason" name="blockedReason" rows="2" maxlength="500" placeholder="z. B. Werkstattauftrag, Schaden oder fehlende Prüfung">${esc(vehicle.blockedReason || '')}</textarea>
          </div>
          <div class="field field-full">
            <label for="vehicleNotes">Notizen <span class="optional">optional</span></label>
            <textarea class="textarea" id="vehicleNotes" name="notes" rows="2" maxlength="500" placeholder="Besonderheiten, Ausstattung oder Hinweise …">${esc(vehicle.notes)}</textarea>
          </div>
        </div>
      </form>`,
    footer: `
      <button class="btn btn-ghost" type="button" data-close-modal>Abbrechen</button>
      <button class="btn btn-primary" type="submit" form="vehicleForm">${icon('check')} ${existing ? 'Änderungen speichern' : 'Fahrzeug anlegen'}</button>`
  });

  const form = $('#vehicleForm');
  const leasingSection = $('#vehicleLeasingSection');
  const refreshOwnershipState = () => {
    const selected = form?.querySelector('input[name="ownershipType"]:checked')?.value || 'owned';
    if (leasingSection) leasingSection.hidden = selected !== 'leasing';
  };
  form?.querySelectorAll('input[name="ownershipType"]').forEach((input) => {
    input.addEventListener('change', refreshOwnershipState);
  });
  refreshOwnershipState();
  const imageInput = $('#vehicleImageInput');
  const imagePreviewBox = $('#vehicleImagePreview');
  const removeImageButton = $('#vehicleImageRemove');
  const uploadBox = $('#vehicleImageUpload');
  const blockedCheckbox = $('#vehicleBlocked');
  const blockedReasonField = $('#vehicleBlockedReasonField');
  const refreshBlockedState = () => {
    if (blockedReasonField && blockedCheckbox) blockedReasonField.hidden = !blockedCheckbox.checked;
  };
  blockedCheckbox?.addEventListener('change', refreshBlockedState);
  refreshBlockedState();

  const refreshImagePreview = () => {
    imagePreviewBox.innerHTML = pendingImage
      ? `<img src="${esc(pendingImage)}" alt="Vorschau des Fahrzeugbildes">`
      : `<span class="image-upload-empty">${icon('car')}<span>Noch kein Foto</span></span>`;
    if (removeImageButton) removeImageButton.hidden = !pendingImage;
  };

  const applyImageFile = async (file) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      toast('Kein Bild', 'Bitte wählen Sie eine JPG- oder PNG-Datei aus.', 'error');
      return;
    }
    uploadBox.classList.add('is-loading');
    try {
      const dataUrl = await resizeVehicleImage(file);
      pendingImage = dataUrl;
      newImageData = dataUrl;
      removeImage = false;
      refreshImagePreview();
      toast('Bild übernommen', 'Das Foto wird beim Speichern auf dem Server hinterlegt.', 'info');
    } catch (error) {
      toast('Bild konnte nicht geladen werden', error.message || 'Bitte versuchen Sie es mit einer anderen Datei.', 'error');
    } finally {
      uploadBox.classList.remove('is-loading');
      if (imageInput) imageInput.value = '';
    }
  };

  imageInput?.addEventListener('change', () => applyImageFile(imageInput.files?.[0]));
  removeImageButton?.addEventListener('click', () => {
    pendingImage = '';
    newImageData = null;
    removeImage = true;
    refreshImagePreview();
  });
  ['dragenter', 'dragover'].forEach((eventName) => {
    uploadBox?.addEventListener(eventName, (event) => {
      event.preventDefault();
      uploadBox.classList.add('is-dragging');
    });
  });
  ['dragleave', 'drop'].forEach((eventName) => {
    uploadBox?.addEventListener(eventName, (event) => {
      event.preventDefault();
      uploadBox.classList.remove('is-dragging');
    });
  });
  uploadBox?.addEventListener('drop', (event) => {
    const file = event.dataTransfer?.files?.[0];
    applyImageFile(file);
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    clearFormError(form);
    const data = new FormData(form);
    const name = String(data.get('name') || '').trim();
    const plate = String(data.get('plate') || '').trim().toUpperCase();
    if (!name || !plate) {
      showFormError(form, 'Bitte geben Sie Bezeichnung und Kennzeichen an.');
      return;
    }
    const duplicate = db.vehicles.find((item) => item.plate.toLowerCase() === plate.toLowerCase() && item.id !== vehicleId);
    if (duplicate) {
      showFormError(form, `Das Kennzeichen ${plate} ist bereits für ${duplicate.name} hinterlegt.`);
      return;
    }
    const values = {
      name,
      plate,
      type: String(data.get('type') || 'Pkw'),
      fuel: String(data.get('fuel') || 'Diesel'),
      seats: Math.max(1, Number(data.get('seats')) || 1),
      status: String(data.get('status') || 'available'),
      ownershipType: String(data.get('ownershipType') || 'owned'),
      location: String(data.get('location') || '').trim(),
      department: String(data.get('department') || '').trim(),
      costCenterId: String(data.get('costCenterId') || '') || null,
      locationId: String(data.get('locationId') || '') || null,
      mileage: Math.max(0, Number(data.get('mileage')) || 0),
      insurance: String(data.get('insurance') || '').trim(),
      nextService: String(data.get('nextService') || ''),
      tuv: String(data.get('tuv') || ''),
      notes: String(data.get('notes') || '').trim(),
      leasingStart: String(data.get('leasingStart') || ''),
      leasingEnd: String(data.get('leasingEnd') || ''),
      leasingStartKm: data.get('leasingStartKm') === '' ? '' : Number(data.get('leasingStartKm')),
      leasingKmLimit: data.get('leasingKmLimit') === '' ? '' : Number(data.get('leasingKmLimit')),
      blocked: data.get('blocked') === 'on',
      blockedReason: String(data.get('blockedReason') || '').trim(),
      color: existing?.color,
      imageData: newImageData,
      removeImage
    };

    const submitButton = modalRoot.querySelector('button[form="vehicleForm"]');
    if (submitButton) submitButton.disabled = true;
    try {
      const state = await apiFetch(existing ? `/api/vehicles/${encodeURIComponent(existing.id)}` : '/api/vehicles', {
        method: existing ? 'PATCH' : 'POST',
        body: values
      });
      applyServerState(state);
      closeModal(false);
      renderCurrentView();
      toast(existing ? 'Fahrzeug aktualisiert' : 'Fahrzeug angelegt', `${name} wurde gespeichert.`);
    } catch (error) {
      showFormError(form, error.message);
    } finally {
      if (submitButton) submitButton.disabled = false;
    }
  });
}

function vehicleMutationPayload(vehicle, overrides = {}) {
  return {
    name: vehicle.name,
    plate: vehicle.plate,
    type: vehicle.type,
    fuel: vehicle.fuel,
    seats: vehicle.seats,
    status: vehicle.status,
    ownershipType: vehicle.ownershipType || 'owned',
    location: vehicle.location || '',
    department: vehicle.department || '',
    costCenterId: vehicle.costCenterId || '',
    locationId: vehicle.locationId || '',
    mileage: vehicle.mileage,
    nextService: vehicle.nextService || '',
    tuv: vehicle.tuv || '',
    insurance: vehicle.insurance || '',
    notes: vehicle.notes || '',
    color: vehicle.color,
    leasingStart: vehicle.leasing?.start || '',
    leasingEnd: vehicle.leasing?.end || '',
    leasingStartKm: vehicle.leasing?.startKm ?? '',
    leasingKmLimit: vehicle.leasing?.kmLimit ?? '',
    blocked: Boolean(vehicle.blocked),
    blockedReason: vehicle.blockedReason || '',
    ...overrides
  };
}

function openVehicleBlockModal(vehicleId) {
  const vehicle = getVehicle(vehicleId);
  if (!vehicle) return;
  if (!canOn('vehicle', vehicle.id, 'vehicles_manage')) {
    toast('Keine Berechtigung', 'Für das Sperren oder Entsperren fehlt die Berechtigung „Fahrzeuge verwalten“.', 'error');
    return;
  }
  if (vehicle.blocked) {
    openConfirm({
      title: 'Fahrzeug entsperren?',
      text: `<strong>${esc(vehicle.name)}</strong> (${esc(vehicle.plate)}) wird wieder für neue Buchungen und Buchungsanfragen freigegeben. Bestehende Buchungen bleiben unverändert.`,
      confirmLabel: 'Sperre aufheben',
      danger: false,
      onConfirm: async () => {
        try {
          const state = await apiFetch(`/api/vehicles/${encodeURIComponent(vehicle.id)}`, {
            method: 'PATCH',
            body: vehicleMutationPayload(vehicle, { blocked: false, blockedReason: '' })
          });
          applyServerState(state);
          renderCurrentView();
          toast('Fahrzeug entsperrt', `${vehicle.name} ist wieder buchbar.`);
        } catch (error) {
          toast('Sperre konnte nicht aufgehoben werden', error.message, 'error');
        }
      }
    });
    return;
  }
  showModal({
    title: 'Fahrzeug sperren',
    eyebrow: 'Fuhrpark',
    subtitle: `${vehicle.name} · ${vehicle.plate}`,
    body: `
      <form id="vehicleBlockForm" novalidate>
        ${formAlertMarkup()}
        <div class="info-banner">
          ${icon('alert')}
          <div><strong>Neue Buchungen und Anfragen werden blockiert</strong><p>Bestehende Buchungen bleiben unverändert; Fahrtstart und Fahrtende sind weiterhin möglich. Die Sperre kann jederzeit über die Fahrzeugverwaltung aufgehoben werden.</p></div>
        </div>
        <div class="form-grid">
          <div class="field field-full">
            <label for="vehicleBlockReason">Grund der Sperre <span class="optional">optional</span></label>
            <textarea class="textarea" id="vehicleBlockReason" name="blockedReason" rows="3" maxlength="500" placeholder="z. B. Werkstattauftrag, Schaden oder fehlende Prüfung"></textarea>
          </div>
        </div>
      </form>`,
    footer: `
      <button class="btn btn-ghost" type="button" data-close-modal>Abbrechen</button>
      <button class="btn btn-danger" type="submit" form="vehicleBlockForm">${icon('alert')} Dauerhaft sperren</button>`
  });
  const form = $('#vehicleBlockForm');
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    clearFormError(form);
    const reason = String(new FormData(form).get('blockedReason') || '').trim();
    const submitButton = modalRoot.querySelector('button[form="vehicleBlockForm"]');
    if (submitButton) submitButton.disabled = true;
    try {
      const state = await apiFetch(`/api/vehicles/${encodeURIComponent(vehicle.id)}`, {
        method: 'PATCH',
        body: vehicleMutationPayload(vehicle, { blocked: true, blockedReason: reason })
      });
      applyServerState(state);
      closeModal(false);
      renderCurrentView();
      toast('Fahrzeug gesperrt', `${vehicle.name} ist für neue Buchungen und Anfragen gesperrt.`);
    } catch (error) {
      showFormError(form, error.message);
    } finally {
      if (submitButton) submitButton.disabled = false;
    }
  });
}

function openVehicleDetails(vehicleId) {
  const vehicle = getVehicle(vehicleId);
  if (!vehicle) return;
  const canManageVehicle = canOn('vehicle', vehicleId, 'vehicles_manage');
  const canBookVehicle = canOn('vehicle', vehicleId, 'bookings_create');
  const unavailableReason = vehicleUnavailableReason(vehicle);
  const ownership = VEHICLE_OWNERSHIP[vehicle.ownershipType] || VEHICLE_OWNERSHIP.owned;
  const blocked = Boolean(vehicle.blocked);
  const showBookings = canOn('vehicle', vehicleId, 'bookings_view');
  const showMaintenance = canOn('vehicle', vehicleId, 'maintenance_view');
  const showCosts = canOn('vehicle', vehicleId, 'costs_view');
  const upcoming = showBookings ? sortByDateAsc(db.bookings.filter((booking) => booking.vehicleId === vehicleId &&
    ['planned', 'active'].includes(booking.status) &&
    booking.start.slice(0, 10) >= todayISO())).slice(0, 3) : [];
  const maintenance = showMaintenance ? [...db.maintenance.filter((item) => item.vehicleId === vehicleId)]
    .sort((a, b) => String(b.dueDate).localeCompare(String(a.dueDate))).slice(0, 3) : [];
  const costTotal = showCosts ? getCostsLastMonths(6).filter((cost) => cost.vehicleId === vehicleId).reduce((sum, cost) => sum + Number(cost.amount), 0) : 0;
  const status = VEHICLE_STATUS[vehicle.status] || VEHICLE_STATUS.available;
  const tuvDays = daysUntil(vehicle.tuv);
  const serviceDays = daysUntil(vehicle.nextService);

  const bookingRows = upcoming.length ? upcoming.map((booking) => {
    const driver = getDriver(booking.driverId);
    return `<div class="detail-list-item">
      <span class="mini-icon tint-blue">${icon('calendar')}</span>
      <div class="main"><strong>${esc(booking.purpose)}</strong><span>${formatDate(booking.start)} · ${formatTimeRange(booking.start, booking.end)} · ${esc(driver ? driver.name : '')}</span></div>
      ${statusBadge(booking.status)}
    </div>`;
  }).join('') : `<div class="empty empty-sm"><span class="empty-icon">${icon('calendar')}</span><strong>Keine anstehenden Buchungen</strong><span>Das Fahrzeug ist aktuell frei planbar.</span></div>`;

  const maintenanceRows = maintenance.length ? maintenance.map((item) => {
    const state = maintenanceState(item);
    return `<div class="detail-list-item">
      <span class="mini-icon ${state.badge === 'green' ? 'tint-green' : 'tint-amber'}">${icon('wrench')}</span>
      <div class="main"><strong>${esc(item.title)}</strong><span>${formatDate(item.dueDate)} · ${esc(item.workshop || 'Werkstatt')}</span></div>
      <span class="badge badge-${state.badge}">${state.label}</span>
    </div>`;
  }).join('') : `<div class="empty empty-sm"><span class="empty-icon">${icon('wrench')}</span><strong>Keine Wartungen erfasst</strong><span>Für dieses Fahrzeug liegen keine Einträge vor.</span></div>`;

  showModal({
    title: vehicle.name,
    eyebrow: 'Fahrzeugdetails',
    subtitle: `${vehicle.plate} · ${vehicle.department}`,
    size: 'modal-xl',
    body: `
      <div class="detail-hero" style="--vehicle-soft:${hexToRgba(vehicle.color, 0.13)}">
        <div class="detail-art ${vehicle.image ? 'has-photo' : ''}">${vehicle.image ? `<img src="${esc(vehicle.image)}" alt="${esc(vehicle.name)}">` : vehicleArt(vehicle.type, vehicle.color)}</div>
        <div class="detail-title">
          <h3>${esc(vehicle.name)}</h3>
          <div class="vehicle-sub"><span class="plate">${esc(vehicle.plate)}</span><span>·</span><span class="badge badge-${ownership.badge} no-dot">${ownership.label}</span><span>·</span><span>${esc(vehicle.location)}</span></div>
          <div style="margin-top:8px"><span class="badge badge-${status.badge}">${status.label}</span>${blocked ? ' <span class="badge badge-red">Dauerhaft gesperrt</span>' : ''}</div>
        </div>
      </div>
      ${blocked ? `<div class="info-banner" style="margin-bottom:16px">${icon('alert')}<div><strong>Dauerhafte Sperre aktiv</strong><p>${esc(vehicle.blockedReason || 'Keine Begründung hinterlegt.')} Neue Buchungen und Buchungsanfragen sind gesperrt; bestehende Buchungen bleiben unverändert.</p></div></div>` : ''}
      ${!blocked && unavailableReason ? `<div class="info-banner" style="margin-bottom:16px">${icon('alert')}<div><strong>Nicht buchbar</strong><p>${esc(unavailableReason)}</p></div></div>` : ''}
      ${leasingDetailMarkup(vehicle)}
      <div class="detail-stats">
        <div class="detail-stat"><span>${icon('gauge')} Kilometerstand</span><strong>${formatKm(vehicle.mileage)}</strong></div>
        <div class="detail-stat"><span>${icon('shield')} HU/AU</span><strong>${formatDate(vehicle.tuv)}${tuvDays < 0 ? ` · ${Math.abs(tuvDays)} Tage überfällig` : ''}</strong></div>
        <div class="detail-stat"><span>${icon('wrench')} Inspektion</span><strong>${formatDate(vehicle.nextService)}</strong></div>
        <div class="detail-stat"><span>${icon('fuel')} Kraftstoff</span><strong>${esc(vehicle.fuel)}</strong></div>
        <div class="detail-stat"><span>${icon('seat')} Sitzplätze</span><strong>${vehicle.seats}</strong></div>
        <div class="detail-stat"><span>${icon('receipt')} Kostenstelle</span><strong>${vehicle.costCenterCode ? esc(vehicle.costCenterCode) : 'Ohne'}</strong></div>
        ${vehicle.leasing?.kmLimit ? `<div class="detail-stat"><span>${icon('calendar')} Leasing-Restkm</span><strong>${vehicle.leasing.remainingKm < 0 ? `−${formatKm(Math.abs(vehicle.leasing.remainingKm))}` : formatKm(vehicle.leasing.remainingKm)}</strong></div>` : ''}
        ${vehicle.leasing?.end ? `<div class="detail-stat"><span>${icon('calendar')} Leasingende</span><strong>${formatDate(vehicle.leasing.end)}</strong></div>` : ''}
        ${showCosts ? `<div class="detail-stat"><span>${icon('receipt')} Kosten 6 Monate</span><strong>${formatMoney(costTotal)}</strong></div>` : ''}
      </div>
      <div class="detail-section">
        <p class="detail-section-title">Stammdaten</p>
        <div class="detail-list">
          <div class="detail-list-item">
            <span class="mini-icon tint-gray">${icon('building')}</span>
            <div class="main"><strong>Standort & Abteilung</strong><span>${esc(vehicle.location || '—')} · ${esc(vehicle.department || '—')}</span></div>
          </div>
          <div class="detail-list-item">
            <span class="mini-icon tint-teal">${icon('shield')}</span>
            <div class="main"><strong>Versicherung</strong><span>${esc(vehicle.insurance || 'Nicht hinterlegt')}</span></div>
          </div>
          <div class="detail-list-item">
            <span class="mini-icon tint-blue">${icon('info')}</span>
            <div class="main"><strong>Notizen</strong><span>${esc(vehicle.notes || 'Keine Notizen hinterlegt.')}</span></div>
          </div>
        </div>
      </div>
      ${(showBookings || showMaintenance) ? `<div class="detail-sections-grid">
        ${showBookings ? `<div class="detail-section">
          <p class="detail-section-title">Nächste Buchungen</p>
          <div class="detail-list">${bookingRows}</div>
        </div>` : ''}
        ${showMaintenance ? `<div class="detail-section">
          <p class="detail-section-title">Wartungshistorie</p>
          <div class="detail-list">${maintenanceRows}</div>
        </div>` : ''}
      </div>` : ''}`,
    footer: [
      canManageVehicle ? `<button class="btn btn-ghost" type="button" data-action="edit-vehicle" data-id="${vehicle.id}">${icon('edit')} Bearbeiten</button>` : '',
      canManageVehicle ? `<button class="btn btn-ghost" type="button" data-action="toggle-vehicle-block" data-id="${vehicle.id}">${blocked ? icon('check-circle') : icon('alert')} ${blocked ? 'Entsperren' : 'Sperren'}</button>` : '',
      canBookVehicle ? `<button class="btn btn-primary" type="button" data-action="book-vehicle" data-id="${vehicle.id}" ${unavailableReason ? `disabled title="${esc(unavailableReason)}"` : ''}>${icon('calendar')} Fahrzeug buchen</button>` : '',
      !canManageVehicle && !canBookVehicle ? `<button class="btn btn-ghost" type="button" data-close-modal>Schließen</button>` : ''
    ].join('')
  });
}

/* =========================================================
   Wartung & Kosten
   ========================================================= */
function openMaintenanceModal() {
  if (!can('maintenance_manage')) {
    toast('Keine Berechtigung', 'Ihre Rolle darf Wartungen nicht erfassen.', 'error');
    return;
  }
  const vehicles = db.vehicles.filter((vehicle) => canOn('vehicle', vehicle.id, 'maintenance_manage'));
  if (!vehicles.length) {
    toast('Kein Fahrzeug freigegeben', 'Für Ihre Rolle ist aktuell kein Fahrzeug für Wartungen freigegeben.', 'info');
    return;
  }
  const vehicleOptions = vehicles.map((vehicle) => `<option value="${vehicle.id}">${esc(vehicle.name)} · ${esc(vehicle.plate)}</option>`).join('');
  showModal({
    title: 'Wartung erfassen',
    eyebrow: 'Werkstatt',
    subtitle: 'Planen Sie eine Wartung oder Reparatur für ein Fahrzeug.',
    body: `
      <form id="maintenanceForm" novalidate>
        ${formAlertMarkup()}
        <div class="form-grid">
          <div class="field field-full">
            <label for="maintenanceVehicle">Fahrzeug <span class="optional">*</span></label>
            <select class="select" id="maintenanceVehicle" name="vehicleId" required>${vehicleOptions}</select>
          </div>
          <div class="field field-full">
            <label for="maintenanceTitle">Maßnahme <span class="optional">*</span></label>
            <input class="input" id="maintenanceTitle" name="title" type="text" placeholder="z. B. Inspektion oder Reifenwechsel" required maxlength="120">
          </div>
          <div class="field">
            <label for="maintenanceDue">Fällig am <span class="optional">*</span></label>
            <input class="input" id="maintenanceDue" name="dueDate" type="date" value="${addDays(todayISO(), 14)}" required>
          </div>
          <div class="field">
            <label for="maintenanceCost">Geschätzte Kosten</label>
            <input class="input" id="maintenanceCost" name="cost" type="number" min="0" step="0.01" placeholder="0,00">
          </div>
          <div class="field field-full">
            <label for="maintenanceWorkshop">Werkstatt</label>
            <input class="input" id="maintenanceWorkshop" name="workshop" type="text" placeholder="z. B. Autohaus Nord" maxlength="120">
          </div>
          <div class="field field-full">
            <label for="maintenanceNotes">Notizen <span class="optional">optional</span></label>
            <textarea class="textarea" id="maintenanceNotes" name="notes" rows="2" maxlength="400" placeholder="Weitere Hinweise zur Maßnahme …"></textarea>
          </div>
        </div>
      </form>`,
    footer: `
      <button class="btn btn-ghost" type="button" data-close-modal>Abbrechen</button>
      <button class="btn btn-primary" type="submit" form="maintenanceForm">${icon('wrench')} Wartung speichern</button>`
  });

  const form = $('#maintenanceForm');
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    clearFormError(form);
    const data = new FormData(form);
    const vehicleId = String(data.get('vehicleId') || '');
    const title = String(data.get('title') || '').trim();
    const dueDate = String(data.get('dueDate') || '');
    if (!vehicleId || !title || !dueDate) {
      showFormError(form, 'Bitte wählen Sie ein Fahrzeug und geben Sie Maßnahme und Fälligkeit an.');
      return;
    }
    const submitButton = modalRoot.querySelector('button[form="maintenanceForm"]');
    if (submitButton) submitButton.disabled = true;
    try {
      const state = await apiFetch('/api/maintenance', {
        method: 'POST',
        body: {
          vehicleId,
          title,
          dueDate,
          workshop: String(data.get('workshop') || '').trim(),
          cost: Math.max(0, Number(data.get('cost')) || 0),
          notes: String(data.get('notes') || '').trim()
        }
      });
      applyServerState(state);
      closeModal(false);
      renderCurrentView();
      toast('Wartung erfasst', `${title} wurde in den Wartungsplan aufgenommen.`);
    } catch (error) {
      showFormError(form, error.message);
    } finally {
      if (submitButton) submitButton.disabled = false;
    }
  });
}

function openCostCenterModal(costCenterId = null) {
  if (!can('cost_centers_manage')) {
    toast('Keine Berechtigung', 'Für die Verwaltung von Kostenstellen fehlt die Berechtigung „Kostenstellen verwalten“.', 'error');
    return;
  }
  const existing = costCenterId ? (db.costCenters || []).find((entry) => entry.id === costCenterId) : null;
  const defaultCompany = (db.companies || []).find((company) => company.active) || (db.companies || [])[0] || null;
  const costCenter = existing || { companyId: defaultCompany?.id || '', code: '', name: '', description: '', active: true };
  const companyOptions = (db.companies || [])
    .filter((company) => company.active || company.id === costCenter.companyId)
    .map((company) => `<option value="${company.id}" ${company.id === costCenter.companyId ? 'selected' : ''}>${esc(company.code)} · ${esc(company.name)}${company.active ? '' : ' · inaktiv'}</option>`)
    .join('');
  const companyLabel = (db.companies || []).find((company) => company.id === costCenter.companyId);
  showModal({
    title: existing ? 'Kostenstelle bearbeiten' : 'Kostenstelle anlegen',
    eyebrow: 'Kostenstellen',
    subtitle: existing
      ? `${companyLabel ? `${companyLabel.code} · ` : ''}${costCenter.code} · ${costCenter.name}`
      : 'Neue Kostenstelle für die Zuordnung von Fahrzeugen, Buchungen und Kosten.',
    size: 'modal-sm',
    body: `
      <form id="costCenterForm" novalidate autocomplete="off">
        ${formAlertMarkup()}
        <div class="form-grid">
          <div class="field field-full">
            <label for="costCenterCompany">Gesellschaft <span class="optional">*</span></label>
            <select class="select" id="costCenterCompany" name="companyId" required ${companyOptions ? '' : 'disabled'}>
              ${companyOptions || '<option value="">Keine Gesellschaft vorhanden</option>'}
            </select>
            <p class="field-hint">Codes sind je Gesellschaft case-insensitiv eindeutig.</p>
          </div>
          <div class="field field-full">
            <label for="costCenterCode">Code <span class="optional">*</span></label>
            <input class="input" id="costCenterCode" name="code" type="text" value="${esc(costCenter.code)}" placeholder="z. B. KST-100" maxlength="40" required>
            <p class="field-hint">Wird normalisiert (Großschreibung, Leerzeichen als Bindestrich) und muss innerhalb der Gesellschaft eindeutig sein.</p>
          </div>
          <div class="field field-full">
            <label for="costCenterName">Bezeichnung <span class="optional">*</span></label>
            <input class="input" id="costCenterName" name="name" type="text" value="${esc(costCenter.name)}" placeholder="z. B. Ambulante Pflege" maxlength="160" required>
          </div>
          <div class="field field-full">
            <label for="costCenterDescription">Beschreibung <span class="optional">optional</span></label>
            <textarea class="textarea" id="costCenterDescription" name="description" rows="2" maxlength="500" placeholder="Interne Hinweise zur Kostenstelle …">${esc(costCenter.description || '')}</textarea>
          </div>
          <div class="field field-full">
            <label class="check-row"><input type="checkbox" id="costCenterActive" name="active" ${costCenter.active ? 'checked' : ''}> Kostenstelle aktiv</label>
            <p class="field-hint">Inaktive Kostenstellen bleiben historisch sichtbar, können aber nicht neu zugeordnet werden.</p>
          </div>
        </div>
      </form>`,
    footer: `
      <button class="btn btn-ghost" type="button" data-close-modal>Abbrechen</button>
      <button class="btn btn-primary" type="submit" form="costCenterForm">${icon('check')} ${existing ? 'Änderungen speichern' : 'Kostenstelle anlegen'}</button>`
  });

  const form = $('#costCenterForm');
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    clearFormError(form);
    const data = new FormData(form);
    const companyId = String(data.get('companyId') || '').trim();
    const code = String(data.get('code') || '').trim();
    const name = String(data.get('name') || '').trim();
    if (!companyId) {
      showFormError(form, 'Bitte wählen Sie eine Gesellschaft aus.');
      return;
    }
    if (!code || !name) {
      showFormError(form, 'Bitte geben Sie Code und Bezeichnung an.');
      return;
    }
    const submitButton = modalRoot.querySelector('button[form="costCenterForm"]');
    if (submitButton) submitButton.disabled = true;
    try {
      const state = await apiFetch(existing ? `/api/cost-centers/${encodeURIComponent(existing.id)}` : '/api/cost-centers', {
        method: existing ? 'PATCH' : 'POST',
        body: {
          companyId,
          code,
          name,
          description: String(data.get('description') || '').trim(),
          active: data.get('active') === 'on'
        }
      });
      applyServerState(state);
      closeModal(false);
      if (ui.route === 'einstellungen') renderCurrentView();
      toast(existing ? 'Kostenstelle aktualisiert' : 'Kostenstelle angelegt', `${code} · ${name} wurde gespeichert.`);
    } catch (error) {
      showFormError(form, error.message);
    } finally {
      if (submitButton) submitButton.disabled = false;
    }
  });
}

function toggleCostCenterActive(costCenterId) {
  const costCenter = (db.costCenters || []).find((entry) => entry.id === costCenterId);
  if (!costCenter) return;
  const nextActive = !costCenter.active;
  openConfirm({
    title: nextActive ? 'Kostenstelle aktivieren?' : 'Kostenstelle deaktivieren?',
    text: nextActive
      ? `<strong>${esc(costCenter.code)} · ${esc(costCenter.name)}</strong> kann danach wieder neu zugeordnet werden.`
      : `<strong>${esc(costCenter.code)} · ${esc(costCenter.name)}</strong> bleibt historisch sichtbar, kann aber nicht mehr neu zugeordnet werden. Bestehende Zuordnungen bleiben unverändert.`,
    confirmLabel: nextActive ? 'Aktivieren' : 'Deaktivieren',
    danger: !nextActive,
    onConfirm: async () => {
      try {
        const state = await apiFetch(`/api/cost-centers/${encodeURIComponent(costCenter.id)}`, {
          method: 'PATCH',
          body: {
            code: costCenter.code,
            name: costCenter.name,
            description: costCenter.description || '',
            active: nextActive
          }
        });
        applyServerState(state);
        renderCurrentView();
        toast(nextActive ? 'Kostenstelle aktiviert' : 'Kostenstelle deaktiviert', `${costCenter.code} wurde aktualisiert.`);
      } catch (error) {
        toast('Kostenstelle konnte nicht aktualisiert werden', error.message, 'error');
      }
    }
  });
}

function deleteCostCenter(costCenterId) {
  const costCenter = (db.costCenters || []).find((entry) => entry.id === costCenterId);
  if (!costCenter) return;
  const usageTotal = Number(costCenter.usage?.total) || 0;
  if (usageTotal > 0) {
    toast('Kostenstelle wird verwendet', 'Löschen ist nur ohne Zuordnungen möglich. Deaktivieren Sie die Kostenstelle stattdessen.', 'error');
    return;
  }
  openConfirm({
    title: 'Kostenstelle löschen?',
    text: `<strong>${esc(costCenter.code)} · ${esc(costCenter.name)}</strong> wird dauerhaft entfernt. Diese Aktion ist nur ohne bestehende Zuordnungen möglich.`,
    confirmLabel: 'Kostenstelle löschen',
    danger: true,
    onConfirm: async () => {
      try {
        const state = await apiFetch(`/api/cost-centers/${encodeURIComponent(costCenter.id)}`, { method: 'DELETE' });
        applyServerState(state);
        renderCurrentView();
        toast('Kostenstelle gelöscht', `${costCenter.code} wurde entfernt.`);
      } catch (error) {
        toast('Kostenstelle konnte nicht gelöscht werden', error.message, 'error');
      }
    }
  });
}

function openCostModal() {
  if (!can('costs_manage')) {
    toast('Keine Berechtigung', 'Ihre Rolle darf Kosten nicht erfassen.', 'error');
    return;
  }
  const vehicles = db.vehicles.filter((vehicle) => canOn('vehicle', vehicle.id, 'costs_manage'));
  if (!vehicles.length) {
    toast('Kein Fahrzeug freigegeben', 'Für Ihre Rolle ist aktuell kein Fahrzeug für Kosten freigegeben.', 'info');
    return;
  }
  const vehicleOptions = vehicles.map((vehicle) => `<option value="${vehicle.id}">${esc(vehicle.name)} · ${esc(vehicle.plate)}</option>`).join('');
  const canSelectCostCenter = can('cost_centers_view');
  const defaultCostCenterId = defaultCostCostCenterId({ vehicle: vehicles[0], user: currentUser });
  let pendingReceipt = null;
  showModal({
    title: 'Kosten erfassen',
    eyebrow: 'Controlling',
    subtitle: 'Erfassen Sie eine Betriebskostenposition für die Flotte.',
    body: `
      <form id="costForm" novalidate>
        ${formAlertMarkup()}
        <div class="form-grid">
          <div class="field field-full">
            <label for="costVehicle">Fahrzeug <span class="optional">*</span></label>
            <select class="select" id="costVehicle" name="vehicleId" required>${vehicleOptions}</select>
          </div>
          ${canSelectCostCenter ? costCenterSelectMarkup('costCostCenter', defaultCostCenterId) : ''}
          <div class="field">
            <label for="costDate">Datum <span class="optional">*</span></label>
            <input class="input" id="costDate" name="date" type="date" value="${todayISO()}" required>
          </div>
          <div class="field">
            <label for="costCategory">Kostenart</label>
            <select class="select" id="costCategory" name="category">
              ${COST_CATEGORIES.map((category) => `<option value="${category}">${category}</option>`).join('')}
            </select>
          </div>
          <div class="field field-full">
            <label for="costAmount">Betrag in Euro <span class="optional">*</span></label>
            <input class="input" id="costAmount" name="amount" type="number" min="0.01" step="0.01" placeholder="0,00" required>
          </div>
          <div class="field field-full">
            <label for="costNote">Beschreibung <span class="optional">optional</span></label>
            <input class="input" id="costNote" name="note" type="text" placeholder="z. B. Diesel · 52,3 l" maxlength="140">
          </div>
          <div class="field field-full">
            <label>Beleg <span class="optional">optional</span></label>
            <div class="image-upload" id="costReceiptUpload">
              <div class="image-upload-preview" id="costReceiptPreview"><span class="image-upload-empty">${icon('receipt')}<span>Noch kein Beleg</span></span></div>
              <div class="image-upload-copy">
                <strong>Beleg hinzufügen</strong>
                <p>JPG, PNG oder PDF · PDF bis 2 MB. Der Beleg wird sicher auf dem Server gespeichert.</p>
                <div class="image-upload-actions">
                  <label class="btn btn-ghost btn-sm" for="costReceiptInput">${icon('paperclip')} Beleg auswählen</label>
                  <button class="btn btn-ghost btn-sm" type="button" id="costReceiptRemove" hidden>${icon('trash')} Entfernen</button>
                </div>
              </div>
              <input class="sr-only" id="costReceiptInput" type="file" accept="image/*,application/pdf">
            </div>
          </div>
        </div>
      </form>`,
    footer: `
      <button class="btn btn-ghost" type="button" data-close-modal>Abbrechen</button>
      <button class="btn btn-primary" type="submit" form="costForm">${icon('receipt')} Kosten speichern</button>`
  });

  const form = $('#costForm');
  const costVehicleSelect = $('#costVehicle');
  const costCenterSelect = $('#costCostCenter');
  const costCenterHint = $('#costCostCenterHint');
  const receiptInput = $('#costReceiptInput');
  const receiptPreview = $('#costReceiptPreview');
  const removeReceiptButton = $('#costReceiptRemove');
  const uploadBox = $('#costReceiptUpload');

  let costCenterTouched = false;
  const refreshCostCenter = () => {
    if (!costCenterSelect) return;
    const vehicle = getVehicle(costVehicleSelect?.value);
    const nextDefault = defaultCostCostCenterId({ vehicle, user: currentUser });
    if (!costCenterTouched && costCenterSelect.value !== nextDefault) costCenterSelect.value = nextDefault;
    if (costCenterHint) {
      costCenterHint.textContent = costCenterSelectionHint(costCenterSelect.value, nextDefault, { vehicle, user: currentUser });
    }
  };
  costCenterSelect?.addEventListener('change', () => {
    costCenterTouched = true;
    refreshCostCenter();
  });
  costVehicleSelect?.addEventListener('change', refreshCostCenter);
  refreshCostCenter();

  const refreshReceiptPreview = () => {
    if (!pendingReceipt) {
      receiptPreview.innerHTML = `<span class="image-upload-empty">${icon('receipt')}<span>Noch kein Beleg</span></span>`;
      if (removeReceiptButton) removeReceiptButton.hidden = true;
      return;
    }
    receiptPreview.innerHTML = pendingReceipt.type.startsWith('image/')
      ? `<img src="${esc(pendingReceipt.data)}" alt="Belegvorschau">`
      : `<span class="receipt-file-preview">${icon('receipt')}<span>PDF</span></span>`;
    if (removeReceiptButton) removeReceiptButton.hidden = false;
  };

  const applyReceipt = async (file) => {
    if (!file) return;
    uploadBox.classList.add('is-loading');
    try {
      pendingReceipt = await prepareCostReceipt(file);
      refreshReceiptPreview();
      toast('Beleg übernommen', `${file.name} wird beim Speichern an die Kostenposition gehängt.`, 'info');
    } catch (error) {
      toast('Beleg konnte nicht geladen werden', error.message || 'Bitte versuchen Sie es mit einer anderen Datei.', 'error');
    } finally {
      uploadBox.classList.remove('is-loading');
      if (receiptInput) receiptInput.value = '';
    }
  };

  receiptInput?.addEventListener('change', () => applyReceipt(receiptInput.files?.[0]));
  removeReceiptButton?.addEventListener('click', () => {
    pendingReceipt = null;
    refreshReceiptPreview();
  });
  ['dragenter', 'dragover'].forEach((eventName) => {
    uploadBox?.addEventListener(eventName, (event) => {
      event.preventDefault();
      uploadBox.classList.add('is-dragging');
    });
  });
  ['dragleave', 'drop'].forEach((eventName) => {
    uploadBox?.addEventListener(eventName, (event) => {
      event.preventDefault();
      uploadBox.classList.remove('is-dragging');
    });
  });
  uploadBox?.addEventListener('drop', (event) => {
    applyReceipt(event.dataTransfer?.files?.[0]);
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    clearFormError(form);
    const data = new FormData(form);
    const vehicleId = String(data.get('vehicleId') || '');
    const date = String(data.get('date') || '');
    const amount = Number(data.get('amount'));
    if (!vehicleId || !date || !Number.isFinite(amount) || amount <= 0) {
      showFormError(form, 'Bitte wählen Sie ein Fahrzeug und geben Sie Datum sowie einen Betrag größer als 0 an.');
      return;
    }
    const submitButton = modalRoot.querySelector('button[form="costForm"]');
    if (submitButton) submitButton.disabled = true;
    try {
      const state = await apiFetch('/api/costs', {
        method: 'POST',
        body: {
          vehicleId,
          date,
          category: String(data.get('category') || 'Sonstiges'),
          amount,
          note: String(data.get('note') || '').trim(),
          receipt: pendingReceipt,
          ...(costCenterSelect ? { costCenterId: costCenterSelect.value || null } : {})
        }
      });
      applyServerState(state);
      closeModal(false);
      renderCurrentView();
      toast('Kosten erfasst', `${formatMoney(amount, 2)} wurden verbucht.`);
    } catch (error) {
      showFormError(form, error.message);
    } finally {
      if (submitButton) submitButton.disabled = false;
    }
  });
}

function openReceiptModal(costId) {
  if (!canOn('cost', costId, 'costs_view')) {
    toast('Keine Berechtigung', 'Für diese Kostenposition fehlt die Berechtigung zum Beleg.', 'error');
    return;
  }
  const cost = db.costs.find((item) => item.id === costId);
  if (!cost || !cost.receipt) return;
  const vehicle = getVehicle(cost.vehicleId);
  const receipt = cost.receipt;
  const receiptSource = receipt.url || receipt.data;
  const isImage = String(receipt.type || '').startsWith('image/');
  const isPdf = receipt.type === 'application/pdf';
  const sizeLabel = receipt.size ? `${formatDecimal(receipt.size / 1024, 0)} KB` : '';
  const body = isImage
    ? `<div class="receipt-viewer"><img src="${esc(receiptSource)}" alt="Beleg für ${esc(cost.note || cost.category)}"></div>`
    : `<div class="receipt-pdf-card">
        <span class="receipt-pdf-icon">${icon('receipt')}</span>
        <div><strong>${esc(receipt.name || 'Belegdokument')}</strong><span>${isPdf ? 'PDF-Dokument' : 'Datei'}${sizeLabel ? ` · ${sizeLabel}` : ''}</span></div>
      </div>
      <p class="form-hint" style="margin-top:10px">PDF-Belege können über die Schaltfläche heruntergeladen und in einem PDF-Programm geöffnet werden.</p>`;

  showModal({
    title: 'Beleg ansehen',
    eyebrow: 'Kostenbeleg',
    subtitle: `${formatDate(cost.date)} · ${vehicle ? vehicle.name : 'Fahrzeug'} · ${formatMoney(cost.amount, 2)}`,
    size: 'modal-lg',
    body,
    footer: `
      <button class="btn btn-ghost" type="button" data-close-modal>Schließen</button>
      <a class="btn btn-primary" href="${esc(receiptSource)}" download="${esc(receipt.name || 'beleg')}">${icon('download')} Beleg herunterladen</a>`
  });
}

function openMaintenanceDoneConfirm(maintenanceId) {
  if (!canOn('maintenance', maintenanceId, 'maintenance_manage')) {
    toast('Keine Berechtigung', 'Für diese Wartung fehlt die Berechtigung zum Bearbeiten.', 'error');
    return;
  }
  const item = db.maintenance.find((entry) => entry.id === maintenanceId);
  if (!item) return;
  const vehicle = getVehicle(item.vehicleId);
  openConfirm({
    title: 'Wartung als erledigt markieren?',
    text: `<strong>${esc(item.title)}</strong> für <strong>${esc(vehicle ? vehicle.name : 'das Fahrzeug')}</strong> wird als erledigt eingetragen.${item.cost ? ` Die geschätzten Kosten von <strong>${formatMoney(item.cost, 2)}</strong> werden automatisch als Kostenposition übernommen.` : ''}`,
    confirmLabel: 'Als erledigt markieren',
    danger: false,
    onConfirm: async () => {
      try {
        const state = await apiFetch(`/api/maintenance/${encodeURIComponent(item.id)}/done`, { method: 'POST' });
        applyServerState(state);
        renderCurrentView();
        toast('Wartung erledigt', `${item.title} wurde abgeschlossen.`);
      } catch (error) {
        toast('Wartung konnte nicht abgeschlossen werden', error.message, 'error');
      }
    }
  });
}

/* =========================================================
   Fahrer:innen
   ========================================================= */
function openDriverModal(driverId = null) {
  const allowed = driverId ? canOn('driver', driverId, 'drivers_manage') : canBase('drivers_manage');
  if (!allowed) {
    toast('Keine Berechtigung', 'Ihre Rolle darf diese Fahrer:in nicht bearbeiten.', 'error');
    return;
  }
  const existing = driverId ? getDriver(driverId) : null;
  const defaults = { name: '', role: '', department: '', phone: '', email: '', status: 'available', license: ['B'], costCenterId: null };
  const driver = existing || defaults;
  const canSelectCostCenter = can('cost_centers_view');
  const title = existing ? 'Fahrer:in bearbeiten' : 'Fahrer:in anlegen';

  showModal({
    title,
    eyebrow: 'Team',
    subtitle: existing ? `${driver.name} · ${driver.department}` : 'Neue Mitarbeiter:in für den Fuhrpark aufnehmen.',
    body: `
      <form id="driverForm" novalidate>
        ${formAlertMarkup()}
        <div class="form-grid">
          <div class="form-section-title">Person</div>
          <div class="field">
            <label for="driverName">Name <span class="optional">*</span></label>
            <input class="input" id="driverName" name="name" type="text" value="${esc(driver.name)}" placeholder="Vor- und Nachname" required>
          </div>
          <div class="field">
            <label for="driverRole">Funktion <span class="optional">*</span></label>
            <input class="input" id="driverRole" name="role" type="text" value="${esc(driver.role)}" placeholder="z. B. Pflegefachkraft" required>
          </div>
          <div class="field">
            <label for="driverDepartment">Abteilung</label>
            <input class="input" id="driverDepartment" name="department" type="text" value="${esc(driver.department)}" placeholder="z. B. Ambulante Pflege">
          </div>
          ${canSelectCostCenter ? `<div class="field">
            <label for="driverCostCenter">Kostenstelle</label>
            <select class="select" id="driverCostCenter" name="costCenterId">${costCenterOptionsMarkup(driver.costCenterId)}</select>
            <p class="field-hint">Default für Buchungen dieser Fahrer:in.</p>
          </div>` : ''}
          <div class="field">
            <label for="driverStatus">Status</label>
            <select class="select" id="driverStatus" name="status">
              <option value="available" ${driver.status === 'available' ? 'selected' : ''}>Verfügbar</option>
              <option value="away" ${driver.status === 'away' ? 'selected' : ''}>Abwesend</option>
            </select>
          </div>
          <div class="form-section-title">Kontakt & Führerschein</div>
          <div class="field">
            <label for="driverPhone">Telefon</label>
            <input class="input" id="driverPhone" name="phone" type="tel" value="${esc(driver.phone)}" placeholder="0471 …">
          </div>
          <div class="field">
            <label for="driverEmail">E-Mail</label>
            <input class="input" id="driverEmail" name="email" type="email" value="${esc(driver.email)}" placeholder="name@organisation.de">
          </div>
          <div class="field field-full">
            <label>Führerscheinklassen</label>
            <div class="checkbox-grid">
              ${['B', 'BE', 'C1', 'D1'].map((licenseClass) => `
                <label class="check-row"><input type="checkbox" name="licenses" value="${licenseClass}" ${driver.license.includes(licenseClass) ? 'checked' : ''}> Klasse ${licenseClass}</label>`).join('')}
            </div>
          </div>
        </div>
      </form>`,
    footer: `
      <button class="btn btn-ghost" type="button" data-close-modal>Abbrechen</button>
      <button class="btn btn-primary" type="submit" form="driverForm">${icon('check')} ${existing ? 'Änderungen speichern' : 'Fahrer:in anlegen'}</button>`
  });

  const form = $('#driverForm');
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    clearFormError(form);
    const data = new FormData(form);
    const name = String(data.get('name') || '').trim();
    const role = String(data.get('role') || '').trim();
    const licenses = data.getAll('licenses').map(String);
    if (!name || !role) {
      showFormError(form, 'Bitte geben Sie Name und Funktion an.');
      return;
    }
    if (!licenses.length) {
      showFormError(form, 'Bitte wählen Sie mindestens eine Führerscheinklasse aus.');
      return;
    }
    const values = {
      name,
      role,
      department: String(data.get('department') || '').trim(),
      phone: String(data.get('phone') || '').trim(),
      email: String(data.get('email') || '').trim(),
      status: String(data.get('status') || 'available'),
      license: licenses,
      costCenterId: String(data.get('costCenterId') || '') || null,
      color: existing?.color
    };
    const submitButton = modalRoot.querySelector('button[form="driverForm"]');
    if (submitButton) submitButton.disabled = true;
    try {
      const state = await apiFetch(existing ? `/api/drivers/${encodeURIComponent(existing.id)}` : '/api/drivers', {
        method: existing ? 'PATCH' : 'POST',
        body: values
      });
      applyServerState(state);
      closeModal(false);
      renderCurrentView();
      toast(existing ? 'Fahrer:in aktualisiert' : 'Fahrer:in angelegt', `${name} wurde gespeichert.`);
    } catch (error) {
      showFormError(form, error.message);
    } finally {
      if (submitButton) submitButton.disabled = false;
    }
  });
}

/* =========================================================
   Konto
   ========================================================= */
function openPasswordModal() {
  if (capabilities.isSuperadmin || capabilities.canChangePassword === false) {
    toast('Superadmin-Passwort', 'Das Superadmin-Passwort wird ausschließlich über die Superadmin-Datei und einen Neustart geändert.', 'info');
    return;
  }
  showModal({
    title: 'Passwort ändern',
    eyebrow: 'Konto',
    subtitle: 'Verwenden Sie ein individuelles Passwort mit mindestens 10 Zeichen.',
    size: 'modal-sm',
    body: `
      <form id="passwordForm" novalidate autocomplete="off">
        ${formAlertMarkup()}
        <div class="form-grid">
          <div class="field field-full">
            <label for="currentPassword">Aktuelles Passwort</label>
            <input class="input" id="currentPassword" name="currentPassword" type="password" autocomplete="current-password" required>
          </div>
          <div class="field field-full">
            <label for="newPassword">Neues Passwort</label>
            <input class="input" id="newPassword" name="newPassword" type="password" autocomplete="new-password" minlength="10" required>
          </div>
          <div class="field field-full">
            <label for="confirmPassword">Neues Passwort wiederholen</label>
            <input class="input" id="confirmPassword" name="confirmPassword" type="password" autocomplete="new-password" minlength="10" required>
          </div>
        </div>
      </form>`,
    footer: `
      <button class="btn btn-ghost" type="button" data-close-modal>Abbrechen</button>
      <button class="btn btn-primary" type="submit" form="passwordForm">${icon('check')} Passwort speichern</button>`
  });

  const form = $('#passwordForm');
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    clearFormError(form);
    const data = new FormData(form);
    const currentPassword = String(data.get('currentPassword') || '');
    const newPassword = String(data.get('newPassword') || '');
    const confirmPassword = String(data.get('confirmPassword') || '');
    if (!currentPassword || newPassword.length < 10) {
      showFormError(form, 'Bitte geben Sie das aktuelle Passwort und ein neues Passwort mit mindestens 10 Zeichen an.');
      return;
    }
    if (newPassword !== confirmPassword) {
      showFormError(form, 'Die neuen Passwörter stimmen nicht überein.');
      return;
    }
    const submitButton = modalRoot.querySelector('button[form="passwordForm"]');
    if (submitButton) submitButton.disabled = true;
    try {
      await apiFetch('/api/auth/password', { method: 'POST', body: { currentPassword, newPassword } });
      closeModal(false);
      toast('Passwort geändert', 'Ihr neues Passwort ist ab sofort gültig.');
    } catch (error) {
      showFormError(form, error.message);
    } finally {
      if (submitButton) submitButton.disabled = false;
    }
  });
}

/* =========================================================
   MFA / Sicherheit
   ========================================================= */
function formatMfaSecret(secret) {
  const normalized = String(secret || '').toUpperCase().replace(/[^A-Z2-7]/g, '');
  return normalized.match(/.{1,4}/g)?.join(' ') || '';
}

async function copyPlainText(text) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fallback unten verwenden.
  }
  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  area.style.position = 'fixed';
  area.style.opacity = '0';
  document.body.appendChild(area);
  area.select();
  let copied = false;
  try {
    copied = document.execCommand('copy');
  } catch {
    copied = false;
  }
  area.remove();
  return copied;
}

function recoveryCodesDownloadText(codes) {
  return [
    'AWO Fuhrparkmanagement – Recovery-Codes',
    `Konto: ${currentUser?.email || ''}`,
    `Ausgegeben: ${new Date().toLocaleString('de-DE')}`,
    '',
    'Jeder Code ist einmalig gültig. Bewahren Sie diese Liste getrennt von Ihrem Gerät auf.',
    '',
    ...codes.map((code, index) => `${String(index + 1).padStart(2, '0')}. ${code}`)
  ].join('\n');
}

function showRecoveryCodesModal(codes, { title = 'MFA aktiviert', subtitle = 'Ihre Recovery-Codes wurden neu ausgegeben.', onDone = null } = {}) {
  const list = Array.isArray(codes) ? codes : [];
  showModal({
    title,
    eyebrow: 'Sicherheit',
    subtitle,
    size: 'modal-lg',
    body: `
      <div class="info-banner is-danger">
        ${icon('alert')}
        <div><strong>Nur einmal sichtbar</strong><p>Diese Codes werden nicht erneut vom Server angezeigt. Bewahren Sie sie getrennt von Ihrem Authenticator-Gerät auf. Jeder Code kann genau einmal verwendet werden.</p></div>
      </div>
      <ol class="recovery-codes" aria-label="Recovery-Codes">
        ${list.map((code) => `<li><code>${esc(code)}</code></li>`).join('')}
      </ol>
      <div class="setting-actions">
        <button class="btn btn-ghost btn-sm" type="button" id="copyRecoveryCodes">${icon('filter')} Alle kopieren</button>
        <button class="btn btn-ghost btn-sm" type="button" id="downloadRecoveryCodes">${icon('download')} Als Datei speichern</button>
      </div>
      <label class="check-row" style="margin-top:16px">
        <input type="checkbox" id="recoveryCodesAck" data-ack-required>
        <span>Ich habe die Recovery-Codes gespeichert und weiß, dass sie nur einmal angezeigt werden.</span>
      </label>`,
    footer: `
      <button class="btn btn-primary" type="button" id="recoveryCodesDone" disabled>${icon('check')} Fertig</button>`
  });

  const ack = $('#recoveryCodesAck');
  const done = $('#recoveryCodesDone');
  ack?.addEventListener('change', () => {
    if (done) done.disabled = !ack.checked;
  });
  done?.addEventListener('click', () => {
    closeModal(false);
    onDone?.();
  });
  $('#copyRecoveryCodes')?.addEventListener('click', async () => {
    const copied = await copyPlainText(list.join('\n'));
    toast(copied ? 'Codes kopiert' : 'Kopieren nicht möglich', copied ? 'Die Recovery-Codes liegen jetzt in der Zwischenablage.' : 'Bitte markieren und kopieren Sie die Codes manuell.', copied ? 'info' : 'error');
  });
  $('#downloadRecoveryCodes')?.addEventListener('click', () => {
    triggerBlobDownload('awo-recovery-codes.txt', new Blob([recoveryCodesDownloadText(list)], { type: 'text/plain;charset=utf-8' }));
  });
}

function openMfaEnrollModal() {
  if (db.security?.totpEnabled) {
    toast('Bereits aktiviert', 'Für dieses Konto ist TOTP bereits eingerichtet.', 'info');
    return;
  }
  showModal({
    title: 'TOTP einrichten',
    eyebrow: 'Sicherheit',
    subtitle: 'QR-Code wird vorbereitet …',
    size: 'modal-sm',
    body: '<div class="mfa-loading"><span class="app-spinner"></span><span>Einrichtung wird gestartet …</span></div>',
    footer: '<button class="btn btn-ghost" type="button" data-close-modal>Abbrechen</button>'
  });

  apiFetch('/api/security/totp/enroll/start', { method: 'POST' })
    .then((data) => {
      if (!/^<svg[\s>]/i.test(String(data?.qrSvg || ''))) throw new Error('Der QR-Code konnte nicht erzeugt werden.');
      showModal({
        title: 'TOTP einrichten',
        eyebrow: 'Sicherheit',
        subtitle: 'Scannen Sie den QR-Code mit Ihrer Authenticator-App und bestätigen Sie den angezeigten Code.',
        size: 'modal-lg',
        body: `
          <div class="mfa-enroll-grid">
            <div class="mfa-qr" role="img" aria-label="QR-Code für die Authenticator-App">${data.qrSvg}</div>
            <div class="mfa-enroll-copy">
              <p class="mfa-step-copy"><strong>Keine Kamera?</strong> Geben Sie dieses Secret manuell in der App ein.</p>
              <div class="mfa-secret">
                <code id="mfaSecretValue">${esc(formatMfaSecret(data.secret))}</code>
                <button class="btn btn-ghost btn-sm" type="button" id="copyMfaSecret">Kopieren</button>
              </div>
              <div class="info-banner" style="margin-top:12px">
                ${icon('lock')}
                <div><strong>Secret vertraulich behandeln</strong><p>Das Secret erscheint nur in diesem Dialog und wird nicht im Browser gespeichert.</p></div>
              </div>
            </div>
          </div>
          <form id="mfaEnrollForm" novalidate autocomplete="off">
            ${formAlertMarkup()}
            <div class="field field-full">
              <label for="mfaEnrollCode">Bestätigungscode</label>
              <input class="input" id="mfaEnrollCode" name="code" type="text" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" placeholder="123456" required data-autofocus>
              <p class="field-hint">6-stelliger Code aus der Authenticator-App.</p>
            </div>
          </form>`,
        footer: `
          <button class="btn btn-ghost" type="button" data-close-modal>Abbrechen</button>
          <button class="btn btn-primary" type="submit" form="mfaEnrollForm">${icon('check')} TOTP aktivieren</button>`
      });

      $('#copyMfaSecret')?.addEventListener('click', async () => {
        const copied = await copyPlainText(formatMfaSecret(data.secret));
        toast(copied ? 'Secret kopiert' : 'Kopieren nicht möglich', copied ? 'Das Secret liegt jetzt in der Zwischenablage.' : 'Bitte markieren und kopieren Sie das Secret manuell.', copied ? 'info' : 'error');
      });

      const form = $('#mfaEnrollForm');
      form?.addEventListener('submit', async (event) => {
        event.preventDefault();
        clearFormError(form);
        const code = String(new FormData(form).get('code') || '').replace(/\s+/g, '');
        if (!/^\d{6}$/.test(code)) {
          showFormError(form, 'Bitte geben Sie den 6-stelligen Code aus der Authenticator-App ein.');
          return;
        }
        const submitButton = modalRoot.querySelector('button[form="mfaEnrollForm"]');
        if (submitButton) submitButton.disabled = true;
        try {
          const result = await apiFetch('/api/security/totp/enroll/confirm', { method: 'POST', body: { code } });
          db.security = result.security;
          renderCurrentView();
          showRecoveryCodesModal(result.recoveryCodes, {
            title: 'MFA aktiviert',
            subtitle: 'TOTP ist jetzt aktiv. Bewahren Sie die Recovery-Codes sicher auf.',
            onDone: () => toast('MFA aktiviert', 'Beim nächsten Login wird zusätzlich ein Bestätigungscode verlangt.')
          });
        } catch (error) {
          showFormError(form, error.message);
        } finally {
          if (submitButton) submitButton.disabled = false;
        }
      });
    })
    .catch((error) => {
      closeModal(false);
      toast('Einrichtung fehlgeschlagen', error.message, 'error');
    });
}

function openMfaDisableModal() {
  if (!db.security?.totpEnabled) {
    toast('Nicht eingerichtet', 'Für dieses Konto ist kein TOTP aktiviert.', 'info');
    return;
  }
  showModal({
    title: 'MFA deaktivieren',
    eyebrow: 'Sicherheit',
    subtitle: 'Bestätigen Sie die Deaktivierung mit Ihrem aktuellen TOTP- oder Recovery-Code.',
    size: 'modal-sm',
    body: `
      <div class="info-banner is-danger">
        ${icon('alert')}
        <div><strong>Schutz wird entfernt</strong><p>Nach der Deaktivierung reicht beim Login wieder das Passwort. Alle Recovery-Codes werden ungültig.</p></div>
      </div>
      <form id="mfaDisableForm" novalidate autocomplete="off">
        ${formAlertMarkup()}
        <div class="field field-full">
          <label for="mfaDisableCode">TOTP- oder Recovery-Code</label>
          <input class="input" id="mfaDisableCode" name="code" type="text" autocomplete="one-time-code" maxlength="32" spellcheck="false" required data-autofocus>
        </div>
        <label class="check-row">
          <input type="checkbox" name="useRecovery" id="mfaDisableRecovery">
          <span>Eingabe ist ein Recovery-Code</span>
        </label>
      </form>`,
    footer: `
      <button class="btn btn-ghost" type="button" data-close-modal>Abbrechen</button>
      <button class="btn btn-danger" type="submit" form="mfaDisableForm">${icon('lock')} MFA deaktivieren</button>`
  });

  const form = $('#mfaDisableForm');
  form?.addEventListener('submit', async (event) => {
    event.preventDefault();
    clearFormError(form);
    const data = new FormData(form);
    const code = String(data.get('code') || '').replace(/\s+/g, '');
    const useRecovery = data.get('useRecovery') === 'on';
    if (!code) {
      showFormError(form, 'Bitte geben Sie einen TOTP- oder Recovery-Code ein.');
      return;
    }
    const submitButton = modalRoot.querySelector('button[form="mfaDisableForm"]');
    if (submitButton) submitButton.disabled = true;
    try {
      const result = await apiFetch('/api/security/totp/disable', { method: 'POST', body: { code, useRecovery } });
      db.security = result.security;
      closeModal(false);
      renderCurrentView();
      toast('MFA deaktiviert', 'Beim nächsten Login wird kein Bestätigungscode mehr verlangt.');
    } catch (error) {
      showFormError(form, error.message);
    } finally {
      if (submitButton) submitButton.disabled = false;
    }
  });
}

function openMfaRegenerateModal() {
  if (!db.security?.totpEnabled) {
    toast('Nicht eingerichtet', 'Für dieses Konto ist kein TOTP aktiviert.', 'info');
    return;
  }
  showModal({
    title: 'Recovery-Codes neu ausgeben',
    eyebrow: 'Sicherheit',
    subtitle: 'Bisherige Codes werden ungültig. Bestätigen Sie mit einem aktuellen TOTP- oder Recovery-Code.',
    size: 'modal-sm',
    body: `
      <form id="mfaRegenerateForm" novalidate autocomplete="off">
        ${formAlertMarkup()}
        <div class="field field-full">
          <label for="mfaRegenerateCode">TOTP- oder Recovery-Code</label>
          <input class="input" id="mfaRegenerateCode" name="code" type="text" autocomplete="one-time-code" maxlength="32" spellcheck="false" required data-autofocus>
        </div>
        <label class="check-row">
          <input type="checkbox" name="useRecovery" id="mfaRegenerateRecovery">
          <span>Eingabe ist ein Recovery-Code</span>
        </label>
      </form>`,
    footer: `
      <button class="btn btn-ghost" type="button" data-close-modal>Abbrechen</button>
      <button class="btn btn-primary" type="submit" form="mfaRegenerateForm">${icon('history')} Neue Codes ausgeben</button>`
  });

  const form = $('#mfaRegenerateForm');
  form?.addEventListener('submit', async (event) => {
    event.preventDefault();
    clearFormError(form);
    const data = new FormData(form);
    const code = String(data.get('code') || '').replace(/\s+/g, '');
    const useRecovery = data.get('useRecovery') === 'on';
    if (!code) {
      showFormError(form, 'Bitte geben Sie einen TOTP- oder Recovery-Code ein.');
      return;
    }
    const submitButton = modalRoot.querySelector('button[form="mfaRegenerateForm"]');
    if (submitButton) submitButton.disabled = true;
    try {
      const result = await apiFetch('/api/security/recovery/regenerate', { method: 'POST', body: { code, useRecovery } });
      db.security = result.security;
      renderCurrentView();
      showRecoveryCodesModal(result.recoveryCodes, {
        title: 'Neue Recovery-Codes',
        subtitle: 'Die bisherigen Codes sind jetzt ungültig.',
        onDone: () => toast('Recovery-Codes ersetzt', 'Die alten Codes können nicht mehr verwendet werden.')
      });
    } catch (error) {
      showFormError(form, error.message);
    } finally {
      if (submitButton) submitButton.disabled = false;
    }
  });
}

function openMfaAdminResetConfirm(userId) {
  const user = db.users?.find((entry) => entry.id === userId);
  if (!user || !user.canResetMfa) {
    toast('Keine Berechtigung', 'Für dieses Konto darf MFA nicht zurückgesetzt werden.', 'error');
    return;
  }
  openConfirm({
    title: 'MFA zurücksetzen?',
    text: `Für <strong>${esc(user.name)}</strong> (${esc(user.email)}) werden TOTP, alle Recovery-Codes und alle Passkeys gelöscht. Alle aktiven Sitzungen dieses Kontos werden beendet. Die Person muss MFA bzw. Passkeys bei Bedarf neu einrichten.`,
    confirmLabel: 'MFA und Passkeys zurücksetzen',
    danger: true,
    onConfirm: async () => {
      try {
        await apiFetch(`/api/security/admin-reset/${encodeURIComponent(user.id)}`, { method: 'POST' });
        const state = await apiFetch('/api/state');
        applyServerState(state);
        renderCurrentView();
        toast('MFA zurückgesetzt', `Die MFA-Einrichtung von ${user.name} wurde entfernt und die Sitzungen beendet.`);
      } catch (error) {
        toast('Reset fehlgeschlagen', error.message, 'error');
      }
    }
  });
}

function passkeysSupported() {
  return Boolean(window.PublicKeyCredential && window.SimpleWebAuthnBrowser);
}

function openAddPasskeyModal() {
  if (!db.security?.passkeyEnabled) {
    toast('Passkeys nicht konfiguriert', 'Die Administration muss WebAuthn konfigurieren.', 'info');
    return;
  }
  if (!passkeysSupported()) {
    toast('Passkeys nicht verfügbar', 'Dieser Browser unterstützt keine Passkeys.', 'info');
    return;
  }
  showModal({
    title: 'Passkey hinzufügen',
    eyebrow: 'Sicherheit',
    subtitle: 'Bestätigen Sie Ihr Passwort. Danach fordert der Browser die Passkey-Einrichtung an.',
    size: 'modal-sm',
    body: `
      <form id="addPasskeyForm" novalidate autocomplete="off">
        ${formAlertMarkup()}
        <div class="field field-full">
          <label for="passkeyName">Name</label>
          <input class="input" id="passkeyName" name="name" type="text" maxlength="120" placeholder="z. B. Laptop oder Smartphone" autocomplete="off">
        </div>
        <div class="field field-full">
          <label for="passkeyPassword">Aktuelles Passwort</label>
          <input class="input" id="passkeyPassword" name="password" type="password" autocomplete="current-password" required autofocus>
          <p class="field-hint">Erforderlich, um einen Passkey zu Ihrem Konto hinzuzufügen.</p>
        </div>
      </form>`,
    footer: `
      <button class="btn btn-ghost" type="button" data-close-modal>Abbrechen</button>
      <button class="btn btn-primary" type="submit" form="addPasskeyForm">${icon('shield')} Passkey hinzufügen</button>`
  });

  const form = $('#addPasskeyForm');
  form?.addEventListener('submit', async (event) => {
    event.preventDefault();
    clearFormError(form);
    const data = new FormData(form);
    const password = String(data.get('password') || '');
    const name = String(data.get('name') || '').trim();
    if (!password) {
      showFormError(form, 'Bitte bestätigen Sie Ihr aktuelles Passwort.');
      return;
    }
    const submitButton = modalRoot.querySelector('button[form="addPasskeyForm"]');
    if (submitButton) submitButton.disabled = true;
    try {
      const optionsResult = await apiFetch('/api/security/passkeys/options', {
        method: 'POST',
        body: { password }
      });
      const registration = await window.SimpleWebAuthnBrowser.startRegistration({
        optionsJSON: optionsResult.options
      });
      await apiFetch('/api/security/passkeys/verify', {
        method: 'POST',
        body: { response: registration, name }
      });
      const state = await apiFetch('/api/state');
      applyServerState(state);
      closeModal(false);
      renderCurrentView();
      toast('Passkey hinzugefügt', 'Der Passkey kann ab sofort als zweiter Faktor verwendet werden.');
    } catch (error) {
      if (error?.name === 'NotAllowedError') {
        showFormError(form, 'Die Passkey-Einrichtung wurde abgebrochen.');
      } else {
        showFormError(form, error.message || 'Der Passkey konnte nicht hinzugefügt werden.');
      }
    } finally {
      if (submitButton) submitButton.disabled = false;
    }
  });
}

function openRenamePasskeyModal(passkeyId) {
  const passkey = (db.security?.passkeys || []).find((entry) => entry.id === passkeyId);
  if (!passkey) return;
  showModal({
    title: 'Passkey umbenennen',
    eyebrow: 'Sicherheit',
    subtitle: 'Der Name ist nur für Ihre Übersicht sichtbar.',
    size: 'modal-sm',
    body: `
      <form id="renamePasskeyForm" novalidate>
        ${formAlertMarkup()}
        <div class="field field-full">
          <label for="renamePasskeyName">Name</label>
          <input class="input" id="renamePasskeyName" name="name" type="text" maxlength="120" value="${esc(passkey.name || '')}" required data-autofocus>
        </div>
      </form>`,
    footer: `
      <button class="btn btn-ghost" type="button" data-close-modal>Abbrechen</button>
      <button class="btn btn-primary" type="submit" form="renamePasskeyForm">${icon('check')} Speichern</button>`
  });

  const form = $('#renamePasskeyForm');
  form?.addEventListener('submit', async (event) => {
    event.preventDefault();
    clearFormError(form);
    const name = String(new FormData(form).get('name') || '').trim();
    if (!name) {
      showFormError(form, 'Bitte geben Sie einen Namen an.');
      return;
    }
    const submitButton = modalRoot.querySelector('button[form="renamePasskeyForm"]');
    if (submitButton) submitButton.disabled = true;
    try {
      await apiFetch(`/api/security/passkeys/${encodeURIComponent(passkey.id)}`, {
        method: 'PATCH',
        body: { name }
      });
      const state = await apiFetch('/api/state');
      applyServerState(state);
      closeModal(false);
      renderCurrentView();
      toast('Passkey umbenannt', 'Der neue Name wurde gespeichert.');
    } catch (error) {
      showFormError(form, error.message);
    } finally {
      if (submitButton) submitButton.disabled = false;
    }
  });
}

function openDeletePasskeyConfirm(passkeyId) {
  const passkey = (db.security?.passkeys || []).find((entry) => entry.id === passkeyId);
  if (!passkey) return;
  openConfirm({
    title: 'Passkey entfernen?',
    text: `Der Passkey <strong>${esc(passkey.name || 'Passkey')}</strong> wird entfernt. Alle aktiven Sitzungen dieses Kontos werden beendet; Sie müssen sich neu anmelden. TOTP/Recovery bleiben als Fallback bestehen.`,
    confirmLabel: 'Passkey entfernen',
    danger: true,
    onConfirm: async () => {
      try {
        await apiFetch(`/api/security/passkeys/${encodeURIComponent(passkey.id)}`, { method: 'DELETE' });
        toast('Passkey entfernt', 'Bitte melden Sie sich neu an.');
        window.setTimeout(() => { window.location.href = '/login'; }, 400);
      } catch (error) {
        toast('Entfernen fehlgeschlagen', error.message, 'error');
      }
    }
  });
}

function openLocationModal(locationId = null) {
  const existing = locationId ? (db.locations || []).find((entry) => entry.id === locationId) : null;
  if (locationId && !existing) return;
  showModal({
    title: existing ? 'Standort bearbeiten' : 'Standort anlegen',
    eyebrow: 'Organisation',
    subtitle: 'Standorte steuern Sichtbarkeit und Freigaberouting.',
    size: 'modal-sm',
    body: `
      <form id="locationForm" novalidate>
        ${formAlertMarkup()}
        <div class="field field-full">
          <label for="locationName">Name</label>
          <input class="input" id="locationName" name="name" type="text" maxlength="120" value="${esc(existing?.name || '')}" required data-autofocus>
        </div>
        ${existing ? `<label class="check-row"><input type="checkbox" name="active" ${existing.active ? 'checked' : ''}> Standort aktiv</label>` : ''}
      </form>`,
    footer: `
      <button class="btn btn-ghost" type="button" data-close-modal>Abbrechen</button>
      <button class="btn btn-primary" type="submit" form="locationForm">${icon('check')} Speichern</button>`
  });
  const form = $('#locationForm');
  form?.addEventListener('submit', async (event) => {
    event.preventDefault();
    clearFormError(form);
    const data = new FormData(form);
    const name = String(data.get('name') || '').trim();
    if (!name) {
      showFormError(form, 'Bitte geben Sie einen Namen an.');
      return;
    }
    const submitButton = modalRoot.querySelector('button[form="locationForm"]');
    if (submitButton) submitButton.disabled = true;
    try {
      const state = await apiFetch(existing ? `/api/locations/${encodeURIComponent(existing.id)}` : '/api/locations', {
        method: existing ? 'PATCH' : 'POST',
        body: { name, ...(existing ? { active: data.get('active') === 'on' } : {}) }
      });
      applyServerState(state);
      closeModal(false);
      renderCurrentView();
      toast(existing ? 'Standort gespeichert' : 'Standort angelegt', 'Die Standortdaten wurden aktualisiert.');
    } catch (error) {
      showFormError(form, error.message);
    } finally {
      if (submitButton) submitButton.disabled = false;
    }
  });
}

function toggleLocationActive(locationId) {
  const location = (db.locations || []).find((entry) => entry.id === locationId);
  if (!location) return;
  openConfirm({
    title: location.active ? 'Standort deaktivieren?' : 'Standort aktivieren?',
    text: `<strong>${esc(location.name)}</strong> wird ${location.active ? 'deaktiviert' : 'aktiviert'}. Bestehende Zuordnungen bleiben erhalten.`,
    confirmLabel: location.active ? 'Deaktivieren' : 'Aktivieren',
    danger: location.active,
    onConfirm: async () => {
      try {
        const state = await apiFetch(`/api/locations/${encodeURIComponent(location.id)}`, {
          method: 'PATCH',
          body: { name: location.name, active: !location.active }
        });
        applyServerState(state);
        renderCurrentView();
        toast('Standort aktualisiert', 'Der Status wurde geändert.');
      } catch (error) {
        toast('Standort konnte nicht geändert werden', error.message, 'error');
      }
    }
  });
}

function deleteLocation(locationId) {
  const location = (db.locations || []).find((entry) => entry.id === locationId);
  if (!location) return;
  openConfirm({
    title: 'Standort löschen?',
    text: `<strong>${esc(location.name)}</strong> wird gelöscht. Das ist nur ohne zugeordnete Konten oder Fahrzeuge möglich.`,
    confirmLabel: 'Standort löschen',
    danger: true,
    onConfirm: async () => {
      try {
        const state = await apiFetch(`/api/locations/${encodeURIComponent(location.id)}`, { method: 'DELETE' });
        applyServerState(state);
        renderCurrentView();
        toast('Standort gelöscht', 'Der Standort wurde entfernt.');
      } catch (error) {
        toast('Löschen fehlgeschlagen', error.message, 'error');
      }
    }
  });
}

function openWebhookModal(webhookId = null) {
  const existing = webhookId
    ? (db.integrations?.webhooks || []).find((entry) => entry.id === webhookId)
    : null;
  if (webhookId && !existing) return;
  const webhook = existing || {
    name: '',
    format: 'generic',
    events: ['leasing', 'booking_request', 'maintenance'],
    enabled: true,
    secretSet: false,
    host: ''
  };
  const eventOptions = [
    ['leasing', 'Leasing'],
    ['booking_request', 'Buchungsanfragen'],
    ['maintenance', 'Wartung/TÜV']
  ];
  const formats = [
    ['generic', 'Generisch'],
    ['teams', 'Microsoft Teams (MessageCard)'],
    ['discord', 'Discord'],
    ['slack', 'Slack']
  ];
  showModal({
    title: existing ? 'Webhook bearbeiten' : 'Webhook hinzufügen',
    eyebrow: 'Integrationen',
    subtitle: 'URL und Secret werden verschlüsselt gespeichert.',
    body: `
      <form id="webhookForm" novalidate>
        ${formAlertMarkup()}
        <div class="form-grid">
          <div class="field field-full">
            <label for="webhookName">Name <span class="optional">*</span></label>
            <input class="input" id="webhookName" name="name" type="text" maxlength="120" value="${esc(webhook.name)}" required data-autofocus>
          </div>
          <div class="field field-full">
            <label for="webhookUrl">Webhook-URL ${existing ? '' : '<span class="optional">*</span>'}</label>
            <input class="input" id="webhookUrl" name="url" type="password" autocomplete="new-password"
              placeholder="${existing ? `•••••••• (${esc(webhook.host || 'gesetzt')})` : 'https://…'}">
            <p class="field-hint">${existing ? 'Leer lassen, um die gespeicherte URL beizubehalten.' : 'Nur http(s). Private/lokale Ziele sind blockiert, sofern nicht per Allowlist freigegeben.'}</p>
          </div>
          <div class="field">
            <label for="webhookFormat">Format</label>
            <select class="select" id="webhookFormat" name="format">
              ${formats.map(([value, label]) => `<option value="${value}" ${webhook.format === value ? 'selected' : ''}>${label}</option>`).join('')}
            </select>
          </div>
          <div class="field field-full">
            <label>Events</label>
            <div class="checkbox-grid">
              ${eventOptions.map(([value, label]) => `<label class="check-row"><input type="checkbox" name="events" value="${value}" ${webhook.events.includes(value) ? 'checked' : ''}> ${label}</label>`).join('')}
            </div>
          </div>
          <div class="field field-full">
            <label for="webhookSecret">HMAC-Secret (optional)</label>
            <input class="input" id="webhookSecret" name="secret" type="password" autocomplete="new-password"
              placeholder="${webhook.secretSet ? '•••••••• (gesetzt)' : 'Kein Secret'}">
            ${webhook.secretSet ? '<label class="check-row" style="margin-top:6px"><input type="checkbox" name="clearSecret"> Secret entfernen</label>' : ''}
            <p class="field-hint">Signiert Payloads mit <code>X-AWO-Signature: sha256=…</code> über Zeitstempel und Body.</p>
          </div>
          <div class="field field-full">
            <label class="check-row"><input type="checkbox" name="enabled" ${webhook.enabled ? 'checked' : ''}> Webhook aktiv</label>
          </div>
          <div class="info-banner field-full">${icon('shield')}<div><strong>SSRF-Schutz</strong><p>Loopback-, private, Link-Local- und Metadaten-Adressen werden blockiert. Interne Ziele nur explizit über <code>WEBHOOK_ALLOW_PRIVATE_HOSTS</code> freigeben.</p></div></div>
        </div>
      </form>`,
    footer: `
      <button class="btn btn-ghost" type="button" data-close-modal>Abbrechen</button>
      <button class="btn btn-primary" type="submit" form="webhookForm">${icon('check')} Speichern</button>`
  });
  const form = $('#webhookForm');
  form?.addEventListener('submit', async (event) => {
    event.preventDefault();
    clearFormError(form);
    const data = new FormData(form);
    const name = String(data.get('name') || '').trim();
    const url = String(data.get('url') || '').trim();
    const secret = String(data.get('secret') || '').trim();
    const events = data.getAll('events').map(String);
    if (!name) {
      showFormError(form, 'Bitte geben Sie einen Namen an.');
      return;
    }
    if (!existing && !url) {
      showFormError(form, 'Bitte geben Sie eine Webhook-URL an.');
      return;
    }
    if (!events.length) {
      showFormError(form, 'Bitte wählen Sie mindestens ein Event aus.');
      return;
    }
    const submitButton = modalRoot.querySelector('button[form="webhookForm"]');
    if (submitButton) submitButton.disabled = true;
    try {
      const payload = {
        name,
        format: String(data.get('format') || 'generic'),
        events,
        enabled: data.get('enabled') === 'on',
        ...(url ? { url } : {}),
        ...(secret ? { secret } : {}),
        ...(data.get('clearSecret') === 'on' ? { clearSecret: true } : {})
      };
      const state = await apiFetch(existing ? `/api/webhooks/${encodeURIComponent(existing.id)}` : '/api/webhooks', {
        method: existing ? 'PATCH' : 'POST',
        body: payload
      });
      applyServerState(state);
      closeModal(false);
      renderCurrentView();
      toast(existing ? 'Webhook gespeichert' : 'Webhook angelegt', 'Die Konfiguration wurde aktualisiert.');
    } catch (error) {
      showFormError(form, error.message);
    } finally {
      if (submitButton) submitButton.disabled = false;
    }
  });
}

function deleteWebhookConfirm(webhookId) {
  const webhook = (db.integrations?.webhooks || []).find((entry) => entry.id === webhookId);
  if (!webhook) return;
  openConfirm({
    title: 'Webhook löschen?',
    text: `<strong>${esc(webhook.name)}</strong> (${esc(webhook.host || 'ohne Host')}) wird dauerhaft entfernt. Bestehende Delivery-Einträge bleiben erhalten.`,
    confirmLabel: 'Webhook löschen',
    danger: true,
    onConfirm: async () => {
      try {
        const state = await apiFetch(`/api/webhooks/${encodeURIComponent(webhook.id)}`, { method: 'DELETE' });
        applyServerState(state);
        renderCurrentView();
        toast('Webhook gelöscht', 'Der Endpunkt wurde entfernt.');
      } catch (error) {
        toast('Löschen fehlgeschlagen', error.message, 'error');
      }
    }
  });
}

function webhookTestErrorLabel(code) {
  if (code === 'WEBHOOK_BLOCKED') return 'Ziel blockiert (SSRF/Allowlist).';
  if (code === 'WEBHOOK_TIMEOUT') return 'Zeitüberschreitung nach 8 Sekunden.';
  if (code === 'WEBHOOK_ERROR') return 'Endpunkt nicht erreichbar.';
  if (code?.startsWith('WEBHOOK_HTTP_')) return `Endpunkt antwortete mit HTTP ${code.slice('WEBHOOK_HTTP_'.length)}.`;
  return code || 'Unbekannter Fehler.';
}

async function testWebhookById(webhookId) {
  const webhook = (db.integrations?.webhooks || []).find((entry) => entry.id === webhookId);
  if (!webhook) return;
  try {
    const result = await apiFetch(`/api/webhooks/${encodeURIComponent(webhook.id)}/test`, { method: 'POST' });
    if (result.ok) toast('Webhook-Test erfolgreich', `${webhook.name} hat die Testnachricht angenommen.`);
    else toast('Webhook-Test fehlgeschlagen', webhookTestErrorLabel(result.errorCode), 'error');
  } catch (error) {
    toast('Webhook-Test fehlgeschlagen', error.message, 'error');
  }
}

/* =========================================================
   Benutzerverwaltung
   ========================================================= */
function openAnonymizeUserConfirm(userId) {
  if (!can('users_manage')) {
    toast('Keine Berechtigung', 'Für das Anonymisieren fehlt die Berechtigung „Benutzer verwalten“.', 'error');
    return;
  }
  const user = db.users?.find((entry) => entry.id === userId);
  if (!user) return;
  if (!canManageUser(user)) {
    toast('Nicht bearbeitbar', 'Dieses Konto liegt nicht in Ihrem verwaltbaren Rangbereich.', 'error');
    return;
  }
  if (user.active) {
    toast('Konto ist aktiv', 'Ein Konto muss zuerst deaktiviert werden.', 'info');
    return;
  }
  if (user.anonymizedAt) {
    toast('Bereits anonymisiert', 'Dieses Konto ist bereits anonymisiert.', 'info');
    return;
  }
  openConfirm({
    title: 'Benutzerkonto anonymisieren?',
    text: `<strong>${esc(user.name)}</strong> (${esc(user.email)}) wird dauerhaft anonymisiert. Name, E-Mail-Adresse und Passwort werden entfernt; alle aktiven Sitzungen werden beendet. Verknüpfte Buchungen, Kosten und Audit-Einträge bleiben erhalten. Das Konto bleibt deaktiviert und kann nicht reaktiviert werden.`,
    confirmLabel: 'Endgültig anonymisieren',
    danger: true,
    onConfirm: async () => {
      try {
        const state = await apiFetch(`/api/users/${encodeURIComponent(user.id)}/anonymize`, { method: 'POST' });
        applyServerState(state);
        renderCurrentView();
        toast('Konto anonymisiert', 'Die persönlichen Kontodaten wurden entfernt.');
      } catch (error) {
        toast('Anonymisierung fehlgeschlagen', error.message, 'error');
      }
    }
  });
}

function openCompanyModal(companyId = null) {
  if (!can('settings_manage')) {
    toast('Keine Berechtigung', 'Gesellschaften sind Administrator:innen vorbehalten.', 'error');
    return;
  }
  const existing = companyId ? (db.companies || []).find((entry) => entry.id === companyId) : null;
  const company = existing || { code: '', name: '', active: true };
  showModal({
    title: existing ? 'Gesellschaft bearbeiten' : 'Gesellschaft anlegen',
    eyebrow: 'Gesellschaften',
    subtitle: 'Kostenstellencodes werden je Gesellschaft eindeutig geprüft.',
    size: 'modal-sm',
    body: `
      <form id="companyForm" novalidate autocomplete="off">
        ${formAlertMarkup()}
        <div class="form-grid">
          <div class="field field-full">
            <label for="companyCode">Code <span class="optional">*</span></label>
            <input class="input" id="companyCode" name="code" type="text" value="${esc(company.code)}" placeholder="z. B. AWO-HB" maxlength="40" required data-autofocus>
            <p class="field-hint">Großschreibung, Leerzeichen werden zu Bindestrichen.</p>
          </div>
          <div class="field field-full">
            <label for="companyName">Name <span class="optional">*</span></label>
            <input class="input" id="companyName" name="name" type="text" value="${esc(company.name)}" placeholder="z. B. AWO Bremerhaven" maxlength="160" required>
          </div>
          <div class="field field-full">
            <label class="check-row"><input type="checkbox" name="active" ${company.active ? 'checked' : ''}> Gesellschaft aktiv</label>
            <p class="field-hint">Inaktive Gesellschaften bleiben sichtbar; neue Kostenstellen können ihnen nicht zugeordnet werden.</p>
          </div>
        </div>
      </form>`,
    footer: `
      <button class="btn btn-ghost" type="button" data-close-modal>Abbrechen</button>
      <button class="btn btn-primary" type="submit" form="companyForm">${icon('check')} Speichern</button>`
  });
  const form = $('#companyForm');
  form?.addEventListener('submit', async (event) => {
    event.preventDefault();
    clearFormError(form);
    const data = new FormData(form);
    const code = String(data.get('code') || '').trim();
    const name = String(data.get('name') || '').trim();
    if (!code || !name) {
      showFormError(form, 'Bitte geben Sie Code und Name an.');
      return;
    }
    const submitButton = modalRoot.querySelector('button[form="companyForm"]');
    if (submitButton) submitButton.disabled = true;
    try {
      const state = await apiFetch(existing ? `/api/companies/${encodeURIComponent(existing.id)}` : '/api/companies', {
        method: existing ? 'PATCH' : 'POST',
        body: { code, name, active: data.get('active') === 'on' }
      });
      applyServerState(state);
      closeModal(false);
      renderCurrentView();
      toast(existing ? 'Gesellschaft gespeichert' : 'Gesellschaft angelegt', `${name} wurde gespeichert.`);
    } catch (error) {
      showFormError(form, error.message);
    } finally {
      if (submitButton) submitButton.disabled = false;
    }
  });
}

function toggleCompanyActive(companyId) {
  const company = (db.companies || []).find((entry) => entry.id === companyId);
  if (!company) return;
  const nextActive = !company.active;
  openConfirm({
    title: nextActive ? 'Gesellschaft aktivieren?' : 'Gesellschaft deaktivieren?',
    text: nextActive
      ? `<strong>${esc(company.code)} · ${esc(company.name)}</strong> kann danach wieder für neue Kostenstellen genutzt werden.`
      : `<strong>${esc(company.code)} · ${esc(company.name)}</strong> bleibt sichtbar, kann aber nicht mehr für neue Kostenstellen gewählt werden. Bestehende Kostenstellen bleiben unverändert.`,
    confirmLabel: nextActive ? 'Aktivieren' : 'Deaktivieren',
    danger: !nextActive,
    onConfirm: async () => {
      try {
        const state = await apiFetch(`/api/companies/${encodeURIComponent(company.id)}`, {
          method: 'PATCH',
          body: { code: company.code, name: company.name, active: nextActive }
        });
        applyServerState(state);
        renderCurrentView();
        toast(nextActive ? 'Gesellschaft aktiviert' : 'Gesellschaft deaktiviert', `${company.code} wurde aktualisiert.`);
      } catch (error) {
        toast('Gesellschaft konnte nicht aktualisiert werden', error.message, 'error');
      }
    }
  });
}

function deleteCompany(companyId) {
  const company = (db.companies || []).find((entry) => entry.id === companyId);
  if (!company) return;
  if (Number(company.costCenterCount) > 0) {
    toast('Gesellschaft wird verwendet', 'Löschen ist nur ohne Kostenstellen möglich. Deaktivieren Sie die Gesellschaft stattdessen.', 'error');
    return;
  }
  openConfirm({
    title: 'Gesellschaft löschen?',
    text: `<strong>${esc(company.code)} · ${esc(company.name)}</strong> wird dauerhaft entfernt.`,
    confirmLabel: 'Gesellschaft löschen',
    danger: true,
    onConfirm: async () => {
      try {
        const state = await apiFetch(`/api/companies/${encodeURIComponent(company.id)}`, { method: 'DELETE' });
        applyServerState(state);
        renderCurrentView();
        toast('Gesellschaft gelöscht', `${company.code} wurde entfernt.`);
      } catch (error) {
        toast('Löschen fehlgeschlagen', error.message, 'error');
      }
    }
  });
}

function openUserModal(userId = null) {
  if (!can('users_manage')) {
    toast('Keine Berechtigung', 'Für die Benutzerverwaltung fehlt die Berechtigung „Benutzer verwalten“.', 'error');
    return;
  }
  const existing = userId ? db.users.find((user) => user.id === userId) : null;
  if (existing?.anonymizedAt) {
    toast('Konto anonymisiert', 'Anonymisierte Konten können nicht mehr bearbeitet werden.', 'info');
    return;
  }
  if (existing && !canManageUser(existing)) {
    toast('Nicht bearbeitbar', 'Dieses Konto liegt nicht in Ihrem verwaltbaren Rangbereich.', 'error');
    return;
  }
  const actorRank = Number(currentUser?.roleRank || 0);
  const roles = (db.roles || []).filter((role) =>
    role.id !== 'superadmin'
    && (role.id !== 'admin' || capabilities.isSuperadmin)
    && Number(role.rank) < actorRank
    && roleWithinGrant(role)
  );
  if (!roles.length) {
    toast('Keine vergebbare Rolle', 'Es existiert keine Rolle unterhalb Ihres Rangs, die Sie vergeben dürfen.', 'error');
    return;
  }
  const defaultRole = existing?.role && roles.some((role) => role.id === existing.role)
    ? existing.role
    : roles.find((role) => role.id === 'manager')?.id || roles[0].id;
  const user = existing || { name: '', email: '', role: defaultRole, active: true, driverId: null, ownTripsAccess: true, costCenterId: null };
  const canSelectCostCenter = can('cost_centers_view');
  const roleLocked = existing?.role === 'admin' && !capabilities.isSuperadmin;
  const roleHint = roleLocked
    ? 'Administratorkonten behalten die Administrator-Rolle; eine Herabstufung ist nicht möglich.'
    : existing?.role === 'admin'
      ? 'Als Superadmin können Sie die Administrator-Rolle entziehen. Mindestens ein aktives Administratorkonto muss bestehen bleiben.'
      : 'Nur Rollen unterhalb Ihres Rangs und innerhalb Ihres Grant Ceilings sind auswählbar. Die Superadmin-Rolle ist nicht vergebbar.';
  const roleOptions = roles.map((role) => `<option value="${esc(role.id)}" ${user.role === role.id ? 'selected' : ''}>${esc(role.name)} · Rang ${formatNumber(role.rank)}</option>`).join('');
  const driverOptions = [`<option value="">Keine Verknüpfung</option>`]
    .concat((db.driversForLinking || []).map((driver) => {
      const linkedElsewhere = driver.linkedUserId && driver.linkedUserId !== user.id;
      return `<option value="${esc(driver.id)}" ${driver.id === user.driverId ? 'selected' : ''} ${linkedElsewhere ? 'disabled' : ''}>${esc(driver.name)} · ${esc(driver.role || 'Fahrer:in')}${linkedElsewhere ? ' · bereits verknüpft' : ''}</option>`;
    })).join('');
  const ownTripsChecked = user.ownTripsAccess !== false;
  showModal({
    title: existing ? 'Benutzer bearbeiten' : 'Benutzer anlegen',
    eyebrow: 'Zugänge',
    subtitle: existing ? `${user.name} · ${user.email}${user.driverName ? ` · ${user.driverName}` : ''}` : 'Neuen Zugang für die Fuhrparkverwaltung erstellen.',
    body: `
      <form id="userForm" novalidate autocomplete="off">
        ${formAlertMarkup()}
        <div class="form-grid">
          <div class="field">
            <label for="accountName">Name <span class="optional">*</span></label>
            <input class="input" id="accountName" name="name" type="text" value="${esc(user.name)}" required maxlength="120">
          </div>
          <div class="field">
            <label for="accountEmail">E-Mail-Adresse <span class="optional">*</span></label>
            <input class="input" id="accountEmail" name="email" type="email" value="${esc(user.email)}" required maxlength="200">
          </div>
          <div class="field">
            <label for="accountRole">Rolle</label>
            <select class="select" id="accountRole" name="role" ${roleLocked ? 'disabled' : ''}>${roleOptions}</select>
            <p class="field-hint">${roleHint}</p>
          </div>
          ${canSelectCostCenter ? `<div class="field">
            <label for="accountCostCenter">Kostenstelle</label>
            <select class="select" id="accountCostCenter" name="costCenterId">${costCenterOptionsMarkup(user.costCenterId)}</select>
            <p class="field-hint">Default für Buchungen, wenn weder Fahrer:in noch Fahrzeug eine Kostenstelle haben.</p>
          </div>` : ''}
          ${db.features?.locationsEnabled ? `<div class="field">
            <label for="accountLocation">Standort</label>
            <select class="select" id="accountLocation" name="locationId">${locationOptionsMarkup(user.locationId)}</select>
            <p class="field-hint">Nicht-Administrator:innen sehen bei aktivierter Standortfunktion nur Daten dieses Standorts.</p>
          </div>` : ''}
          <div class="field">
            <label for="accountPassword">${existing ? 'Neues Passwort' : 'Passwort'} ${existing ? '<span class="optional">optional</span>' : '<span class="optional">*</span>'}</label>
            <input class="input" id="accountPassword" name="password" type="password" autocomplete="new-password" minlength="10" placeholder="${existing ? 'Leer lassen, um nichts zu ändern' : 'Mindestens 10 Zeichen'}">
          </div>
          <div class="field field-full">
            <label for="accountDriver">Fahrer:in verknüpfen <span class="optional">optional</span></label>
            <select class="select" id="accountDriver" name="driverId">${driverOptions}</select>
            <p class="field-hint">Ein Fahrerprofil kann höchstens einem Benutzerkonto zugeordnet werden. Die Verknüpfung bleibt bei einer Deaktivierung bestehen.</p>
          </div>
          <div class="field field-full">
            <label class="check-row"><input type="checkbox" id="accountOwnTripsAccess" name="ownTripsAccess" ${ownTripsChecked ? 'checked' : ''}> Standardzugriff auf „Meine Fahrten“ aktiv</label>
            <p class="field-hint">Gilt nur für verknüpfte Fahrer:innen. Explizite Benutzer- oder Rollenregeln können den Standard übersteuern oder wieder erlauben.</p>
          </div>
          ${existing ? `<div class="field field-full"><label class="check-row"><input type="checkbox" name="active" ${user.active ? 'checked' : ''}> Konto aktiv</label></div>` : ''}
        </div>
      </form>`,
    footer: `
      <button class="btn btn-ghost" type="button" data-close-modal>Abbrechen</button>
      <button class="btn btn-primary" type="submit" form="userForm">${icon('check')} ${existing ? 'Änderungen speichern' : 'Benutzer anlegen'}</button>`
  });

  const form = $('#userForm');
  const driverSelect = $('#accountDriver');
  const ownTripsCheckbox = $('#accountOwnTripsAccess');
  const updateOwnTripsState = () => {
    if (!ownTripsCheckbox) return;
    ownTripsCheckbox.disabled = !driverSelect?.value;
    if (!driverSelect?.value) ownTripsCheckbox.checked = false;
    else if (!existing && driverSelect.value) ownTripsCheckbox.checked = true;
  };
  driverSelect?.addEventListener('change', updateOwnTripsState);
  updateOwnTripsState();
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    clearFormError(form);
    const data = new FormData(form);
    const name = String(data.get('name') || '').trim();
    const email = String(data.get('email') || '').trim();
    const password = String(data.get('password') || '');
    if (!name || !email) {
      showFormError(form, 'Bitte geben Sie Name und E-Mail-Adresse an.');
      return;
    }
    if (!existing && password.length < 10) {
      showFormError(form, 'Das Passwort muss mindestens 10 Zeichen lang sein.');
      return;
    }
    const driverId = String(data.get('driverId') || '');
    const body = {
      name,
      email,
      role: String(data.get('role') || defaultRole),
      active: existing ? data.get('active') === 'on' : true,
      driverId: driverId || null,
      ownTripsAccess: Boolean(driverId) && data.get('ownTripsAccess') === 'on',
      ...(data.has('costCenterId') ? { costCenterId: String(data.get('costCenterId') || '') || null } : {}),
      ...(data.has('locationId') ? { locationId: String(data.get('locationId') || '') || null } : {})
    };
    if (password) body.password = password;
    const submitButton = modalRoot.querySelector('button[form="userForm"]');
    if (submitButton) submitButton.disabled = true;
    try {
      const state = await apiFetch(existing ? `/api/users/${encodeURIComponent(existing.id)}` : '/api/users', {
        method: existing ? 'PATCH' : 'POST',
        body
      });
      await refreshSession();
      applyServerState(state);
      closeModal(false);
      if (ui.route === 'benutzer' && !can('users_manage')) {
        location.hash = '#/dashboard';
      } else {
        renderCurrentView();
      }
      toast(existing ? 'Benutzer aktualisiert' : 'Benutzer angelegt', `${name} wurde gespeichert.`);
    } catch (error) {
      showFormError(form, error.message);
    } finally {
      if (submitButton) submitButton.disabled = false;
    }
  });
}

/* =========================================================
   Benutzer-Ausnahmen
   ========================================================= */
function openUserPermissionModal(userId) {
  if (!can('users_manage')) {
    toast('Keine Berechtigung', 'Für Benutzer-Ausnahmen fehlt die Berechtigung „Benutzer verwalten“.', 'error');
    return;
  }
  const user = db.users?.find((entry) => entry.id === userId);
  if (!user) {
    toast('Benutzer nicht gefunden', 'Der Zugang ist nicht mehr verfügbar.', 'error');
    return;
  }
  if (user.anonymizedAt) {
    toast('Konto anonymisiert', 'Anonymisierte Konten können nicht mehr bearbeitet werden.', 'info');
    return;
  }
  if (!canManageUser(user)) {
    toast('Nicht bearbeitbar', 'Dieses Konto liegt nicht in Ihrem verwaltbaren Rangbereich.', 'error');
    return;
  }
  if (user.role === 'admin') {
    toast('Geschützter Zugang', 'Die Administrator-Rolle hat immer vollständigen Zugriff.', 'info');
    return;
  }
  const role = db.roles?.find((entry) => entry.id === user.role);
  const overrides = user.permissionOverrides || { allow: [], deny: [] };
  const currentGlobal = {
    allow: new Set(overrides.allow || []),
    deny: new Set(overrides.deny || [])
  };
  const currentRules = user.objectPermissions || {};
  const permissionLabels = new Map(permissionGroups.flatMap((group) => group.permissions.map((permission) => [permission.key, `${group.label} · ${permission.label}`])));
  const dataByKey = {
    vehicles: db.vehicles,
    drivers: db.drivers,
    bookings: db.bookings,
    costs: db.costs,
    maintenance: db.maintenance
  };

  const objectLabel = (typeKey, item) => {
    if (typeKey === 'vehicle') return `${item.name} · ${item.plate}`;
    if (typeKey === 'driver') return `${item.name} · ${item.role || 'Fahrer:in'}`;
    if (typeKey === 'booking') {
      const vehicle = getVehicle(item.vehicleId);
      return `${item.purpose} · ${formatDate(item.start)}${vehicle ? ` · ${vehicle.name}` : ''}`;
    }
    if (typeKey === 'cost') {
      const vehicle = getVehicle(item.vehicleId);
      return `${item.category} · ${formatDate(item.date)}${vehicle ? ` · ${vehicle.name}` : ''} · ${formatMoney(item.amount, 2)}`;
    }
    const vehicle = getVehicle(item.vehicleId);
    return `${item.title} · ${formatDate(item.dueDate)}${vehicle ? ` · ${vehicle.name}` : ''}`;
  };

  const globalSections = permissionGroups.map((group) => `
    <fieldset class="permission-group">
      <legend>${esc(group.label)}</legend>
      ${group.permissions.map((permission) => {
        const value = currentGlobal.allow.has(permission.key) ? 'allow' : currentGlobal.deny.has(permission.key) ? 'deny' : 'standard';
        const grantable = privileged() || permissions.has(permission.key);
        return `<label class="object-permission">
          <span>${esc(permission.label)}</span>
          <select class="select select-sm" data-user-permission="${permission.key}" ${grantable ? '' : 'disabled title="Recht der eigenen Rolle nicht vorhanden"'}>
            <option value="standard" ${value === 'standard' ? 'selected' : ''}>Standard</option>
            <option value="allow" ${value === 'allow' ? 'selected' : ''}>Erlauben</option>
            <option value="deny" ${value === 'deny' ? 'selected' : ''}>Verweigern</option>
          </select>
        </label>`;
      }).join('')}
    </fieldset>`).join('');

  const objectSections = objectTypes.map((type, index) => {
    const items = dataByKey[type.dataKey] || [];
    const typeRules = currentRules[type.key] || {};
    const overrideCount = Object.keys(typeRules).length;
    const rules = items.map((item) => {
      const rule = typeRules[item.id] || { allow: [], deny: [] };
      const count = rule.allow.length + rule.deny.length;
      return `
        <details class="object-rule" ${count ? 'open' : ''}>
          <summary>
            <span class="object-rule-title">${esc(objectLabel(type.key, item))}</span>
            <span class="badge badge-${count ? 'violet' : 'gray'} no-dot">${count ? `${count} Ausnahmen` : 'Standard'}</span>
          </summary>
          <div class="object-rule-body">
            <div class="object-rule-grid">
              ${type.permissions.map((permission) => {
                const value = rule.allow.includes(permission) ? 'allow' : rule.deny.includes(permission) ? 'deny' : 'standard';
                const grantable = privileged() || permissions.has(permission);
                return `<label class="object-permission">
                  <span>${esc(permissionLabels.get(permission) || permission)}</span>
                  <select class="select select-sm" data-user-object-type="${type.key}" data-user-object-id="${item.id}" data-user-permission-key="${permission}" ${grantable ? '' : 'disabled title="Recht der eigenen Rolle nicht vorhanden"'}>
                    <option value="standard" ${value === 'standard' ? 'selected' : ''}>Standard</option>
                    <option value="allow" ${value === 'allow' ? 'selected' : ''}>Erlauben</option>
                    <option value="deny" ${value === 'deny' ? 'selected' : ''}>Verweigern</option>
                  </select>
                </label>`;
              }).join('')}
            </div>
            <button class="btn-link" type="button" data-user-reset-object="${type.key}:${item.id}">Auf Standard zurücksetzen</button>
          </div>
        </details>`;
    }).join('');
    return `
      <details class="object-type" ${index === 0 ? 'open' : ''}>
        <summary>
          <span><strong>${esc(type.label)}</strong><em>${items.length} Objekte</em></span>
          <span class="badge badge-${overrideCount ? 'violet' : 'gray'} no-dot">${overrideCount ? `${overrideCount} Objekte mit Ausnahmen` : 'Keine Ausnahmen'}</span>
        </summary>
        <div class="object-type-body">
          ${items.length ? rules : emptyState('filter', 'Keine Objekte vorhanden', `Für ${esc(type.label)} sind noch keine Einträge vorhanden.`, '', true)}
        </div>
      </details>`;
  }).join('');

  showModal({
    title: 'Benutzer-Ausnahmen',
    eyebrow: user.name,
    subtitle: `Persönliche Rechte für ${role ? role.name : user.role}`,
    size: 'modal-xl',
    body: `
      <form id="userPermissionForm" novalidate>
        ${formAlertMarkup()}
        <div class="info-banner">
          ${icon('shield')}
          <div><strong>Persönliche Regel hat Vorrang</strong><p>Benutzer-Ausnahmen überschreiben die Rollenrechte und die Objekt-Ausnahmen der Rolle. Innerhalb der persönlichen Regeln gilt: Objekt vor global, Erlauben/Verweigern vor Standard. Bei Konflikten gewinnt die Verweigerung. Ausgegraute Rechte gehören nicht zum Grant Ceiling Ihrer eigenen Rolle.</p></div>
        </div>
        <div class="detail-section">
          <p class="detail-section-title">Modul-Ausnahmen</p>
          <p class="field-hint">„Standard“ übernimmt das Recht der Rolle „${esc(role ? role.name : user.role)}“. „Erlauben“ und „Verweigern“ gelten unabhängig davon.</p>
          <div class="permission-grid">${globalSections}</div>
        </div>
        <div class="detail-section">
          <p class="detail-section-title">Objekt-Ausnahmen</p>
          <p class="field-hint">Feinsteuerung pro Fahrzeug, Fahrer:in, Buchung, Kostenposition und Wartung.</p>
          <div class="object-type-list">${objectSections}</div>
        </div>
      </form>`,
    footer: `
      <button class="btn btn-ghost" type="button" data-close-modal>Abbrechen</button>
      <button class="btn btn-primary" type="submit" form="userPermissionForm">${icon('check')} Benutzer-Ausnahmen speichern</button>`
  });

  const form = $('#userPermissionForm');
  form.querySelectorAll('[data-user-reset-object]').forEach((button) => {
    button.addEventListener('click', () => {
      const [type, id] = String(button.dataset.userResetObject || '').split(':');
      form.querySelectorAll(`select[data-user-object-type="${CSS.escape(type)}"][data-user-object-id="${CSS.escape(id)}"]`).forEach((select) => {
        select.value = 'standard';
      });
      const details = button.closest('.object-rule');
      const badge = details?.querySelector('summary .badge');
      if (badge) {
        badge.textContent = 'Standard';
        badge.className = 'badge badge-gray no-dot';
      }
    });
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    clearFormError(form);
    const permissionOverrides = { allow: [], deny: [] };
    form.querySelectorAll('select[data-user-permission]').forEach((select) => {
      if (select.value === 'allow') permissionOverrides.allow.push(select.dataset.userPermission);
      if (select.value === 'deny') permissionOverrides.deny.push(select.dataset.userPermission);
    });
    const objectPermissions = {};
    form.querySelectorAll('select[data-user-object-type][data-user-object-id][data-user-permission-key]').forEach((select) => {
      if (!['allow', 'deny'].includes(select.value)) return;
      const type = select.dataset.userObjectType;
      const id = select.dataset.userObjectId;
      const permission = select.dataset.userPermissionKey;
      objectPermissions[type] ||= {};
      objectPermissions[type][id] ||= { allow: [], deny: [] };
      objectPermissions[type][id][select.value].push(permission);
    });
    const submitButton = modalRoot.querySelector('button[form="userPermissionForm"]');
    if (submitButton) submitButton.disabled = true;
    try {
      const state = await apiFetch(`/api/users/${encodeURIComponent(user.id)}/permissions`, {
        method: 'PATCH',
        body: { permissionOverrides, objectPermissions }
      });
      applyServerState(state);
      closeModal(false);
      renderCurrentView();
      toast('Benutzer-Ausnahmen gespeichert', `${user.name} wurde aktualisiert.`);
    } catch (error) {
      showFormError(form, error.message);
    } finally {
      if (submitButton) submitButton.disabled = false;
    }
  });
}

/* =========================================================
   Rollen & Rechte
   ========================================================= */
function openRoleModal(roleId = null) {
  if (!can('roles_manage')) {
    toast('Keine Berechtigung', 'Für die Rollenverwaltung fehlt die Berechtigung „Rollen verwalten“.', 'error');
    return;
  }
  const existing = roleId ? db.roles?.find((role) => role.id === roleId) : null;
  if (roleId && !existing) {
    toast('Rolle nicht gefunden', 'Die Rolle ist nicht mehr verfügbar.', 'error');
    return;
  }
  if (existing?.id === 'admin') {
    toast('Geschützte Rolle', 'Die Administrator-Rolle kann nicht bearbeitet werden.', 'info');
    return;
  }
  if (existing?.id === 'superadmin') {
    toast('Geschützte Rolle', 'Die Superadmin-Rolle ist systemgeschützt und wird ausschließlich über die Superadmin-Datei verwaltet.', 'info');
    return;
  }
  if (existing && !canManageRole(existing)) {
    toast('Nicht bearbeitbar', 'Diese Rolle liegt nicht in Ihrem verwaltbaren Rangbereich oder enthält Rechte außerhalb Ihres Grant Ceilings.', 'error');
    return;
  }
  if (!permissionGroups.length) {
    toast('Berechtigungen nicht geladen', 'Bitte laden Sie die Seite neu.', 'error');
    return;
  }

  const maxRank = Number(currentUser?.roleRank || 0) - 1;
  if (maxRank < 1) {
    toast('Kein Rang verfügbar', 'Unterhalb Ihres Rangs ist kein bearbeitbarer Rollenrang verfügbar.', 'info');
    return;
  }
  const role = existing || { name: '', permissions: [], rank: Math.max(1, Math.min(899999, maxRank)), bookingRequestPolicy: { allow: [], deny: [] } };
  const currentPermissions = new Set(role.permissions || []);
  const policy = role.bookingRequestPolicy || { allow: [], deny: [] };
  const policyRoles = (db.roles || [])
    .filter((entry) => entry.id !== 'admin' && entry.id !== 'superadmin' && Number(entry.rank) < Number(currentUser?.roleRank || 0))
    .sort((a, b) => Number(b.rank) - Number(a.rank) || String(a.name).localeCompare(String(b.name), 'de'));
  const policyRoleOptions = (selected, name) => policyRoles.map((entry) => `
    <label class="permission-option">
      <input type="checkbox" name="${name}" value="${esc(entry.id)}" ${selected.includes(entry.id) ? 'checked' : ''}>
      <span>${esc(entry.name)} · Rang ${formatNumber(entry.rank)}</span>
    </label>`).join('');
  const policyMarkup = policyRoles.length
    ? `<div class="form-grid">
        <div class="field">
          <label>Erlauben</label>
          <div class="permission-grid">${policyRoleOptions(policy.allow || [], 'policyAllow')}</div>
          <p class="field-hint">Leere Allow-Liste bedeutet: alle zulässigen unteren Rollen dürfen Anfragen stellen.</p>
        </div>
        <div class="field">
          <label>Verweigern</label>
          <div class="permission-grid">${policyRoleOptions(policy.deny || [], 'policyDeny')}</div>
          <p class="field-hint">Verweigern gewinnt immer – auch wenn dieselbe Rolle zusätzlich erlaubt ist.</p>
        </div>
      </div>`
    : `<div class="info-banner">${icon('info')}<div><strong>Keine unteren Rollen verfügbar</strong><p>Die Policy kann erst gepflegt werden, wenn Rollen unterhalb Ihres eigenen Rangs existieren.</p></div></div>`;
  const permissionMarkup = permissionGroups.map((group) => `
    <fieldset class="permission-group">
      <legend>${esc(group.label)}</legend>
      ${group.permissions.map((permission) => {
        const grantable = privileged() || permissions.has(permission.key);
        return `
        <label class="permission-option">
          <input type="checkbox" name="permissions" value="${esc(permission.key)}" ${currentPermissions.has(permission.key) ? 'checked' : ''} ${grantable ? '' : 'disabled title="Recht der eigenen Rolle nicht vorhanden"'}>
          <span>${esc(permission.label)}</span>
        </label>`;
      }).join('')}
    </fieldset>`).join('');

  showModal({
    title: existing ? 'Rolle bearbeiten' : 'Neue Rolle',
    eyebrow: 'Rollen & Rechte',
    subtitle: existing ? role.name : 'Eigene Rolle mit individuellen Berechtigungen anlegen.',
    size: 'modal-lg',
    body: `
      <form id="roleForm" novalidate autocomplete="off">
        ${formAlertMarkup()}
        <div class="form-grid">
          <div class="field field-full">
            <label for="roleName">Rollenname <span class="optional">*</span></label>
            <input class="input" id="roleName" name="name" type="text" value="${esc(role.name)}" required maxlength="120" placeholder="z. B. Buchungsteam">
          </div>
          <div class="field">
            <label for="roleRank">Rang <span class="optional">*</span></label>
            <input class="input" id="roleRank" name="rank" type="number" min="1" max="${maxRank}" step="1" value="${esc(String(role.rank ?? 1))}" required>
            <p class="field-hint">Muss unterhalb Ihres eigenen Rangs (${formatNumber(currentUser?.roleRank || 0)}) liegen. Höher = mehr Rechte.</p>
          </div>
        </div>
        <div class="detail-section">
          <p class="detail-section-title">Berechtigungen</p>
          <div class="permission-grid">${permissionMarkup}</div>
          <div class="info-banner" style="margin-top:14px">
            ${icon('shield')}
            <div><strong>Ansichtsrechte werden mitgedacht</strong><p>Verwaltungsrechte ergänzen automatisch die notwendigen Ansichtsrechte. Die Administrator-Rolle bleibt immer vollständig und geschützt.</p></div>
          </div>
        </div>
        <div class="detail-section">
          <p class="detail-section-title">Buchungsanfragen-Policy</p>
          <p class="field-hint">Gilt für Personen mit „Buchungsanfragen verwalten“. Nur Rollen strikt unterhalb Ihres Rangs sind zulässig; die eigene Rolle und höhere Ränge bleiben ausgeschlossen.</p>
          ${policyMarkup}
        </div>
      </form>`,
    footer: `
      <button class="btn btn-ghost" type="button" data-close-modal>Abbrechen</button>
      <button class="btn btn-primary" type="submit" form="roleForm">${icon('check')} ${existing ? 'Änderungen speichern' : 'Rolle anlegen'}</button>`
  });

  const form = $('#roleForm');
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    clearFormError(form);
    const data = new FormData(form);
    const name = String(data.get('name') || '').trim();
    const rank = Number(data.get('rank'));
    const selectedPermissions = data.getAll('permissions').map(String);
    const bookingRequestPolicy = {
      allow: data.getAll('policyAllow').map(String),
      deny: data.getAll('policyDeny').map(String)
    };
    if (!name) {
      showFormError(form, 'Bitte geben Sie einen Rollennamen an.');
      return;
    }
    if (!Number.isInteger(rank) || rank < 1 || rank > maxRank) {
      showFormError(form, `Der Rang muss eine ganze Zahl zwischen 1 und ${maxRank} sein.`);
      return;
    }
    const submitButton = modalRoot.querySelector('button[form="roleForm"]');
    if (submitButton) submitButton.disabled = true;
    try {
      const state = await apiFetch(existing ? `/api/roles/${encodeURIComponent(existing.id)}` : '/api/roles', {
        method: existing ? 'PATCH' : 'POST',
        body: { name, permissions: selectedPermissions, rank, bookingRequestPolicy }
      });
      applyServerState(state);
      closeModal(false);
      renderCurrentView();
      toast(existing ? 'Rolle aktualisiert' : 'Rolle angelegt', `${name} wurde gespeichert.`);
    } catch (error) {
      showFormError(form, error.message);
    } finally {
      if (submitButton) submitButton.disabled = false;
    }
  });
}

function openRoleObjectModal(roleId) {
  if (!can('roles_manage')) {
    toast('Keine Berechtigung', 'Für Objekt-Ausnahmen fehlt die Berechtigung „Rollen verwalten“.', 'error');
    return;
  }
  const role = db.roles?.find((entry) => entry.id === roleId);
  if (!role) {
    toast('Rolle nicht gefunden', 'Die Rolle ist nicht mehr verfügbar.', 'error');
    return;
  }
  if (role.id === 'admin') {
    toast('Geschützte Rolle', 'Die Administrator-Rolle kann nicht bearbeitet werden.', 'info');
    return;
  }
  if (role.id === 'superadmin') {
    toast('Geschützte Rolle', 'Die Superadmin-Rolle ist systemgeschützt und wird ausschließlich über die Superadmin-Datei verwaltet.', 'info');
    return;
  }
  if (!canManageRole(role)) {
    toast('Nicht bearbeitbar', 'Diese Rolle liegt nicht in Ihrem verwaltbaren Rangbereich oder enthält Rechte außerhalb Ihres Grant Ceilings.', 'error');
    return;
  }
  if (!objectTypes.length) {
    toast('Objekttypen nicht geladen', 'Bitte laden Sie die Seite neu.', 'error');
    return;
  }

  const permissionLabels = new Map(permissionGroups.flatMap((group) => group.permissions.map((permission) => [permission.key, `${group.label} · ${permission.label}`])));
  const dataByKey = {
    vehicles: db.vehicles,
    drivers: db.drivers,
    bookings: db.bookings,
    costs: db.costs,
    maintenance: db.maintenance
  };
  const currentRules = role.objectPermissions || {};

  const objectLabel = (typeKey, item) => {
    if (typeKey === 'vehicle') return `${item.name} · ${item.plate}`;
    if (typeKey === 'driver') return `${item.name} · ${item.role || 'Fahrer:in'}`;
    if (typeKey === 'booking') {
      const vehicle = getVehicle(item.vehicleId);
      return `${item.purpose} · ${formatDate(item.start)}${vehicle ? ` · ${vehicle.name}` : ''}`;
    }
    if (typeKey === 'cost') {
      const vehicle = getVehicle(item.vehicleId);
      return `${item.category} · ${formatDate(item.date)}${vehicle ? ` · ${vehicle.name}` : ''} · ${formatMoney(item.amount, 2)}`;
    }
    const vehicle = getVehicle(item.vehicleId);
    return `${item.title} · ${formatDate(item.dueDate)}${vehicle ? ` · ${vehicle.name}` : ''}`;
  };

  const objectSections = objectTypes.map((type, index) => {
    const items = dataByKey[type.dataKey] || [];
    const typeRules = currentRules[type.key] || {};
    const overrideCount = Object.keys(typeRules).length;
    const rules = items.map((item) => {
      const rule = typeRules[item.id] || { allow: [], deny: [] };
      const count = rule.allow.length + rule.deny.length;
      return `
        <details class="object-rule" ${count ? 'open' : ''}>
          <summary>
            <span class="object-rule-title">${esc(objectLabel(type.key, item))}</span>
            <span class="badge badge-${count ? 'violet' : 'gray'} no-dot">${count ? `${count} Ausnahmen` : 'Standard'}</span>
          </summary>
          <div class="object-rule-body">
            <div class="object-rule-grid">
              ${type.permissions.map((permission) => {
                const value = rule.allow.includes(permission) ? 'allow' : rule.deny.includes(permission) ? 'deny' : 'standard';
                const grantable = privileged() || permissions.has(permission);
                return `<label class="object-permission">
                  <span>${esc(permissionLabels.get(permission) || permission)}</span>
                  <select class="select select-sm" data-object-type="${type.key}" data-object-id="${item.id}" data-permission="${permission}" ${grantable ? '' : 'disabled title="Recht der eigenen Rolle nicht vorhanden"'}>
                    <option value="standard" ${value === 'standard' ? 'selected' : ''}>Standard</option>
                    <option value="allow" ${value === 'allow' ? 'selected' : ''}>Erlauben</option>
                    <option value="deny" ${value === 'deny' ? 'selected' : ''}>Verweigern</option>
                  </select>
                </label>`;
              }).join('')}
            </div>
            <button class="btn-link" type="button" data-reset-object="${type.key}:${item.id}">Auf Standard zurücksetzen</button>
          </div>
        </details>`;
    }).join('');
    return `
      <details class="object-type" ${index === 0 ? 'open' : ''}>
        <summary>
          <span><strong>${esc(type.label)}</strong><em>${items.length} Objekte</em></span>
          <span class="badge badge-${overrideCount ? 'violet' : 'gray'} no-dot">${overrideCount ? `${overrideCount} Objekte mit Ausnahmen` : 'Keine Ausnahmen'}</span>
        </summary>
        <div class="object-type-body">
          ${items.length ? rules : emptyState('filter', 'Keine Objekte vorhanden', `Für ${esc(type.label)} sind noch keine Einträge vorhanden.`, '', true)}
        </div>
      </details>`;
  }).join('');

  showModal({
    title: 'Objekt-Ausnahmen',
    eyebrow: role.name,
    subtitle: 'Feinsteuerung pro Fahrzeug, Fahrer:in, Buchung, Kostenposition und Wartung.',
    size: 'modal-xl',
    body: `
      <form id="roleObjectForm" novalidate>
        ${formAlertMarkup()}
        <div class="info-banner">
          ${icon('shield')}
          <div><strong>Objekt-Regel hat Vorrang</strong><p>„Erlauben“ überschreibt ein fehlendes Rollenrecht für genau dieses Objekt. „Verweigern“ entzieht das Recht für dieses Objekt. Bei Konflikten gewinnt die Verweigerung. „Standard“ bedeutet: Es gilt das Rollenrecht. Ausgegraute Rechte gehören nicht zum Grant Ceiling Ihrer eigenen Rolle.</p></div>
        </div>
        <div class="object-type-list">${objectSections}</div>
      </form>`,
    footer: `
      <button class="btn btn-ghost" type="button" data-close-modal>Abbrechen</button>
      <button class="btn btn-primary" type="submit" form="roleObjectForm">${icon('check')} Objekt-Ausnahmen speichern</button>`
  });

  const form = $('#roleObjectForm');
  form.querySelectorAll('[data-reset-object]').forEach((button) => {
    button.addEventListener('click', () => {
      const [type, id] = String(button.dataset.resetObject || '').split(':');
      form.querySelectorAll(`select[data-object-type="${CSS.escape(type)}"][data-object-id="${CSS.escape(id)}"]`).forEach((select) => {
        select.value = 'standard';
      });
      const details = button.closest('.object-rule');
      const badge = details?.querySelector('summary .badge');
      if (badge) {
        badge.textContent = 'Standard';
        badge.className = 'badge badge-gray no-dot';
      }
    });
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    clearFormError(form);
    const objectPermissions = {};
    form.querySelectorAll('select[data-object-type][data-object-id][data-permission]').forEach((select) => {
      const effect = select.value;
      if (!['allow', 'deny'].includes(effect)) return;
      const type = select.dataset.objectType;
      const id = select.dataset.objectId;
      const permission = select.dataset.permission;
      objectPermissions[type] ||= {};
      objectPermissions[type][id] ||= { allow: [], deny: [] };
      objectPermissions[type][id][effect].push(permission);
    });
    const submitButton = modalRoot.querySelector('button[form="roleObjectForm"]');
    if (submitButton) submitButton.disabled = true;
    try {
      const state = await apiFetch(`/api/roles/${encodeURIComponent(role.id)}/object-permissions`, {
        method: 'PATCH',
        body: { objectPermissions }
      });
      applyServerState(state);
      closeModal(false);
      renderCurrentView();
      toast('Objekt-Ausnahmen gespeichert', `${role.name} wurde aktualisiert.`);
    } catch (error) {
      showFormError(form, error.message);
    } finally {
      if (submitButton) submitButton.disabled = false;
    }
  });
}

function openDeleteRoleConfirm(roleId) {
  if (!can('roles_manage')) {
    toast('Keine Berechtigung', 'Für das Löschen von Rollen fehlt die Berechtigung „Rollen verwalten“.', 'error');
    return;
  }
  const role = db.roles?.find((entry) => entry.id === roleId);
  if (!role) return;
  if (!canManageRole(role)) {
    toast('Nicht bearbeitbar', 'Diese Rolle liegt nicht in Ihrem verwaltbaren Rangbereich oder enthält Rechte außerhalb Ihres Grant Ceilings.', 'error');
    return;
  }
  if (role.isSystem) {
    toast('Systemrolle', 'Systemrollen können nicht gelöscht werden.', 'info');
    return;
  }
  if (role.userCount > 0) {
    toast('Rolle ist zugewiesen', 'Weisen Sie die Benutzer:innen zuerst einer anderen Rolle zu.', 'info');
    return;
  }
  openConfirm({
    title: 'Rolle löschen?',
    text: `Die Rolle <strong>${esc(role.name)}</strong> wird dauerhaft entfernt. Diese Aktion kann nicht rückgängig gemacht werden.`,
    confirmLabel: 'Rolle löschen',
    danger: true,
    onConfirm: async () => {
      try {
        const state = await apiFetch(`/api/roles/${encodeURIComponent(role.id)}`, { method: 'DELETE' });
        applyServerState(state);
        renderCurrentView();
        toast('Rolle gelöscht', `${role.name} wurde entfernt.`);
      } catch (error) {
        toast('Rolle konnte nicht gelöscht werden', error.message, 'error');
      }
    }
  });
}

/* =========================================================
   Fahrtenbuch
   ========================================================= */
function openLogModal() {
  if (!can('logbook_manage')) {
    toast('Keine Berechtigung', 'Ihre Rolle darf keine Fahrten nachtragen.', 'error');
    return;
  }
  const vehicles = db.vehicles;
  const drivers = db.drivers.filter((driver) => driver.status !== 'away');
  if (!vehicles.length || !drivers.length) {
    toast('Stammdaten fehlen', 'Bitte legen Sie zuerst ein Fahrzeug und eine Fahrer:in an.', 'info');
    return;
  }
  const firstVehicle = vehicles[0];
  const initialStart = firstVehicle ? firstVehicle.mileage : 0;
  const vehicleOptions = vehicles.map((vehicle) => `<option value="${vehicle.id}">${esc(vehicle.name)} · ${esc(vehicle.plate)}</option>`).join('');
  const driverOptions = drivers.map((driver) => `<option value="${driver.id}">${esc(driver.name)}</option>`).join('');
  const canSelectCostCenter = can('cost_centers_view');
  const defaultCostCenterId = defaultBookingCostCenterId({ driver: drivers[0], vehicle: firstVehicle, user: currentUser });

  showModal({
    title: 'Fahrt nachtragen',
    eyebrow: 'Fahrtenbuch',
    subtitle: 'Eine bereits gefahrene Strecke manuell dokumentieren.',
    size: 'modal-lg',
    body: `
      <form id="logForm" novalidate>
        ${formAlertMarkup()}
        <div class="info-banner" id="logKmHint" hidden></div>
        <div class="form-grid">
          <div class="field field-full">
            <label for="logVehicle">Fahrzeug <span class="optional">*</span></label>
            <select class="select" id="logVehicle" name="vehicleId" required>${vehicleOptions}</select>
          </div>
          <div class="field">
            <label for="logDriver">Fahrer:in <span class="optional">*</span></label>
            <select class="select" id="logDriver" name="driverId" required>${driverOptions}</select>
          </div>
          ${canSelectCostCenter ? costCenterSelectMarkup('logCostCenter', defaultCostCenterId) : ''}
          <div class="field">
            <label for="logDate">Datum <span class="optional">*</span></label>
            <input class="input" id="logDate" name="date" type="date" value="${todayISO()}" required>
          </div>
          <div class="field field-full">
            <label for="logPurpose">Zweck der Fahrt <span class="optional">*</span></label>
            <input class="input" id="logPurpose" name="purpose" type="text" placeholder="z. B. Hausbesuche" required maxlength="120">
          </div>
          <div class="field">
            <label for="logStart">Von <span class="optional">*</span></label>
            <input class="input" id="logStart" name="startTime" type="time" value="08:00" step="300" required>
          </div>
          <div class="field">
            <label for="logEnd">Bis <span class="optional">*</span></label>
            <input class="input" id="logEnd" name="endTime" type="time" value="10:00" step="300" required>
          </div>
          <div class="field">
            <label for="logStartKm">Startkilometer <span class="optional">*</span></label>
            <input class="input" id="logStartKm" name="startKm" type="number" min="0" step="1" value="${initialStart}" required>
          </div>
          <div class="field">
            <label for="logEndKm">Endkilometer <span class="optional">*</span></label>
            <input class="input" id="logEndKm" name="endKm" type="number" min="0" step="1" value="${initialStart + 20}" required>
          </div>
          <div class="field field-full">
            <label for="logNotes">Notizen <span class="optional">optional</span></label>
            <textarea class="textarea" id="logNotes" name="notes" rows="2" maxlength="400" placeholder="Weitere Angaben zur Fahrt …"></textarea>
          </div>
        </div>
      </form>`,
    footer: `
      <button class="btn btn-ghost" type="button" data-close-modal>Abbrechen</button>
      <button class="btn btn-primary" type="submit" form="logForm">${icon('book')} Fahrt speichern</button>`
  });

  const form = $('#logForm');
  const vehicleSelect = $('#logVehicle');
  const startKmInput = $('#logStartKm');
  const endKmInput = $('#logEndKm');
  const kmHint = $('#logKmHint');

  const updateKmHint = () => {
    if (!kmHint) return;
    const vehicle = getVehicle(vehicleSelect.value);
    const startKm = Number(startKmInput.value);
    if (!vehicle || !Number.isFinite(startKm) || startKm >= Number(vehicle.mileage)) {
      kmHint.hidden = true;
      kmHint.innerHTML = '';
      return;
    }
    kmHint.innerHTML = `${icon('info')}<div><strong>Historischer Nachtrag</strong><p>Der Startkilometer (${formatNumber(startKm)} km) liegt unter dem aktuellen Fahrzeugstand (${formatNumber(vehicle.mileage)} km). Das ist bei nachträglichen Fahrten möglich; die Fahrt wird gespeichert.</p></div>`;
    kmHint.hidden = false;
  };

  const driverSelect = $('#logDriver');
  const logCostCenterSelect = $('#logCostCenter');
  const logCostCenterHint = $('#logCostCenterHint');
  let logCostCenterTouched = false;
  const refreshLogCostCenter = () => {
    if (!logCostCenterSelect) return;
    const vehicle = getVehicle(vehicleSelect.value);
    const driver = getDriver(driverSelect?.value);
    const nextDefault = defaultBookingCostCenterId({ driver, vehicle, user: currentUser });
    if (!logCostCenterTouched && logCostCenterSelect.value !== nextDefault) logCostCenterSelect.value = nextDefault;
    if (logCostCenterHint) {
      logCostCenterHint.textContent = costCenterSelectionHint(logCostCenterSelect.value, nextDefault, { driver, vehicle, user: currentUser });
    }
  };
  logCostCenterSelect?.addEventListener('change', () => {
    logCostCenterTouched = true;
    refreshLogCostCenter();
  });
  driverSelect?.addEventListener('change', refreshLogCostCenter);

  vehicleSelect.addEventListener('change', () => {
    const vehicle = getVehicle(vehicleSelect.value);
    if (vehicle) {
      startKmInput.value = vehicle.mileage;
      endKmInput.value = Number(vehicle.mileage) + 20;
    }
    updateKmHint();
    refreshLogCostCenter();
  });
  startKmInput.addEventListener('input', updateKmHint);
  updateKmHint();
  refreshLogCostCenter();

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    clearFormError(form);
    const data = new FormData(form);
    const vehicleId = String(data.get('vehicleId') || '');
    const driverId = String(data.get('driverId') || '');
    const date = String(data.get('date') || '');
    const from = String(data.get('startTime') || '');
    const to = String(data.get('endTime') || '');
    const purpose = String(data.get('purpose') || '').trim();
    const startKm = Number(data.get('startKm'));
    const endKm = Number(data.get('endKm'));
    if (!vehicleId || !driverId || !date || !from || !to || !purpose) {
      showFormError(form, 'Bitte füllen Sie alle Pflichtfelder aus.');
      return;
    }
    if (to <= from) {
      showFormError(form, 'Die Ankunftszeit muss nach der Abfahrtszeit liegen.');
      return;
    }
    if (!Number.isFinite(startKm) || !Number.isFinite(endKm) || startKm < 0 || endKm < startKm) {
      showFormError(form, 'Der Endkilometerstand muss größer oder gleich dem Startkilometerstand sein.');
      return;
    }
    const submitButton = modalRoot.querySelector('button[form="logForm"]');
    if (submitButton) submitButton.disabled = true;
    try {
      const state = await apiFetch('/api/trips', {
        method: 'POST',
        body: {
          vehicleId,
          driverId,
          date,
          startTime: from,
          endTime: to,
          purpose,
          startKm,
          endKm,
          notes: String(data.get('notes') || '').trim(),
          ...(logCostCenterSelect ? { costCenterId: logCostCenterSelect.value || null } : {})
        }
      });
      const leasingWarning = state.leasingWarning;
      applyServerState(state);
      closeModal(false);
      renderCurrentView();
      toast('Fahrt nachgetragen', `${formatNumber(endKm - startKm)} km wurden dokumentiert.`);
      if (leasingWarning) toast('Leasing-Hinweis', leasingWarning, 'info');
    } catch (error) {
      showFormError(form, error.message);
    } finally {
      if (submitButton) submitButton.disabled = false;
    }
  });
}
