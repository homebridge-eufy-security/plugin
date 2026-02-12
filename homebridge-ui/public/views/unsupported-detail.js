/**
 * Unsupported Device Detail View — shows device info dump and guided CTA
 * for requesting support via GitHub.
 */
// eslint-disable-next-line no-unused-vars
const UnsupportedDetailView = {

  _container: null,

  /**
   * @param {HTMLElement} container
   * @param {string} id - uniqueId / serial number
   */
  async render(container, id) {
    this._container = container;
    container.innerHTML = '';

    const accessory = this._findAccessory(id);

    if (!accessory) {
      container.innerHTML = `
        <div class="text-center text-muted py-5">
          <p>Device not found.</p>
          <button class="btn btn-outline-secondary btn-sm" id="btn-back">Back to Dashboard</button>
        </div>`;
      container.querySelector('#btn-back').addEventListener('click', () => App.navigate('dashboard'));
      return;
    }

    // Header (no image for unsupported)
    this._renderHeader(container, accessory);

    // Main content
    const content = document.createElement('div');
    this._renderDetail(content, accessory);
    container.appendChild(content);
  },

  // ===== Header =====
  _renderHeader(container, accessory) {
    const header = document.createElement('div');
    header.className = 'detail-header';

    const backBtn = document.createElement('button');
    backBtn.className = 'btn btn-link p-0';
    backBtn.innerHTML = '← Back';
    backBtn.style.textDecoration = 'none';
    backBtn.addEventListener('click', () => App.navigate('dashboard'));

    const info = document.createElement('div');
    info.className = 'detail-header__info';
    info.innerHTML = `
      <h5>${Helpers.escHtml(accessory.displayName)}</h5>
      <small>${accessory.typename || ('Type ' + accessory.type)} · ${accessory.uniqueId}</small>
    `;

    header.appendChild(backBtn);
    header.appendChild(info);
    container.appendChild(header);
  },

  // ===== Detail Content =====
  _renderDetail(content, accessory) {
    const REPO = 'homebridge-plugins/homebridge-eufy-security';
    const LABEL = 'device-support';
    const COMPAT_URL = 'https://bropat.github.io/eufy-security-client/#/supported_devices';

    const section = document.createElement('div');
    section.className = 'detail-section unsupported-detail';

    // Description
    const desc = document.createElement('p');
    desc.className = 'text-muted';
    desc.innerHTML =
      '<strong>' + Helpers.iconHtml('info.svg') + ' This device was detected but is not yet supported.</strong><br />' +
      'New device support must first be added to the eufy-security-client library. ' +
      'If your device is not on the compatibility list, please <strong>search for existing issues first</strong> before opening a new one.';
    section.appendChild(desc);

    // Device info dump — all available data in one box
    const props = accessory.properties || {};
    const deviceInfo = {
      uniqueId: accessory.uniqueId,
      displayName: accessory.displayName,
      type: accessory.type,
      typename: accessory.typename || undefined,
      ...props,
    };
    // Remove potentially large/sensitive fields
    delete deviceInfo.picture;

    // CTA stepper + buttons
    const stepsWrap = document.createElement('div');
    stepsWrap.className = 'unsupported-detail__steps';

    // Stepper frieze
    const stepper = document.createElement('div');
    stepper.className = 'unsupported-stepper';
    const steps = [
      { num: '1', label: 'Check', color: 'success' },
      { num: '2', label: 'Search', color: 'primary' },
      { num: '3', label: 'Create', color: 'danger' },
    ];
    steps.forEach((step, i) => {
      const stepEl = document.createElement('div');
      stepEl.className = 'unsupported-stepper__step';
      stepEl.innerHTML = `<span class="unsupported-stepper__circle unsupported-stepper__circle--${step.color}">${step.num}</span><span class="unsupported-stepper__label">${step.label}</span>`;
      stepper.appendChild(stepEl);
      if (i < steps.length - 1) {
        const line = document.createElement('div');
        line.className = 'unsupported-stepper__line';
        stepper.appendChild(line);
      }
    });
    stepsWrap.appendChild(stepper);

    // Buttons row
    const btnGroup = document.createElement('div');
    btnGroup.className = 'unsupported-detail__actions';

    // 1) Check compatibility list
    const compatBtn = document.createElement('a');
    compatBtn.href = COMPAT_URL;
    compatBtn.target = '_blank';
    compatBtn.rel = 'noopener noreferrer';
    compatBtn.className = 'btn btn-success';
    compatBtn.textContent = 'Check Compatibility ↗';
    btnGroup.appendChild(compatBtn);

    // 2) Search existing issues with label
    const searchQuery = encodeURIComponent(`is:issue label:${LABEL} ${accessory.type}`);
    const searchBtn = document.createElement('a');
    searchBtn.href = `https://github.com/${REPO}/issues?q=${searchQuery}`;
    searchBtn.target = '_blank';
    searchBtn.rel = 'noopener noreferrer';
    searchBtn.className = 'btn btn-outline-primary';
    searchBtn.textContent = 'Search Existing Issues ↗';
    btnGroup.appendChild(searchBtn);

    // 3) Create new issue using the device_support template
    const model = props.model || accessory.type;
    const issueTitle = encodeURIComponent(`[Device Support] ${model} (Type ${accessory.type})`);
    const deviceDump = JSON.stringify(deviceInfo, null, 2);
    const templateParams = [
      `template=device_support.yml`,
      `title=${issueTitle}`,
      `labels=${LABEL}`,
      `device_info=${encodeURIComponent(deviceDump)}`,
    ].join('&');
    const createBtn = document.createElement('a');
    createBtn.href = `https://github.com/${REPO}/issues/new?${templateParams}`;
    createBtn.target = '_blank';
    createBtn.rel = 'noopener noreferrer';
    createBtn.className = 'btn btn-outline-danger';
    createBtn.textContent = 'Create an Issue ↗';
    btnGroup.appendChild(createBtn);

    stepsWrap.appendChild(btnGroup);
    section.appendChild(stepsWrap);

    // External links note
    const extNote = document.createElement('p');
    extNote.className = 'text-muted';
    extNote.style.cssText = 'font-size: 0.75rem; text-align: right;';
    extNote.textContent = '↗ These links open in a new browser tab on GitHub.';
    section.appendChild(extNote);

    const infoTitle = document.createElement('div');
    infoTitle.className = 'detail-section__title';
    infoTitle.textContent = 'Device Information';
    section.appendChild(infoTitle);

    // JSON dump with copy button overlay
    const dumpWrap = document.createElement('div');
    dumpWrap.className = 'unsupported-detail__dump-wrap';

    const copyBtn = document.createElement('button');
    copyBtn.className = 'unsupported-detail__copy-btn';

    const _setCopyLabel = (text) => {
      copyBtn.innerHTML = '';
      copyBtn.appendChild(Helpers.icon('copy.svg'));
      copyBtn.append(' ' + text);
    };
    _setCopyLabel('Copy');

    copyBtn.addEventListener('click', () => {
      navigator.clipboard.writeText(pre.textContent).then(() => {
        copyBtn.textContent = '✓ Copied!';
        setTimeout(() => { _setCopyLabel('Copy'); }, 2000);
      });
    });

    const pre = document.createElement('pre');
    pre.className = 'unsupported-detail__dump';
    pre.textContent = JSON.stringify(deviceInfo, null, 2);

    dumpWrap.appendChild(copyBtn);
    dumpWrap.appendChild(pre);
    section.appendChild(dumpWrap);

    content.appendChild(section);
  },

  // ===== Helpers =====

  /**
   * Find an accessory (device or station) by uniqueId across all stations.
   * For unsupported standalone stations the device may be null, so we fall back to the station.
   * @param {string} id
   * @returns {object|null}
   */
  _findAccessory(id) {
    const stations = App.state.stations || [];
    for (const s of stations) {
      if (s.uniqueId === id) return s;
      for (const d of s.devices || []) {
        if (d.uniqueId === id) return d;
      }
    }
    return null;
  },
};
