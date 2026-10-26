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
function openBookingModal(prefill = {}) {
  const availableVehicles = db.vehicles;
  const prefillVehicle = prefill.vehicleId ? getVehicle(prefill.vehicleId) : null;
  const selectedVehicle = prefillVehicle || availableVehicles.find((vehicle) => vehicle.status === 'available') || availableVehicles[0];
  const drivers = db.drivers.filter((driver) => driver.status !== 'away');
  const selectedDriver = prefill.driverId ? getDriver(prefill.driverId) : drivers[0];
  if (!availableVehicles.length) {
    toast('Kein Fahrzeug vorhanden', 'Bitte legen Sie zuerst ein Fahrzeug an.', 'info');
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

  const vehicleOptions = availableVehicles.map((vehicle) => {
    const status = VEHICLE_STATUS[vehicle.status];
    return `<option value="${vehicle.id}" ${vehicle.id === selectedVehicle?.id ? 'selected' : ''}>${esc(vehicle.name)} · ${esc(vehicle.plate)}${vehicle.status === 'maintenance' ? ' · In Wartung' : ''}</option>`;
  }).join('');
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
          </div>
          <div class="field field-full">
            <label for="bookingDriver">Fahrer:in <span class="optional">*</span></label>
            <select class="select" id="bookingDriver" name="driverId" required>
              ${driverOptions}
            </select>
          </div>
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

    const submitButton = modalRoot.querySelector('button[form="bookingForm"]');
    if (submitButton) submitButton.disabled = true;
    try {
      const state = await apiFetch('/api/bookings', {
        method: 'POST',
        body: { vehicleId, driverId, date: bookingDate, startTime: from, endTime: to, purpose: bookingPurpose, notes }
      });
      applyServerState(state);
      closeModal(false);
      renderCurrentView();
      toast('Buchung angelegt', `${vehicle ? vehicle.name : 'Fahrzeug'} · ${formatDate(bookingDate)}, ${from}–${to} Uhr`);
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
  const vehicle = getVehicle(booking.vehicleId);
  const driver = getDriver(booking.driverId);
  const distance = booking.startKm != null && booking.endKm != null ? Math.max(0, Number(booking.endKm) - Number(booking.startKm)) : null;
  const canStart = booking.status === 'planned';
  const canEnd = booking.status === 'active';
  const canCancel = booking.status === 'planned';
  const canDelete = booking.status === 'canceled';

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
            <span class="mini-icon tint-gray">${icon('book')}</span>
            <div class="main"><strong>Notizen</strong><span>${booking.notes ? esc(booking.notes) : 'Keine Notizen hinterlegt.'}</span></div>
          </div>
        </div>
      </div>`,
    footer: footerActions || `<button class="btn btn-ghost" type="button" data-close-modal>Schließen</button>`
  });
}

function openEndTripModal(bookingId) {
  const booking = db.bookings.find((item) => item.id === bookingId);
  if (!booking) return;
  const vehicle = getVehicle(booking.vehicleId);
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
      applyServerState(state);
      closeModal(false);
      renderCurrentView();
      toast('Fahrt abgeschlossen', `${formatNumber(endKm - startKm)} km wurden dem Fahrtenbuch hinzugefügt.`);
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
  const existing = vehicleId ? getVehicle(vehicleId) : null;
  const defaults = {
    name: '', plate: '', type: 'Pkw', fuel: 'Diesel', seats: 5, status: 'available',
    location: '', department: '', mileage: 0, nextService: addDays(todayISO(), 90),
    tuv: addDays(todayISO(), 365), insurance: '', notes: '', image: ''
  };
  const vehicle = existing || defaults;
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
          <div class="field">
            <label for="vehicleLocation">Standort</label>
            <input class="input" id="vehicleLocation" name="location" type="text" value="${esc(vehicle.location)}" placeholder="z. B. Kita Pusteblume">
          </div>
          <div class="field">
            <label for="vehicleDepartment">Abteilung / Einrichtung</label>
            <input class="input" id="vehicleDepartment" name="department" type="text" value="${esc(vehicle.department)}" placeholder="z. B. Ambulante Pflege">
          </div>
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
  const imageInput = $('#vehicleImageInput');
  const imagePreviewBox = $('#vehicleImagePreview');
  const removeImageButton = $('#vehicleImageRemove');
  const uploadBox = $('#vehicleImageUpload');

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
      location: String(data.get('location') || '').trim(),
      department: String(data.get('department') || '').trim(),
      mileage: Math.max(0, Number(data.get('mileage')) || 0),
      insurance: String(data.get('insurance') || '').trim(),
      nextService: String(data.get('nextService') || ''),
      tuv: String(data.get('tuv') || ''),
      notes: String(data.get('notes') || '').trim(),
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

function openVehicleDetails(vehicleId) {
  const vehicle = getVehicle(vehicleId);
  if (!vehicle) return;
  const upcoming = sortByDateAsc(db.bookings.filter((booking) => booking.vehicleId === vehicleId &&
    ['planned', 'active'].includes(booking.status) &&
    booking.start.slice(0, 10) >= todayISO())).slice(0, 3);
  const maintenance = [...db.maintenance.filter((item) => item.vehicleId === vehicleId)]
    .sort((a, b) => String(b.dueDate).localeCompare(String(a.dueDate))).slice(0, 3);
  const costTotal = getCostsLastMonths(6).filter((cost) => cost.vehicleId === vehicleId).reduce((sum, cost) => sum + Number(cost.amount), 0);
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
          <div class="vehicle-sub"><span class="plate">${esc(vehicle.plate)}</span><span>·</span><span>${esc(vehicle.location)}</span></div>
          <div style="margin-top:8px"><span class="badge badge-${status.badge}">${status.label}</span></div>
        </div>
      </div>
      <div class="detail-stats">
        <div class="detail-stat"><span>${icon('gauge')} Kilometerstand</span><strong>${formatKm(vehicle.mileage)}</strong></div>
        <div class="detail-stat"><span>${icon('shield')} HU/AU</span><strong>${formatDate(vehicle.tuv)}${tuvDays < 0 ? ` · ${Math.abs(tuvDays)} Tage überfällig` : ''}</strong></div>
        <div class="detail-stat"><span>${icon('wrench')} Inspektion</span><strong>${formatDate(vehicle.nextService)}</strong></div>
        <div class="detail-stat"><span>${icon('fuel')} Kraftstoff</span><strong>${esc(vehicle.fuel)}</strong></div>
        <div class="detail-stat"><span>${icon('seat')} Sitzplätze</span><strong>${vehicle.seats}</strong></div>
        <div class="detail-stat"><span>${icon('receipt')} Kosten 6 Monate</span><strong>${formatMoney(costTotal)}</strong></div>
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
      <div class="detail-sections-grid">
        <div class="detail-section">
          <p class="detail-section-title">Nächste Buchungen</p>
          <div class="detail-list">${bookingRows}</div>
        </div>
        <div class="detail-section">
          <p class="detail-section-title">Wartungshistorie</p>
          <div class="detail-list">${maintenanceRows}</div>
        </div>
      </div>`,
    footer: `
      <button class="btn btn-ghost" type="button" data-action="edit-vehicle" data-id="${vehicle.id}">${icon('edit')} Bearbeiten</button>
      <button class="btn btn-primary" type="button" data-action="book-vehicle" data-id="${vehicle.id}" ${vehicle.status === 'maintenance' ? 'disabled title="Fahrzeug in Wartung"' : ''}>${icon('calendar')} Fahrzeug buchen</button>`
  });
}

