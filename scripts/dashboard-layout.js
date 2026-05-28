export function createDashboardShell({
  eyebrow,
  title,
  description,
  actions = '',
  body = '',
  status = ''
} = {}) {
  return `
    <div class="dashboard-shell">
      ${createDashboardHeader({ eyebrow, title, description, actions })}
      ${status ? createDashboardStatus(status) : ''}
      <div class="dashboard-content">
        ${body}
      </div>
    </div>
  `;
}

export function createDashboardHeader({ eyebrow, title, description, actions = '' } = {}) {
  return `
    <section class="view-header dashboard-header" aria-labelledby="view-title">
      <div>
        ${eyebrow ? `<p class="eyebrow">${escapeHtml(eyebrow)}</p>` : ''}
        <h1 id="view-title">${escapeHtml(title || 'Dashboard')}</h1>
        ${description ? `<p>${escapeHtml(description)}</p>` : ''}
      </div>
      ${actions ? `<div class="dashboard-header-actions">${actions}</div>` : ''}
    </section>
  `;
}

export function createDashboardStatus({ text, tone = '', busy = false } = {}) {
  return `
    <section class="dashboard-status" role="status" aria-live="polite" aria-busy="${busy ? 'true' : 'false'}"${tone ? ` data-tone="${escapeHtml(tone)}"` : ''}>
      ${escapeHtml(text || '')}
    </section>
  `;
}

export function createMetricGrid(metrics = [], { label = 'Dashboard metrics' } = {}) {
  return `
    <section class="metrics-grid" aria-label="${escapeHtml(label)}">
      ${metrics.map((metric) => createMetricCard(metric)).join('')}
    </section>
  `;
}

export function createMetricCard({ label, value, detail = '', state = '' } = {}) {
  return `
    <article class="metric-card"${state ? ` data-state="${escapeHtml(state)}"` : ''}>
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(formatMetricValue(value))}</strong>
      ${detail ? `<small>${escapeHtml(detail)}</small>` : ''}
    </article>
  `;
}

export function createDashboardSection({
  title,
  description = '',
  body = '',
  aside = '',
  empty = false
} = {}) {
  return `
    <section class="panel dashboard-section${empty ? ' dashboard-section-empty' : ''}" aria-labelledby="${toDomId(title)}">
      <div class="dashboard-section-header">
        <div>
          <h2 id="${toDomId(title)}">${escapeHtml(title || 'Section')}</h2>
          ${description ? `<p>${escapeHtml(description)}</p>` : ''}
        </div>
        ${aside || ''}
      </div>
      ${body}
    </section>
  `;
}

export function createActionList(items = []) {
  if (!items.length) {
    return createEmptyState('No actions available', 'This area is ready for future workflow actions.');
  }

  return `
    <ul class="dashboard-action-list">
      ${items.map((item) => `
        <li>
          <a href="${escapeHtml(item.href || '#dashboard')}"${item.disabled ? ' aria-disabled="true" tabindex="-1"' : ''}>
            <span>
              <strong>${escapeHtml(item.label)}</strong>
              ${item.description ? `<small>${escapeHtml(item.description)}</small>` : ''}
            </span>
            <span class="status-pill"${item.state ? ` data-state="${escapeHtml(item.state)}"` : ''}>${escapeHtml(item.badge || 'Open')}</span>
          </a>
        </li>
      `).join('')}
    </ul>
  `;
}

export function createKeyValueList(items = []) {
  return `
    <dl class="dashboard-key-values">
      ${items.map(([label, value]) => `
        <div>
          <dt>${escapeHtml(label)}</dt>
          <dd>${escapeHtml(value || 'Not set')}</dd>
        </div>
      `).join('')}
    </dl>
  `;
}

export function createCompactList(items = [], { emptyTitle, emptyDescription } = {}) {
  if (!items.length) {
    return createEmptyState(emptyTitle || 'Nothing to show', emptyDescription || 'New records will appear here.');
  }

  return `
    <ul class="dashboard-compact-list">
      ${items.map((item) => `
        <li>
          <span>
            <strong>${escapeHtml(item.title)}</strong>
            ${item.description ? `<small>${escapeHtml(item.description)}</small>` : ''}
          </span>
          ${item.badge ? `<span class="status-pill"${item.state ? ` data-state="${escapeHtml(item.state)}"` : ''}>${escapeHtml(item.badge)}</span>` : ''}
        </li>
      `).join('')}
    </ul>
  `;
}

export function createEmptyState(title, description = '') {
  return `
    <article class="empty-state">
      <strong>${escapeHtml(title)}</strong>
      ${description ? `<span>${escapeHtml(description)}</span>` : ''}
    </article>
  `;
}

export function formatDate(value) {
  if (!value) {
    return 'Not recorded';
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Not recorded' : date.toLocaleDateString();
}

export function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function formatMetricValue(value) {
  if (value === null || typeof value === 'undefined') {
    return '--';
  }

  return value;
}

function toDomId(value) {
  return String(value || 'dashboard-section')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'dashboard-section';
}
