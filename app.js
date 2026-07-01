/* ============================================================
   Coletor Territorial — app.js
   Tudo em ES puro. Organizado em módulos por responsabilidade.
   ============================================================ */
'use strict';

/* ------------------------------------------------------------
   0. Utilidades gerais
   ------------------------------------------------------------ */
const Utils = {
  /** Escapa HTML para evitar injeção em pop-ups e listas. */
  escapeHtml(value) {
    if (value === undefined || value === null) return '';
    const div = document.createElement('div');
    div.textContent = String(value);
    return div.innerHTML;
  },

  /** Gera ID curto e único suficiente para uso local. */
  uid(prefix = 'id') {
    return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  },

  /** ISO em UTC. */
  nowISO() { return new Date().toISOString(); },

  /** Formata data ISO para exibição no fuso local. */
  fmtDateTime(iso) {
    if (!iso) return '--';
    try {
      return new Intl.DateTimeFormat('pt-BR', {
        dateStyle: 'short', timeStyle: 'short'
      }).format(new Date(iso));
    } catch { return iso; }
  },

  /** Coordenada válida em graus decimais. */
  isValidCoord(lat, lon) {
    const la = Number(lat), lo = Number(lon);
    return Number.isFinite(la) && Number.isFinite(lo) &&
           la >= -90 && la <= 90 && lo >= -180 && lo <= 180;
  },

  /** Classifica precisão GNSS. */
  classifyAccuracy(acc) {
    if (acc === null || acc === undefined || !Number.isFinite(Number(acc))) {
      return { label: 'Não informado', cls: 'badge-muted', cardCls: '' };
    }
    const a = Number(acc);
    if (a <= 5)  return { label: 'Excelente', cls: 'badge-ok',    cardCls: '' };
    if (a <= 10) return { label: 'Boa',       cls: 'badge-ok',    cardCls: '' };
    if (a <= 25) return { label: 'Regular',   cls: 'badge-warn',  cardCls: 'gnss-regular' };
    return { label: 'Baixa', cls: 'badge-err', cardCls: 'gnss-low' };
  },

  /** Abrevia nome de campo p/ limite DBF (10 chars), sem símbolos. */
  abbreviateField(name, used) {
    let base = String(name)
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // remove acentos
      .replace(/[^A-Za-z0-9_]/g, '_')
      .toUpperCase();
    let candidate = base.slice(0, 10);
    let n = 1;
    while (used.has(candidate)) {
      const suffix = String(n++);
      candidate = base.slice(0, 10 - suffix.length) + suffix;
    }
    used.add(candidate);
    return candidate;
  }
};

/* ------------------------------------------------------------
   1. Camada de armazenamento — IndexedDB
   ------------------------------------------------------------ */
const DB = (() => {
  const DB_NAME = 'ColetorTerritorialDB';
  const DB_VERSION = 1;
  let _db = null;

  function open() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains('forms')) {
          db.createObjectStore('forms', { keyPath: 'formId' });
        }
        if (!db.objectStoreNames.contains('records')) {
          const r = db.createObjectStore('records', { keyPath: 'recordId' });
          r.createIndex('formId', 'formId', { unique: false });
        }
        if (!db.objectStoreNames.contains('attachments')) {
          db.createObjectStore('attachments', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('settings')) {
          db.createObjectStore('settings', { keyPath: 'key' });
        }
      };
      req.onsuccess = () => { _db = req.result; resolve(_db); };
      req.onerror = () => reject(req.error);
    });
  }

  function tx(store, mode = 'readonly') {
    return _db.transaction(store, mode).objectStore(store);
  }

  function reqToPromise(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  // FORMS
  async function putForm(form) {
    return reqToPromise(tx('forms', 'readwrite').put(form));
  }
  async function getForm(formId) {
    return reqToPromise(tx('forms').get(formId));
  }
  async function getAllForms() {
    return reqToPromise(tx('forms').getAll());
  }
  async function deleteForm(formId) {
    return reqToPromise(tx('forms', 'readwrite').delete(formId));
  }

  // RECORDS
  async function putRecord(record) {
    return reqToPromise(tx('records', 'readwrite').put(record));
  }
  async function getRecord(recordId) {
    return reqToPromise(tx('records').get(recordId));
  }
  async function getAllRecords() {
    return reqToPromise(tx('records').getAll());
  }
  async function deleteRecord(recordId) {
    return reqToPromise(tx('records', 'readwrite').delete(recordId));
  }

  // SETTINGS
  async function getSetting(key) {
    const r = await reqToPromise(tx('settings').get(key));
    return r ? r.value : null;
  }
  async function setSetting(key, value) {
    return reqToPromise(tx('settings', 'readwrite').put({ key, value }));
  }

  async function wipeAll() {
    await reqToPromise(tx('records', 'readwrite').clear());
    await reqToPromise(tx('forms', 'readwrite').clear());
    await reqToPromise(tx('attachments', 'readwrite').clear());
  }

  return { open, putForm, getForm, getAllForms, deleteForm,
           putRecord, getRecord, getAllRecords, deleteRecord,
           getSetting, setSetting, wipeAll };
})();

/* ------------------------------------------------------------
   2. UI helpers — toast, modal, navegação
   ------------------------------------------------------------ */
const UI = (() => {
  let toastTimer = null;
  function toast(msg, type = '') {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.className = 'toast' + (type ? ` toast-${type}` : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.add('hidden'), 3200);
  }

  function confirmDialog(message, { title = 'Confirmar' } = {}) {
    return new Promise((resolve) => {
      const modal = document.getElementById('confirmModal');
      document.getElementById('confirmTitle').textContent = title;
      document.getElementById('confirmMsg').textContent = message;
      modal.classList.remove('hidden');

      const ok = document.getElementById('confirmOk');
      const cancel = document.getElementById('confirmCancel');

      const cleanup = (val) => {
        modal.classList.add('hidden');
        ok.removeEventListener('click', okH);
        cancel.removeEventListener('click', cancelH);
        resolve(val);
      };
      const okH = () => cleanup(true);
      const cancelH = () => cleanup(false);
      ok.addEventListener('click', okH);
      cancel.addEventListener('click', cancelH);
    });
  }

  function switchScreen(name) {
    document.querySelectorAll('.screen').forEach(s => s.classList.add('hidden'));
    const target = document.getElementById('screen-' + name);
    if (target) target.classList.remove('hidden');
    document.querySelectorAll('.navbtn').forEach(b => {
      b.classList.toggle('active', b.dataset.screen === name);
    });
    // Recarrega conteúdo dinâmico ao entrar em cada tela
    if (name === 'records') App.renderRecords();
    if (name === 'map') App.refreshMap();
    if (name === 'collect') App.renderCollectFields();
    if (name === 'form') App.renderFieldsList();
    if (name === 'export') App.renderExportOptions();
  }

  return { toast, confirmDialog, switchScreen };
})();

/* ------------------------------------------------------------
   3. Estado da aplicação
   ------------------------------------------------------------ */