/* =========================================================
   Wartung & Kosten
   ========================================================= */
function openMaintenanceModal() {
  if (!db.vehicles.length) {
    toast('Kein Fahrzeug vorhanden', 'Bitte legen Sie zuerst ein Fahrzeug an.', 'info');
    return;
  }
  const vehicleOptions = db.vehicles.map((vehicle) => `<option value="${vehicle.id}">${esc(vehicle.name)} · ${esc(vehicle.plate)}</option>`).join('');
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

function openCostModal() {
  if (!db.vehicles.length) {
    toast('Kein Fahrzeug vorhanden', 'Bitte legen Sie zuerst ein Fahrzeug an.', 'info');
    return;
  }
  const vehicleOptions = db.vehicles.map((vehicle) => `<option value="${vehicle.id}">${esc(vehicle.name)} · ${esc(vehicle.plate)}</option>`).join('');
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
  const receiptInput = $('#costReceiptInput');
  const receiptPreview = $('#costReceiptPreview');
  const removeReceiptButton = $('#costReceiptRemove');
  const uploadBox = $('#costReceiptUpload');

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
          receipt: pendingReceipt
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
  const existing = driverId ? getDriver(driverId) : null;
  const defaults = { name: '', role: '', department: '', phone: '', email: '', status: 'available', license: ['B'] };
  const driver = existing || defaults;
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
            <input class="input" id="driverEmail" name="email" type="email" value="${esc(driver.email)}" placeholder="name@awo-bremerhaven.de">
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
   Benutzerverwaltung
   ========================================================= */
function openUserModal(userId = null) {
  if (!capabilities.manageUsers) {
    toast('Keine Berechtigung', 'Nur Administratoren dürfen Benutzer verwalten.', 'error');
    return;
  }
  const existing = userId ? db.users.find((user) => user.id === userId) : null;
  const user = existing || { name: '', email: '', role: 'manager', active: true };
  showModal({
    title: existing ? 'Benutzer bearbeiten' : 'Benutzer anlegen',
    eyebrow: 'Zugänge',
    subtitle: existing ? `${user.name} · ${user.email}` : 'Neuen Zugang für die Fuhrparkverwaltung erstellen.',
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
            <select class="select" id="accountRole" name="role">
              <option value="manager" ${user.role === 'manager' ? 'selected' : ''}>Fuhrparkleitung</option>
              <option value="admin" ${user.role === 'admin' ? 'selected' : ''}>Administrator</option>
            </select>
          </div>
          <div class="field">
            <label for="accountPassword">${existing ? 'Neues Passwort' : 'Passwort'} ${existing ? '<span class="optional">optional</span>' : '<span class="optional">*</span>'}</label>
            <input class="input" id="accountPassword" name="password" type="password" autocomplete="new-password" minlength="10" placeholder="${existing ? 'Leer lassen, um nichts zu ändern' : 'Mindestens 10 Zeichen'}">
          </div>
          ${existing ? `<div class="field field-full"><label class="check-row"><input type="checkbox" name="active" ${user.active ? 'checked' : ''}> Konto aktiv</label></div>` : ''}
        </div>
      </form>`,
    footer: `
      <button class="btn btn-ghost" type="button" data-close-modal>Abbrechen</button>
      <button class="btn btn-primary" type="submit" form="userForm">${icon('check')} ${existing ? 'Änderungen speichern' : 'Benutzer anlegen'}</button>`
  });

  const form = $('#userForm');
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
    const body = {
      name,
      email,
      role: String(data.get('role') || 'manager'),
      active: existing ? data.get('active') === 'on' : true
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
      if (ui.route === 'benutzer' && !capabilities.manageUsers) {
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
   Fahrtenbuch
   ========================================================= */
function openLogModal() {
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

  showModal({
    title: 'Fahrt nachtragen',
    eyebrow: 'Fahrtenbuch',
    subtitle: 'Eine bereits gefahrene Strecke manuell dokumentieren.',
    size: 'modal-lg',
    body: `
      <form id="logForm" novalidate>
        ${formAlertMarkup()}
        <div class="form-grid">
          <div class="field field-full">
            <label for="logVehicle">Fahrzeug <span class="optional">*</span></label>
            <select class="select" id="logVehicle" name="vehicleId" required>${vehicleOptions}</select>
          </div>
          <div class="field">
            <label for="logDriver">Fahrer:in <span class="optional">*</span></label>
            <select class="select" id="logDriver" name="driverId" required>${driverOptions}</select>
          </div>
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

  vehicleSelect.addEventListener('change', () => {
    const vehicle = getVehicle(vehicleSelect.value);
    if (vehicle) {
      startKmInput.value = vehicle.mileage;
      endKmInput.value = Number(vehicle.mileage) + 20;
    }
  });

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
          notes: String(data.get('notes') || '').trim()
        }
      });
      applyServerState(state);
      closeModal(false);
      renderCurrentView();
      toast('Fahrt nachgetragen', `${formatNumber(endKm - startKm)} km wurden dokumentiert.`);
    } catch (error) {
      showFormError(form, error.message);
    } finally {
      if (submitButton) submitButton.disabled = false;
    }
  });
}