const State = {
  currentForm: null,         // formulário ativo
  draftFields: [],           // campos em edição no construtor
  currentCoord: null,        // {lat, lon, acc, alt, ts, source, original?, manualOverride?}
  watchId: null,
  map: null,
  mapMarkersLayer: null,
  editingRecordId: null,
};

/* ------------------------------------------------------------
   4. Construtor de formulário
   ------------------------------------------------------------ */
const FormBuilder = (() => {
  async function saveMeta() {
    const name = document.getElementById('formName').value.trim();
    const desc = document.getElementById('formDesc').value.trim();
    if (!name) { UI.toast('Informe o nome do formulário.', 'err'); return; }

    try {
      let form = State.currentForm;
      const now = Utils.nowISO();
      if (!form) {
        form = {
          formId: Utils.uid('form'),
          name, description: desc,
          version: '1.0.0',
          schemaVersion: 1,
          createdAt: now,
          updatedAt: now,
          fields: [...State.draftFields]
        };
      } else {
        // Migração: se campos mudaram, incrementa schemaVersion
        const changed = JSON.stringify(form.fields) !== JSON.stringify(State.draftFields);
        form.name = name;
        form.description = desc;
        form.fields = [...State.draftFields].sort((a, b) => a.order - b.order);
        form.updatedAt = now;
        if (changed) {
          form.schemaVersion = (form.schemaVersion || 1) + 1;
        }
      }
      await DB.putForm(form);
      State.currentForm = form;
      UI.toast('Formulário salvo.', 'ok');
      App.refreshTopbar();
      App.populateFormSelectors();
    } catch (e) {
      console.error({ msg: e.message, stack: e.stack, context: 'FormBuilder.saveMeta' });
      UI.toast('Erro ao salvar formulário.', 'err');
    }
  }

  function addField() {
    const label = document.getElementById('fLabel').value.trim();
    const type = document.getElementById('fType').value;
    const optionsRaw = document.getElementById('fOptions').value.trim();
    const required = document.getElementById('fRequired').value === 'true';

    if (!label) { UI.toast('Informe o rótulo do campo.', 'err'); return; }

    const field = {
      id: Utils.uid('campo'),
      label, type, required,
      options: (type === 'select' || type === 'multiselect')
        ? optionsRaw.split(',').map(s => s.trim()).filter(Boolean)
        : [],
      order: State.draftFields.length + 1
    };
    State.draftFields.push(field);
    renderList();

    // limpa inputs de novo campo
    document.getElementById('fLabel').value = '';
    document.getElementById('fOptions').value = '';
    UI.toast('Campo adicionado.', 'ok');
  }

  function removeField(id) {
    State.draftFields = State.draftFields.filter(f => f.id !== id)
      .map((f, i) => ({ ...f, order: i + 1 }));
    renderList();
  }

  function moveField(id, dir) {
    const arr = [...State.draftFields].sort((a, b) => a.order - b.order);
    const idx = arr.findIndex(f => f.id === id);
    const target = idx + dir;
    if (idx < 0 || target < 0 || target >= arr.length) return;
    [arr[idx], arr[target]] = [arr[target], arr[idx]];
    arr.forEach((f, i) => f.order = i + 1);
    State.draftFields = arr;
    renderList();
  }

  function renderList() {
    const container = document.getElementById('fieldsList');
    const arr = [...State.draftFields].sort((a, b) => a.order - b.order);
    if (arr.length === 0) {
      container.innerHTML = '<p class="hint">Nenhum campo ainda. Adicione o primeiro.</p>';
      return;
    }
    container.innerHTML = arr.map(f => {
      const typeLabel = {
        text:'Texto curto', textarea:'Texto longo', integer:'Inteiro',
        decimal:'Decimal', select:'Lista', multiselect:'Múltipla',
        date:'Data', time:'Hora', datetime:'Data/hora', boolean:'Sim/Não'
      }[f.type] || f.type;
      const opt = (f.options && f.options.length) ? `<small>Opções: ${Utils.escapeHtml(f.options.join(', '))}</small>` : '';
      return `
        <div class="field-item">
          <div class="meta">
            <strong>${Utils.escapeHtml(f.label)}</strong>
            ${f.required ? '<span class="req-dot">*</span>' : ''}
            <small>${typeLabel} • ordem ${f.order}</small>
            ${opt}
          </div>
          <div class="actions">
            <button class="icon-btn" data-act="up" data-id="${f.id}" aria-label="Subir">▲</button>
            <button class="icon-btn" data-act="down" data-id="${f.id}" aria-label="Descer">▼</button>
            <button class="icon-btn" data-act="del" data-id="${f.id}" aria-label="Remover">✕</button>
          </div>
        </div>`;
    }).join('');

    container.querySelectorAll('button[data-act]').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.id;
        if (btn.dataset.act === 'up') moveField(id, -1);
        if (btn.dataset.act === 'down') moveField(id, 1);
        if (btn.dataset.act === 'del') removeField(id);
      });
    });
  }

  return { saveMeta, addField, removeField, moveField, renderList };
})();

/* ------------------------------------------------------------
   5. Motor de renderização de campos (coleta)
   ------------------------------------------------------------ */
const FieldRenderer = (() => {
  function render(fields, container, values = {}) {
    container.innerHTML = '';
    const arr = [...fields].sort((a, b) => a.order - b.order);
    arr.forEach(f => {
      const block = document.createElement('div');
      block.className = 'field-block';
      const labelHtml = `<label for="${f.id}">${Utils.escapeHtml(f.label)} ${f.required ? '<span class="req-dot">*</span>' : ''}</label>`;
      let inputHtml = '';
      const val = values[f.id] !== undefined ? Utils.escapeHtml(values[f.id]) : '';

      switch (f.type) {
        case 'textarea':
          inputHtml = `<textarea id="${f.id}" name="${f.id}" rows="3">${val}</textarea>`;
          break;
        case 'integer':
          inputHtml = `<input type="number" step="1" id="${f.id}" name="${f.id}" value="${val}" inputmode="numeric" />`;
          break;
        case 'decimal':
          inputHtml = `<input type="number" step="any" id="${f.id}" name="${f.id}" value="${val}" inputmode="decimal" />`;
          break;
        case 'select':
          inputHtml = `<select id="${f.id}" name="${f.id}">
            <option value="">--</option>
            ${(f.options || []).map(o => `<option value="${Utils.escapeHtml(o)}" ${values[f.id] === o ? 'selected' : ''}>${Utils.escapeHtml(o)}</option>`).join('')}
          </select>`;
          break;
        case 'multiselect': {
          const selected = Array.isArray(values[f.id]) ? values[f.id] : [];
          inputHtml = `<div role="group" aria-label="${Utils.escapeHtml(f.label)}">` +
            (f.options || []).map(o =>
              `<label class="checkbox-line"><input type="checkbox" name="${f.id}" value="${Utils.escapeHtml(o)}" ${selected.includes(o) ? 'checked' : ''}/> ${Utils.escapeHtml(o)}</label>`
            ).join('') + `</div>`;
          break;
        }
        case 'date':
          inputHtml = `<input type="date" id="${f.id}" name="${f.id}" value="${val}" />`;
          break;
        case 'time':
          inputHtml = `<input type="time" id="${f.id}" name="${f.id}" value="${val}" />`;
          break;
        case 'datetime':
          inputHtml = `<input type="datetime-local" id="${f.id}" name="${f.id}" value="${val}" />`;
          break;
        case 'boolean':
          inputHtml = `<select id="${f.id}" name="${f.id}">
            <option value="">--</option>
            <option value="true" ${values[f.id] === true || values[f.id] === 'true' ? 'selected' : ''}>Sim</option>
            <option value="false" ${values[f.id] === false || values[f.id] === 'false' ? 'selected' : ''}>Não</option>
          </select>`;
          break;
        default: // text
          inputHtml = `<input type="text" id="${f.id}" name="${f.id}" value="${val}" />`;
      }
      block.innerHTML = labelHtml + inputHtml;
      container.appendChild(block);
    });
  }

  /** Coleta valores a partir do container, considerando tipos. */
  function collectValues(fields, formEl) {
    const values = {};
    fields.forEach(f => {
      if (f.type === 'multiselect') {
        const checked = formEl.querySelectorAll(`input[name="${f.id}"]:checked`);
        values[f.id] = Array.from(checked).map(c => c.value);
      } else {
        const el = formEl.querySelector(`[name="${f.id}"]`);
        if (!el) { values[f.id] = ''; return; }
        let v = el.value;
        if (f.type === 'integer') v = v === '' ? null : parseInt(v, 10);
        else if (f.type === 'decimal') v = v === '' ? null : parseFloat(v);
        else if (f.type === 'boolean') {
          v = v === '' ? null : (v === 'true');
        }
        values[f.id] = v;
      }
    });
    return values;
  }

  return { render, collectValues };
})();

/* ------------------------------------------------------------
   6. GNSS
   ------------------------------------------------------------ */
const GNSS = (() => {
  function setDisplay(coord) {
    if (!coord) {
      document.getElementById('gnssLat').textContent = '--';
      document.getElementById('gnssLon').textContent = '--';
      document.getElementById('gnssAcc').textContent = '--';
      document.getElementById('gnssAlt').textContent = '--';
      document.getElementById('gnssTime').textContent = '--';
      document.getElementById('gnssAccClass').textContent = '';
      document.querySelector('.gnss-card').className = 'card gnss-card';
      return;
    }
    const cls = Utils.classifyAccuracy(coord.acc);
    document.getElementById('gnssLat').textContent = coord.lat.toFixed(6);
    document.getElementById('gnssLon').textContent = coord.lon.toFixed(6);
    document.getElementById('gnssAcc').textContent = coord.acc !== null && coord.acc !== undefined ? `${coord.acc.toFixed(1)} m` : 'N/I';
    document.getElementById('gnssAlt').textContent = coord.alt !== null && coord.alt !== undefined ? coord.alt.toFixed(1) : '--';
    document.getElementById('gnssTime').textContent = Utils.fmtDateTime(coord.ts);
    document.getElementById('gnssAccClass').textContent = `(${cls.label})`;
    document.querySelector('.gnss-card').className = 'card gnss-card ' + cls.cardCls;

    if (cls.label === 'Baixa') {
      UI.toast('Precisão baixa. Aguarde estabilização do sinal antes de salvar.', 'warn');
    } else if (cls.label === 'Regular') {
      UI.toast('Precisão regular. Considere aguardar para melhor precisão.', 'warn');
    }
  }

  function fromPosition(pos) {
    const c = pos.coords;
    return {
      lat: c.latitude,
      lon: c.longitude,
      acc: c.accuracy,
      alt: c.altitude,
      altAcc: c.altitudeAccuracy,
      ts: new Date(pos.timestamp).toISOString(),
      source: 'gnss'
    };
  }

  function captureOnce() {
    if (!('geolocation' in navigator)) {
      UI.toast('Geolocalização não suportada neste navegador.', 'err');
      return;
    }
    UI.toast('Capturando coordenada...');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        State.currentCoord = fromPosition(pos);
        setDisplay(State.currentCoord);
        UI.toast('Coordenada capturada.', 'ok');
      },
      (err) => {
        console.error({ msg: err.message, context: 'GNSS.captureOnce' });
        let msg = 'Falha ao capturar coordenada.';
        if (err.code === 1) msg = 'Permissão de localização negada. Reative nas configurações do navegador.';
        else if (err.code === 3) msg = 'Tempo esgotado ao obter a posição. Tente novamente.';
        UI.toast(msg, 'err');
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    );
  }

  function startWatch() {
    if (!('geolocation' in navigator)) {
      UI.toast('Geolocalização não suportada.', 'err'); return;
    }
    if (State.watchId !== null) return;
    State.watchId = navigator.geolocation.watchPosition(
      (pos) => {
        State.currentCoord = fromPosition(pos);
        setDisplay(State.currentCoord);
      },
      (err) => {
        console.error({ msg: err.message, context: 'GNSS.watch' });
        UI.toast('Falha no monitoramento GNSS.', 'err');
        stopWatch();
      },
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 1000 }
    );
    UI.toast('Monitorando sinal GNSS...', 'ok');
  }

  function stopWatch() {
    if (State.watchId !== null) {
      navigator.geolocation.clearWatch(State.watchId);
      State.watchId = null;
      UI.toast('Monitoramento encerrado.');
    }
  }

  function applyManual() {
    const lat = parseFloat(document.getElementById('manualLat').value);
    const lon = parseFloat(document.getElementById('manualLon').value);
    const reason = document.getElementById('manualReason').value.trim() || 'Ajuste manual';
    if (!Utils.isValidCoord(lat, lon)) {
      UI.toast('Coordenada manual inválida. Verifique os limites.', 'err');
      return;
    }
    const original = State.currentCoord && State.currentCoord.source === 'gnss'
      ? { ...State.currentCoord } : (State.currentCoord?.manualOverride?.original || null);

    State.currentCoord = {
      lat, lon,
      acc: null, alt: null, altAcc: null,
      ts: Utils.nowISO(),
      source: 'manual',
      manualOverride: { at: Utils.nowISO(), reason },
      original
    };
    setDisplay(State.currentCoord);
    document.getElementById('manualCoord').classList.add('hidden');
    document.getElementById('manualLat').value = '';
    document.getElementById('manualLon').value = '';
    document.getElementById('manualReason').value = '';
    UI.toast('Coordenada manual aplicada.', 'ok');
  }

  return { captureOnce, startWatch, stopWatch, applyManual, setDisplay };
})();

/* ------------------------------------------------------------
   7. Validação
   ------------------------------------------------------------ */
const Validation = (() => {
  function validateRecord(form, values, coord) {
    const errors = [];
    if (!form || !form.fields) { errors.push('Formulário não configurado.'); return errors; }

    form.fields.forEach(f => {
      if (f.required) {
        const v = values[f.id];
        const empty = v === null || v === undefined || v === '' ||
                      (Array.isArray(v) && v.length === 0);
        if (empty) errors.push(`Campo obrigatório não preenchido: ${f.label}`);
      }
      // Tipagem numérica
      if (f.type === 'integer' && values[f.id] !== null && values[f.id] !== undefined) {
        if (!Number.isInteger(values[f.id])) errors.push(`Valor inteiro inválido em: ${f.label}`);
      }
      if (f.type === 'decimal' && values[f.id] !== null && values[f.id] !== undefined) {
        if (!Number.isFinite(values[f.id])) errors.push(`Valor decimal inválido em: ${f.label}`);
      }
    });

    if (!coord || !Utils.isValidCoord(coord.lat, coord.lon)) {
      errors.push('Coordenada GNSS ainda não capturada ou inválida.');
    }
    return errors;
  }
  return { validateRecord };
})();

/* ------------------------------------------------------------
   8. Mapa
   ------------------------------------------------------------ */
const Mapa = (() => {
  let initialized = false;

  function init() {
    if (initialized) return;
    try {
      State.map = L.map('map', { center: [-3.1, -60.0], zoom: 11 });
      // Tiles (apenas se online — em offline, pontos aparecem sobre fundo neutro)
      try {
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
          attribution: '© OpenStreetMap',
          maxZoom: 19
        }).addTo(State.map);
      } catch (e) {
        console.warn('Tile base indisponível; exibindo pontos sem base.');
      }
      State.mapMarkersLayer = L.layerGroup().addTo(State.map);
      initialized = true;
    } catch (e) {
      console.error({ msg: e.message, stack: e.stack, context: 'Mapa.init' });
      UI.toast('Erro ao inicializar mapa.', 'err');
    }
  }

  function buildPopup(record, form) {
    const fields = (form && form.fields) ? form.fields : [];
    const rows = fields.map(f => {
      const v = record.attributes[f.id];
      if (v === undefined || v === null || v === '' ||
          (Array.isArray(v) && v.length === 0)) return '';
      const display = Array.isArray(v) ? v.join(', ') : v;
      return `<div><strong>${Utils.escapeHtml(f.label)}:</strong> ${Utils.escapeHtml(display)}</div>`;
    }).join('');

    const title = record.attributes[fields[0]?.id] || 'Registro de campo';
    const lat = record.geometry.coordinates[1];
    const lon = record.geometry.coordinates[0];

    return `
      <div class="popup-card">
        <h3>${Utils.escapeHtml(title)}</h3>
        ${rows}
        <hr/>
        <div><strong>Latitude:</strong> ${Utils.escapeHtml(lat.toFixed(6))}</div>
        <div><strong>Longitude:</strong> ${Utils.escapeHtml(lon.toFixed(6))}</div>
        <div><strong>Precisão:</strong> ${record.gnss && record.gnss.accuracy !== null && record.gnss.accuracy !== undefined ? Utils.escapeHtml(record.gnss.accuracy.toFixed(1)) + ' m' : 'N/I'}</div>
        <div><strong>Captura:</strong> ${Utils.escapeHtml(Utils.fmtDateTime(record.gnss?.timestamp || record.createdAt))}</div>
        <div class="row">
          <button class="btn btn-ghost" data-popup-copy="${lat},${lon}">Copiar</button>
          <button class="btn btn-secondary" data-popup-edit="${record.recordId}">Editar</button>
        </div>
      </div>`;
  }

  async function refresh() {
    if (!initialized) init();
    if (!State.map) return;
    try {
      State.mapMarkersLayer.clearLayers();
      const formFilter = document.getElementById('filterForm').value;
      const catFilter = document.getElementById('filterCat').value;
      const records = await DB.getAllRecords();
      const forms = await DB.getAllForms();
      const formMap = new Map(forms.map(f => [f.formId, f]));

      const bounds = [];
      let count = 0;
      for (const r of records) {
        if (!r.geometry || !Utils.isValidCoord(r.geometry.coordinates[1], r.geometry.coordinates[0])) continue;
        if (formFilter && r.formId !== formFilter) continue;
        if (catFilter) {
          const form = formMap.get(r.formId);
          const catField = form?.fields.find(f => f.type === 'select');
          if (catField && r.attributes[catField.id] !== catFilter) continue;
        }
        const lat = r.geometry.coordinates[1];
        const lon = r.geometry.coordinates[0];
        bounds.push([lat, lon]);
        const m = L.marker([lat, lon]).addTo(State.mapMarkersLayer);
        m.bindPopup(buildPopup(r, formMap.get(r.formId)));
        count++;
      }
      if (bounds.length) {
        try { State.map.fitBounds(bounds, { padding: [30, 30] }); } catch {}
      }
      // rebind ações dos popups (delegação ao abrir)
      State.map.on('popupopen', (e) => {
        const root = e.popup.getElement();
        const copyBtn = root.querySelector('[data-popup-copy]');
        const editBtn = root.querySelector('[data-popup-edit]');
        if (copyBtn) copyBtn.addEventListener('click', () => {
          const [la, lo] = copyBtn.dataset.popupCopy.split(',');
          navigator.clipboard?.writeText(`${la}, ${lo}`).then(
            () => UI.toast('Coordenada copiada.', 'ok'),
            () => UI.toast(`Coordenada: ${la}, ${lo}`)
          );
        });
        if (editBtn) editBtn.addEventListener('click', async () => {
          const id = editBtn.dataset.popupEdit;
          await App.startEdit(id);
        });
      });
    } catch (e) {
      console.error({ msg: e.message, stack: e.stack, context: 'Mapa.refresh' });
      UI.toast('Erro ao atualizar mapa.', 'err');
    }
  }

  function centerOnMe() {
    if (!State.currentCoord || !Utils.isValidCoord(State.currentCoord.lat, State.currentCoord.lon)) {
      UI.toast('Nenhuma coordenada atual. Capture antes.', 'warn'); return;
    }
    if (!State.map) return;
    State.map.setView([State.currentCoord.lat, State.currentCoord.lon], 16);
    UI.toast('Centralizado na posição atual.', 'ok');
  }

  function fitAll() {
    refresh();
  }

  return { init, refresh, centerOnMe, fitAll };
})();

/* ------------------------------------------------------------
   9. Exportações
   ------------------------------------------------------------ */
const Exporter = (() => {

  async function gatherRecords() {
    const formFilter = document.getElementById('exportForm').value;
    let records = await DB.getAllRecords();
    if (formFilter) records = records.filter(r => r.formId === formFilter);
    const forms = await DB.getAllForms();
    const formMap = new Map(forms.map(f => [f.formId, f]));
    return { records, forms, formMap };
  }

  /** Download via Blob. */
  function download(content, filename, mime) {
    const blob = content instanceof Blob ? content : new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  }

  function nowStamp() {
    return new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
  }

  // ---- CSV ----
  async function toCSV() {
    try {
      const { records, formMap } = await gatherRecords();
      if (records.length === 0) { UI.toast('Nenhum registro para exportar.', 'warn'); return; }
      const sep = document.getElementById('csvSep').value || ';';

      // Coleta todos os campos dinâmicos (união dos forms)
      const fieldSet = new Map(); // id -> {id,label}
      records.forEach(r => {
        const f = formMap.get(r.formId);
        (f?.fields || []).forEach(fld => fieldSet.set(fld.id, { id: fld.id, label: fld.label }));
      });
      const dynFields = [...fieldSet.values()];

      const fixed = ['recordId', 'formId', 'createdAt', 'latitude', 'longitude', 'accuracy', 'altitude', 'crs'];
      const header = [...fixed, ...dynFields.map(f => f.label)];
      const esc = (v) => {
        if (v === null || v === undefined) return '';
        let s = Array.isArray(v) ? v.join('|') : String(v);
        if (s.includes(sep) || s.includes('"') || s.includes('\n')) {
          s = '"' + s.replace(/"/g, '""') + '"';
        }
        return s;
      };

      const lines = [header.map(esc).join(sep)];
      records.forEach(r => {
        const la = r.geometry?.coordinates?.[1] ?? '';
        const lo = r.geometry?.coordinates?.[0] ?? '';
        const row = [
          r.recordId, r.formId, r.createdAt,
          la, lo,
          r.gnss?.accuracy ?? '', r.gnss?.altitude ?? '',
          'EPSG:4326',
          ...dynFields.map(f => r.attributes?.[f.id] ?? '')
        ];
        lines.push(row.map(esc).join(sep));
      });

      // BOM UTF-8 p/ Excel pt-BR
      const csv = '\uFEFF' + lines.join('\r\n');
      download(csv, `coleta_${nowStamp()}.csv`, 'text/csv;charset=utf-8');
      UI.toast(`CSV exportado (${records.length} registros).`, 'ok');
    } catch (e) {
      console.error({ msg: e.message, stack: e.stack, context: 'Exporter.toCSV' });
      UI.toast('Erro ao exportar CSV.', 'err');
    }
  }

  // ---- GeoJSON ----
  async function toGeoJSON() {
    try {
      const { records, formMap } = await gatherRecords();
      if (records.length === 0) { UI.toast('Nenhum registro para exportar.', 'warn'); return; }

      const features = [];
      const noGeom = [];
      records.forEach(r => {
        const la = r.geometry?.coordinates?.[1];
        const lo = r.geometry?.coordinates?.[0];
        if (!Utils.isValidCoord(la, lo)) { noGeom.push(r.recordId); return; }
        features.push({
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [Number(lo), Number(la)] },
          properties: {
            recordId: r.recordId,
            formId: r.formId,
            createdAt: r.createdAt,
            accuracy: r.gnss?.accuracy ?? null,
            altitude: r.gnss?.altitude ?? null,
            crs: 'EPSG:4326',
            ...r.attributes
          }
        });
      });

      const fc = { type: 'FeatureCollection', features };
      download(JSON.stringify(fc, null, 2), `coleta_${nowStamp()}.geojson`, 'application/geo+json');
      let msg = `GeoJSON exportado (${features.length} feições).`;
      if (noGeom.length) msg += ` ${noGeom.length} sem coordenada foram omitidos.`;
      UI.toast(msg, features.length ? 'ok' : 'warn');
    } catch (e) {
      console.error({ msg: e.message, stack: e.stack, context: 'Exporter.toGeoJSON' });
      UI.toast('Erro ao exportar GeoJSON.', 'err');
    }
  }

  // ---- KML ----
  function escapeXml(s) {
    return String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  async function toKML() {
    try {
      const { records, formMap } = await gatherRecords();
      if (records.length === 0) { UI.toast('Nenhum registro para exportar.', 'warn'); return; }

      const placemarks = records.map(r => {
        const la = r.geometry?.coordinates?.[1];
        const lo = r.geometry?.coordinates?.[0];
        const alt = r.gnss?.altitude ?? 0;
        if (!Utils.isValidCoord(la, lo)) return '';
        const form = formMap.get(r.formId);
        const firstField = form?.fields?.[0];
        const name = (firstField && r.attributes?.[firstField.id]) || 'Registro';
        const descRows = (form?.fields || []).map(f => {
          const v = r.attributes?.[f.id];
          if (v === undefined || v === null || v === '' ||
              (Array.isArray(v) && v.length === 0)) return '';
          return `<br/><b>${escapeXml(f.label)}:</b> ${escapeXml(Array.isArray(v) ? v.join(', ') : v)}`;
        }).join('');
        const desc = `${descRows}<br/><b>Lat:</b> ${escapeXml(la.toFixed(6))}<br/><b>Lon:</b> ${escapeXml(lo.toFixed(6))}<br/><b>Precisão:</b> ${escapeXml(r.gnss?.accuracy ?? 'N/I')} m`;
        return `
      <Placemark>
        <name>${escapeXml(name)}</name>
        <description><![CDATA[${desc}]]></description>
        <Point><coordinates>${lo},${la},${alt}</coordinates></Point>
      </Placemark>`;
      }).filter(Boolean).join('');

      const kml = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>Coleta Territorial</name>
    ${placemarks}
  </Document>
</kml>`;
      download(kml, `coleta_${nowStamp()}.kml`, 'application/vnd.google-earth.kml+xml');
      UI.toast('KML exportado.', 'ok');
    } catch (e) {
      console.error({ msg: e.message, stack: e.stack, context: 'Exporter.toKML' });
      UI.toast('Erro ao exportar KML.', 'err');
    }
  }

  // ---- Shapefile (via @crmackey/shp-write) ----
  async function toShapefile() {
    try {
      const { records, formMap } = await gatherRecords();
      if (records.length === 0) { UI.toast('Nenhum registro para exportar.', 'warn'); return; }

      const validRecords = records.filter(r =>
        r.geometry && Utils.isValidCoord(r.geometry.coordinates[1], r.geometry.coordinates[0]));
      if (validRecords.length === 0) {
        UI.toast('Nenhum registro com coordenada válida.', 'warn'); return;
      }

      // Coleta todos os campos dinâmicos (união) e aplica mapeamento DBF ≤ 10 chars
      const dynFieldMap = new Map();
      validRecords.forEach(r => {
        const f = formMap.get(r.formId);
        (f?.fields || []).forEach(fld => {
          if (!dynFieldMap.has(fld.id)) dynFieldMap.set(fld.id, fld.label);
        });
      });

      const fixedFields = [
        ['recordId', 'RECORDID'],
        ['formId', 'FORMID'],
        ['createdAt', 'DATACRIA'],
        ['accuracy', 'PRECISAO'],
        ['altitude', 'ALTITUDE']
      ];
      const usedNames = new Set();
      const mapping = []; // {original, abbr}
      fixedFields.forEach(([orig, abbr]) => {
        usedNames.add(abbr);
        mapping.push({ original: orig, abbr });
      });
      dynFieldMap.forEach((label, id) => {
        const abbr = Utils.abbreviateField(label || id, usedNames);
        mapping.push({ original: label || id, abbr, fieldId: id });
      });

      // Exibe tabela de mapeamento
      showMapping(mapping);

      // Constrói GeoJSON de entrada com properties já abreviadas
      const fc = {
        type: 'FeatureCollection',
        features: validRecords.map(r => {
          const props = {};
          const setProp = (origKey, abbr, val) => {
            if (val === null || val === undefined) { props[abbr] = ''; return; }
            if (Array.isArray(val)) props[abbr] = val.join('|');
            else if (typeof val === 'object') props[abbr] = JSON.stringify(val);
            else props[abbr] = val;
          };
          fixedFields.forEach(([orig, abbr]) => {
            if (orig === 'recordId') setProp(orig, abbr, r.recordId);
            else if (orig === 'formId') setProp(orig, abbr, r.formId);
            else if (orig === 'createdAt') setProp(orig, abbr, r.createdAt);
            else if (orig === 'accuracy') setProp(orig, abbr, r.gnss?.accuracy);
            else if (orig === 'altitude') setProp(orig, abbr, r.gnss?.altitude);
          });
          dynFieldMap.forEach((label, id) => {
            const m = mapping.find(x => x.fieldId === id);
            if (m) setProp(id, m.abbr, r.attributes?.[id]);
          });
          return {
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [r.geometry.coordinates[0], r.geometry.coordinates[1]] },
            properties: props
          };
        })
      };

      // shp-write é módulo ESM: import dinâmico
      let shpwrite;
      try {
        const mod = await import('https://unpkg.com/@crmackey/shp-write@0.4.5/lib/shpwriter.esm.js');
        shpwrite = mod;
      } catch (eImp) {
        console.error({ msg: eImp.message, stack: eImp.stack, context: 'Exporter.toShapefile.import' });
        UI.toast('Biblioteca shp-write indisponível (offline?). Tente novamente online ou use GeoJSON.', 'err');
        return;
      }
      const zipFn = shpwrite.zip;

      // A API do @crmackey/shp-write: zip(geojson, options) -> Promise<Blob>
      // options.name define o basename; options.types mapeia o tipo de geometria -> nome do arquivo
      const options = {
        name: `coleta_${nowStamp()}`,
        types: { point: 'pontos' }
      };

      let result;
      try {
        result = await zipFn(fc, options);
      } catch (e1) {
        // fallback: algumas versões expõem download() que dispara saveAs; não usaremos.
        console.error({ msg: e1.message, stack: e1.stack, context: 'Exporter.toShapefile.zip' });
        throw e1;
      }

      const blob = result instanceof Blob ? result : new Blob([result], { type: 'application/zip' });
      download(blob, `coleta_${nowStamp()}.zip`, 'application/zip');
      UI.toast(`Shapefile exportado (${validRecords.length} pontos).`, 'ok');
    } catch (e) {
      console.error({ msg: e.message, stack: e.stack, context: 'Exporter.toShapefile' });
      UI.toast('Erro ao exportar Shapefile. Detalhes no console.', 'err');
    }
  }

  function showMapping(mapping) {
    const el = document.getElementById('shpMapping');
    el.innerHTML = `
      <strong>Mapeamento de campos (limite DBF = 10 caracteres):</strong>
      <table>
        <thead><tr><th>Campo original</th><th>Nome no Shapefile</th></tr></thead>
        <tbody>
          ${mapping.map(m => `<tr><td>${Utils.escapeHtml(m.original)}</td><td>${Utils.escapeHtml(m.abbr)}</td></tr>`).join('')}
        </tbody>
      </table>`;
    el.classList.remove('hidden');
  }

  return { toCSV, toGeoJSON, toKML, toShapefile };
})();

/* ------------------------------------------------------------
   10. App — orquestra tudo
   ------------------------------------------------------------ */
const App = {

  async init() {
    try {
      await DB.open();

      // Inicializa estado de formulário
      const forms = await DB.getAllForms();
      if (forms.length > 0) {
        // Usa o primeiro formulário disponível como ativo
        State.currentForm = forms[0];
        State.draftFields = JSON.parse(JSON.stringify(forms[0].fields || []));
        document.getElementById('formName').value = forms[0].name || '';
        document.getElementById('formDesc').value = forms[0].description || '';
      } else {
        // seed demo
        await this.seedDemo();
      }

      FormBuilder.renderList();
      this.bindEvents();
      this.bindNav();
      this.refreshTopbar();
      this.populateFormSelectors();
      this.showConnStatus();
      this.showProtocolInfo();
      this.maybeRequestPersist();
      this.updateStorageInfo();

      window.addEventListener('online', () => this.showConnStatus());
      window.addEventListener('offline', () => this.showConnStatus());
    } catch (e) {
      console.error({ msg: e.message, stack: e.stack, context: 'App.init' });
      UI.toast('Erro ao iniciar aplicação.', 'err');
    }
  },

  bindEvents() {
    // Form meta
    document.getElementById('formMeta').addEventListener('submit', (e) => { e.preventDefault(); FormBuilder.saveMeta(); });
    document.getElementById('addFieldBtn').addEventListener('click', () => FormBuilder.addField());
    document.getElementById('loadDemoFormBtn').addEventListener('click', async () => { await this.seedDemo(); FormBuilder.renderList(); });

    // GNSS
    document.getElementById('captureBtn').addEventListener('click', () => GNSS.captureOnce());
    document.getElementById('watchBtn').addEventListener('click', () => GNSS.startWatch());
    document.getElementById('stopWatchBtn').addEventListener('click', () => GNSS.stopWatch());
    document.getElementById('manualCoordBtn').addEventListener('click', () => {
      document.getElementById('manualCoord').classList.toggle('hidden');
    });
    document.getElementById('applyManualBtn').addEventListener('click', () => GNSS.applyManual());

    // Coleta
    document.getElementById('collectForm').addEventListener('submit', (e) => { e.preventDefault(); this.saveRecord(); });
    document.getElementById('clearFormBtn').addEventListener('click', () => {
      State.currentCoord = null;
      GNSS.setDisplay(null);
      State.editingRecordId = null;
    });

    // Mapa
    document.getElementById('centerBtn').addEventListener('click', () => Mapa.centerOnMe());
    document.getElementById('fitAllBtn').addEventListener('click', () => Mapa.fitAll());
    document.getElementById('filterForm').addEventListener('change', () => this.refreshMap());
    document.getElementById('filterCat').addEventListener('change', () => this.refreshMap());

    // Registros
    document.getElementById('searchRecords').addEventListener('input', () => this.renderRecords());

    // Export
    document.getElementById('exportCsvBtn').addEventListener('click', () => Exporter.toCSV());
    document.getElementById('exportKmlBtn').addEventListener('click', () => Exporter.toKML());
    document.getElementById('exportGeoJsonBtn').addEventListener('click', () => Exporter.toGeoJSON());
    document.getElementById('exportShpBtn').addEventListener('click', () => Exporter.toShapefile());

    // Settings
    document.getElementById('requestPersistBtn').addEventListener('click', () => this.maybeRequestPersist(true));
    document.getElementById('wipeBtn').addEventListener('click', async () => {
      const ok = await UI.confirmDialog('Apagar TODOS formulários e registros locais? Esta ação é irreversível.', { title: 'Apagar tudo' });
      if (!ok) return;
      await DB.wipeAll();
      State.currentForm = null;
      State.draftFields = [];
      document.getElementById('formName').value = '';
      document.getElementById('formDesc').value = '';
      FormBuilder.renderList();
      this.refreshTopbar();
      this.populateFormSelectors();
      UI.toast('Dados apagados.', 'ok');
    });
  },

  bindNav() {
    document.querySelectorAll('.navbtn').forEach(btn => {
      btn.addEventListener('click', () => UI.switchScreen(btn.dataset.screen));
    });
  },

  async seedDemo() {
    try {
      const now = Utils.nowISO();
      const form = {
        formId: 'form_demo_001',
        name: 'Cadastro Territorial de Campo',
        description: 'Formulário demo para coleta offline com GNSS.',
        version: '1.0.0',
        schemaVersion: 1,
        createdAt: now,
        updatedAt: now,
        fields: [
          { id: 'nome_local', label: 'Nome do local', type: 'text', required: true, options: [], order: 1 },
          { id: 'categoria',  label: 'Categoria',     type: 'select', required: true, options: ['Escola', 'Comunidade', 'Porto', 'Ponto de apoio'], order: 2 },
          { id: 'observacao', label: 'Observação',    type: 'textarea', required: false, options: [], order: 3 },
          { id: 'conforme',   label: 'Conforme?',     type: 'boolean', required: false, options: [], order: 4 }
        ]
      };
      await DB.putForm(form);
      State.currentForm = form;
      State.draftFields = JSON.parse(JSON.stringify(form.fields));
      document.getElementById('formName').value = form.name;
      document.getElementById('formDesc').value = form.description;

      // registros demo
      const demoRecords = [
        { nome_local: 'Comunidade Santa Luzia', categoria: 'Comunidade', observacao: 'Acesso por rio.', conforme: true,  lat: -3.1019, lon: -60.0250, acc: 6.2, alt: 42.1 },
        { nome_local: 'Escola Ribeirinha Sol Nascente', categoria: 'Escola', observacao: 'Visita em horário escolar.', conforme: false, lat: -3.0832, lon: -60.0411, acc: 12.4, alt: 38.5 },
        { nome_local: 'Porto do Sítio', categoria: 'Porto', observacao: 'Cais de madeira.', conforme: true, lat: -3.1198, lon: -59.9888, acc: 28.0, alt: 35.0 }
      ];
      for (const d of demoRecords) {
        await DB.putRecord({
          recordId: Utils.uid('rec'),
          formId: form.formId,
          schemaVersion: 1,
          createdAt: now,
          updatedAt: now,
          clientTimezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
          syncStatus: 'local',
          geometry: { type: 'Point', coordinates: [d.lon, d.lat] },
          gnss: { latitude: d.lat, longitude: d.lon, accuracy: d.acc, altitude: d.alt, altitudeAccuracy: null, timestamp: now, crs: 'EPSG:4326', format: 'graus decimais', source: 'gnss' },
          attributes: { nome_local: d.nome_local, categoria: d.categoria, observacao: d.observacao, conforme: d.conforme }
        });
      }
      UI.toast('Formulário e registros de exemplo carregados.', 'ok');
      this.refreshTopbar();
      this.populateFormSelectors();
    } catch (e) {
      console.error({ msg: e.message, stack: e.stack, context: 'App.seedDemo' });
    }
  },

  renderFieldsList() {
    FormBuilder.renderList();
  },

  renderCollectFields() {
    if (!State.currentForm) {
      document.getElementById('collectFields').innerHTML =
        '<p class="hint">Nenhum formulário configurado. Vá em "Form" para criar.</p>';
      return;
    }
    FieldRenderer.render(State.currentForm.fields, document.getElementById('collectFields'));
  },

  async saveRecord() {
    try {
      const form = State.currentForm;
      if (!form) { UI.toast('Nenhum formulário ativo.', 'err'); return; }

      const values = FieldRenderer.collectValues(form.fields, document.getElementById('collectForm'));
      const errors = Validation.validateRecord(form, values, State.currentCoord);
      if (errors.length) {
        UI.toast(errors[0], 'err');
        return;
      }

      const now = Utils.nowISO();
      const coord = State.currentCoord;

      let record;
      if (State.editingRecordId) {
        record = await DB.getRecord(State.editingRecordId);
      }
      if (!record) {
        record = {
          recordId: Utils.uid('rec'),
          formId: form.formId,
          schemaVersion: form.schemaVersion || 1,
          createdAt: now,
          clientTimezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
          syncStatus: 'local',
          attributes: {}
        };
      }

      record.updatedAt = now;
      record.attributes = values;
      record.gnss = {
        latitude: coord.lat,
        longitude: coord.lon,
        accuracy: coord.acc ?? null,
        altitude: coord.alt ?? null,
        altitudeAccuracy: coord.altAcc ?? null,
        timestamp: coord.ts,
        crs: 'EPSG:4326',
        format: 'graus decimais',
        source: coord.source || 'gnss'
      };
      if (coord.manualOverride) record.gnss.manualOverride = coord.manualOverride;
      if (coord.original) record.gnss.original = coord.original;
      record.geometry = { type: 'Point', coordinates: [coord.lon, coord.lat] };

      await DB.putRecord(record);
      UI.toast(State.editingRecordId ? 'Registro atualizado.' : 'Registro salvo localmente.', 'ok');
      State.editingRecordId = null;
      document.getElementById('collectForm').reset();
      State.currentCoord = null;
      GNSS.setDisplay(null);
      this.refreshTopbar();
    } catch (e) {
      console.error({ msg: e.message, stack: e.stack, context: 'App.saveRecord' });
      UI.toast('Erro ao salvar registro.', 'err');
    }
  },

  async startEdit(recordId) {
    try {
      const r = await DB.getRecord(recordId);
      if (!r) { UI.toast('Registro não encontrado.', 'err'); return; }
      const form = await DB.getForm(r.formId);
      if (form) State.currentForm = form;
      State.editingRecordId = recordId;

      // Carrega coordenada atual no estado
      State.currentCoord = {
        lat: r.gnss.latitude,
        lon: r.gnss.longitude,
        acc: r.gnss.accuracy,
        alt: r.gnss.altitude,
        altAcc: r.gnss.altitudeAccuracy,
        ts: r.gnss.timestamp,
        source: r.gnss.source,
        manualOverride: r.gnss.manualOverride,
        original: r.gnss.original
      };
      GNSS.setDisplay(State.currentCoord);

      UI.switchScreen('collect');
      FieldRenderer.render(State.currentForm.fields, document.getElementById('collectFields'), r.attributes);
      UI.toast('Editando registro.', 'ok');
    } catch (e) {
      console.error({ msg: e.message, stack: e.stack, context: 'App.startEdit' });
      UI.toast('Erro ao editar.', 'err');
    }
  },

  async deleteRecord(recordId) {
    const ok = await UI.confirmDialog('Excluir este registro?');
    if (!ok) return;
    try {
      await DB.deleteRecord(recordId);
      UI.toast('Registro excluído.', 'ok');
      this.renderRecords();
      this.refreshTopbar();
    } catch (e) {
      console.error({ msg: e.message, stack: e.stack, context: 'App.deleteRecord' });
      UI.toast('Erro ao excluir.', 'err');
    }
  },

  async renderRecords() {
    try {
      const tbody = document.getElementById('recordsBody');
      const search = (document.getElementById('searchRecords').value || '').toLowerCase();
      const records = await DB.getAllRecords();
      const forms = await DB.getAllForms();
      const formMap = new Map(forms.map(f => [f.formId, f]));

      const rows = records
        .filter(r => {
          if (!search) return true;
          const blob = JSON.stringify(r.attributes || {}).toLowerCase();
          return blob.includes(search);
        })
        .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));

      if (rows.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" class="hint">Nenhum registro.</td></tr>';
        return;
      }

      tbody.innerHTML = rows.map(r => {
        const form = formMap.get(r.formId);
        const firstField = form?.fields?.[0];
        const local = (firstField && r.attributes?.[firstField.id]) || '--';
        const la = r.geometry?.coordinates?.[1];
        const lo = r.geometry?.coordinates?.[0];
        const acc = r.gnss?.accuracy;
        return `<tr>
          <td>${Utils.escapeHtml(Utils.fmtDateTime(r.createdAt))}</td>
          <td>${Utils.escapeHtml(form?.name || '--')}</td>
          <td>${Utils.escapeHtml(local)}</td>
          <td>${la !== undefined ? la.toFixed(5) : '--'}</td>
          <td>${lo !== undefined ? lo.toFixed(5) : '--'}</td>
          <td>${acc !== null && acc !== undefined ? acc.toFixed(0) + 'm' : '--'}</td>
          <td>
            <button class="icon-btn" data-edit="${r.recordId}" aria-label="Editar">✏️</button>
            <button class="icon-btn" data-del="${r.recordId}" aria-label="Excluir">🗑️</button>
          </td>
        </tr>`;
      }).join('');

      tbody.querySelectorAll('[data-edit]').forEach(b =>
        b.addEventListener('click', () => this.startEdit(b.dataset.edit)));
      tbody.querySelectorAll('[data-del]').forEach(b =>
        b.addEventListener('click', () => this.deleteRecord(b.dataset.del)));
    } catch (e) {
      console.error({ msg: e.message, stack: e.stack, context: 'App.renderRecords' });
    }
  },

  refreshMap() { Mapa.refresh(); },

  async populateFormSelectors() {
    try {
      const forms = await DB.getAllForms();
      const opts = '<option value="">Todos</option>' +
        forms.map(f => `<option value="${f.formId}">${Utils.escapeHtml(f.name)}</option>`).join('');
      ['filterForm', 'exportForm'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.innerHTML = opts;
      });

      // categoria: primeiros campos select de todos forms
      const catSet = new Set();
      forms.forEach(f => (f.fields || []).forEach(fld => {
        if (fld.type === 'select') (fld.options || []).forEach(o => catSet.add(o));
      }));
      const catEl = document.getElementById('filterCat');
      if (catEl) catEl.innerHTML = '<option value="">Todas</option>' +
        [...catSet].map(c => `<option value="${Utils.escapeHtml(c)}">${Utils.escapeHtml(c)}</option>`).join('');
    } catch (e) {
      console.error({ msg: e.message, stack: e.stack, context: 'App.populateFormSelectors' });
    }
  },

  renderExportOptions() {
    // só re-popula, se necessário
  },

  async refreshTopbar() {
    try {
      const records = await DB.getAllRecords();
      document.getElementById('recordsCount').textContent = `${records.length} registro(s)`;
    } catch {}
  },

  showConnStatus() {
    const el = document.getElementById('connStatus');
    if (navigator.onLine) {
      el.textContent = '● Online';
      el.className = 'badge badge-ok';
    } else {
      el.textContent = '○ Offline';
      el.className = 'badge badge-warn';
    }
  },

  showProtocolInfo() {
    const el = document.getElementById('protocolInfo');
    const isHttps = location.protocol === 'https:';
    const isLocal = location.hostname === 'localhost' || location.hostname === '127.0.0.1' || location.protocol === 'file:';
    if (isHttps) {
      el.textContent = `${location.protocol} — GNSS funcionará.`;
    } else if (isLocal) {
      el.textContent = `${location.protocol}//${location.hostname} — ambiente local, GNSS deve funcionar.`;
    } else {
      el.textContent = `${location.protocol} — ATENÇÃO: GNSS é bloqueado em HTTP. Use HTTPS.`;
      UI.toast('GNSS exige HTTPS. Instale como PWA ou use HTTPS.', 'warn');
    }
  },

  async maybeRequestPersist(force = false) {
    if (!navigator.storage || !navigator.storage.persist) return;
    try {
      const already = await navigator.storage.persisted();
      if (already) {
        this.updateStorageInfo();
        return;
      }
      if (force) {
        const ok = await navigator.storage.persist();
        UI.toast(ok ? 'Armazenamento persistente ativado.' : 'Navegador negou persistência.', ok ? 'ok' : 'warn');
      }
      this.updateStorageInfo();
    } catch (e) {
      console.warn('persist error', e);
    }
  },

  async updateStorageInfo() {
    const el = document.getElementById('storageInfo');
    if (!el) return;
    if (navigator.storage && navigator.storage.estimate) {
      try {
        const est = await navigator.storage.estimate();
        const usedMB = (est.usage / 1048576).toFixed(1);
        const quotaMB = (est.quota / 1048576).toFixed(0);
        const pct = est.quota ? ((est.usage / est.quota) * 100).toFixed(0) : 0;
        el.textContent = `${usedMB} MB usados de ${quotaMB} MB (${pct}%)`;
        if (Number(pct) > 80) UI.toast('Armazenamento próximo do limite. Exporte e limpe registros antigos.', 'warn');
      } catch {
        el.textContent = 'Indisponível neste navegador.';
      }
    } else {
      el.textContent = 'Indisponível neste navegador.';
    }
  }
};

// ------------------------------------------------------------
// Bootstrap
// ------------------------------------------------------------
window.addEventListener('DOMContentLoaded', () => {
  App.init();

  // Registra Service Worker
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(err =>
      console.error('SW registration failed', err));
  }
});
