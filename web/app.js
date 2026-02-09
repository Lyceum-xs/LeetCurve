/**
 * LeetCurve — Web Dashboard Application
 * ======================================
 * 完全独立运行的 Web 前端，内嵌存储适配层 + 艾宾浩斯算法。
 * - 在 Chrome 扩展上下文中：使用 chrome.storage.local（与插件共享数据）
 * - 在独立 Web 环境中：使用 localStorage（零依赖独立运行）
 */

'use strict';

/* ================================================================
 *  常量 & 算法（与 background.js 保持一致）
 * ================================================================ */

const REVIEW_STAGES = [
  { label: '第1次复习', interval: 24 },
  { label: '第2次复习', interval: 48 },
  { label: '第3次复习', interval: 96 },
  { label: '第4次复习', interval: 168 },
  { label: '第5次复习', interval: 360 },
  { label: '第6次复习', interval: 720 },
  { label: '已掌握',    interval: Infinity }
];

const DIFF_WEIGHTS = { Easy: 0.8, Medium: 1.0, Hard: 1.5 };
const COOLDOWN_MS  = 3600000; // 1 小时

/* ================================================================
 *  存储适配层（StorageAdapter）
 * ================================================================ */

const isExtension = (typeof chrome !== 'undefined' &&
  chrome.storage && chrome.storage.local);

const Storage = {
  async get(key) {
    if (isExtension) {
      return new Promise(resolve => {
        chrome.storage.local.get(key, res => resolve(res[key]));
      });
    }
    try {
      const raw = localStorage.getItem(`lc_${key}`);
      return raw ? JSON.parse(raw) : undefined;
    } catch { return undefined; }
  },

  async set(key, value) {
    if (isExtension) {
      return new Promise(resolve => {
        chrome.storage.local.set({ [key]: value }, resolve);
      });
    }
    localStorage.setItem(`lc_${key}`, JSON.stringify(value));
  },

  async getAll() {
    const problems   = (await this.get('problems'))   || {};
    const settings    = (await this.get('settings'))    || { tagWeights: {} };
    const activityLog = (await this.get('activityLog')) || {};
    return { problems, settings, activityLog };
  },

  async setAll({ problems, settings, activityLog }) {
    if (problems !== undefined)   await this.set('problems', problems);
    if (settings !== undefined)   await this.set('settings', settings);
    if (activityLog !== undefined) await this.set('activityLog', activityLog);
  }
};

/* ================================================================
 *  算法层
 * ================================================================ */

function calcPriority(problem, tagWeights = {}) {
  if (problem.stage >= REVIEW_STAGES.length - 1) return -Infinity;

  const interval = REVIEW_STAGES[problem.stage].interval * 3600000;
  const elapsed  = Date.now() - problem.last_review_time;
  // 钳制到 >= 0：未到期的题目优先级为 0，不会产生负值排序混乱
  const ratio    = Math.max(0, (elapsed - interval) / interval);
  const dw       = DIFF_WEIGHTS[problem.difficulty] || 1.0;

  let tw = 1.0;
  (problem.tags || []).forEach(t => {
    if (tagWeights[t] > tw) tw = tagWeights[t];
  });

  return ratio * dw * tw;
}

function refreshPriorities(problems, tagWeights) {
  for (const slug of Object.keys(problems)) {
    problems[slug].priority_score = calcPriority(problems[slug], tagWeights);
  }
  return problems;
}

/* ================================================================
 *  应用状态
 * ================================================================ */

let state = {
  problems: {},
  settings: { tagWeights: {} },
  activityLog: {},
  currentView: 'dashboard',
  noteSlug: null
};

/* ================================================================
 *  初始化
 * ================================================================ */

document.addEventListener('DOMContentLoaded', boot);

async function boot() {
  // 加载数据
  const data = await Storage.getAll();
  state.problems   = data.problems;
  state.settings    = data.settings;
  state.activityLog = data.activityLog;
  state.problems = refreshPriorities(state.problems, state.settings.tagWeights);

  // 环境标识
  const badge = document.getElementById('env-badge');
  badge.textContent = isExtension ? '🔗 已连接 Chrome 扩展' : '🌐 独立 Web 模式';

  bindEvents();
  renderAll();
}

/* ================================================================
 *  事件绑定
 * ================================================================ */

function bindEvents() {
  // 侧栏导航
  document.querySelectorAll('.nav-item').forEach(btn => {
    btn.addEventListener('click', () => navigateTo(btn.dataset.view));
  });

  // 导出/导入（顶栏 + 设置内）
  document.getElementById('btn-export').addEventListener('click', exportData);
  document.getElementById('btn-import').addEventListener('click', () =>
    document.getElementById('import-file').click());
  document.getElementById('import-file').addEventListener('change', importData);

  const e2 = document.getElementById('btn-export-2');
  const i2 = document.getElementById('btn-import-2');
  if (e2) e2.addEventListener('click', exportData);
  if (i2) i2.addEventListener('click', () =>
    document.getElementById('import-file').click());

  document.getElementById('btn-clear')?.addEventListener('click', clearAllData);

  // 队列筛选
  ['queue-search', 'queue-filter-tag', 'queue-filter-diff', 'queue-filter-status']
    .forEach(id => {
      const el = document.getElementById(id);
      el.addEventListener(id === 'queue-search' ? 'input' : 'change', renderQueue);
    });

  // 添加题目
  document.getElementById('add-form').addEventListener('submit', handleAddProblem);

  // 标签权重
  document.getElementById('stag-add').addEventListener('click', handleAddTagWeight);
  document.getElementById('stag-name').addEventListener('keypress', e => {
    if (e.key === 'Enter') handleAddTagWeight();
  });

  // 笔记弹窗
  document.getElementById('note-close').addEventListener('click', closeNote);
  document.getElementById('note-cancel').addEventListener('click', closeNote);
  document.getElementById('note-save').addEventListener('click', saveNote);
  document.getElementById('note-modal').addEventListener('click', e => {
    if (e.target.classList.contains('modal-overlay')) closeNote();
  });

  // 弹窗内 tab 切换（笔记 / 代码）
  document.querySelectorAll('.modal-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.modal-tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.modal-tab-panel').forEach(p => p.classList.remove('active'));
      tab.classList.add('active');
      document.getElementById(`panel-${tab.dataset.modalTab}`).classList.add('active');
    });
  });

  // 代码历史导航
  document.getElementById('code-history-prev')?.addEventListener('click', () => {
    if (codeHistoryIndex > 0) {
      codeHistoryIndex--;
      document.getElementById('code-textarea').value = currentCodeHistory[codeHistoryIndex].code || '';
      updateCodeHistoryLabel();
    }
  });
  document.getElementById('code-history-next')?.addEventListener('click', () => {
    if (codeHistoryIndex < currentCodeHistory.length - 1) {
      codeHistoryIndex++;
      document.getElementById('code-textarea').value = currentCodeHistory[codeHistoryIndex].code || '';
      updateCodeHistoryLabel();
    }
  });

  // 已完成列表：搜索和筛选
  document.getElementById('completed-search-web')?.addEventListener('input', (e) => {
    completedSearchText = e.target.value;
    renderCompleted();
  });

  document.getElementById('completed-tag-btn-web')?.addEventListener('click', () => {
    const dropdown = document.getElementById('completed-tag-dropdown-web');
    if (dropdown) {
      dropdown.style.display = dropdown.style.display === 'none' ? 'block' : 'none';
    }
  });

  document.getElementById('completed-tag-clear-web')?.addEventListener('click', () => {
    completedSelectedTags.clear();
    renderCompleted();
  });

  // 点击页面其他地方关闭标签筛选下拉框
  document.addEventListener('click', (e) => {
    const dropdown = document.getElementById('completed-tag-dropdown-web');
    const btn = document.getElementById('completed-tag-btn-web');
    if (dropdown && btn && !dropdown.contains(e.target) && !btn.contains(e.target)) {
      dropdown.style.display = 'none';
    }
  });

  // 仪表盘快捷跳转
  document.getElementById('dash-go-queue')?.addEventListener('click', () => navigateTo('queue'));
  document.getElementById('dash-go-heatmap')?.addEventListener('click', () => navigateTo('heatmap'));
}

/* ================================================================
 *  导航
 * ================================================================ */

const VIEW_TITLES = {
  dashboard: '仪表盘',
  queue: '复习队列',
  completed: '已完成',
  mastered: '已掌握',
  recent: '近一周动态',
  heatmap: '热力图',
  add: '添加题目',
  settings: '设置'
};

function navigateTo(view) {
  state.currentView = view;

  // 更新侧栏
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.querySelector(`.nav-item[data-view="${view}"]`)?.classList.add('active');

  // 切换视图
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.getElementById(`view-${view}`)?.classList.add('active');

  // 标题
  document.getElementById('topbar-title').textContent = VIEW_TITLES[view] || '';

  // 视图特定渲染
  if (view === 'queue') renderQueue();
  if (view === 'completed') renderCompleted();
  if (view === 'mastered') renderMastered();
  if (view === 'recent') renderRecent();
  if (view === 'heatmap') { renderHeatmap(); renderHeatmapStats(); }
  if (view === 'settings') { renderTagWeights(); renderStagesInfo(); }
  if (view === 'dashboard') renderDashboard();
}

/* ================================================================
 *  全局渲染
 * ================================================================ */

function renderAll() {
  renderDashboard();
  renderQueue();
  renderCompleted();
  renderMastered();
  renderRecent();
  populateTagFilter();
  renderHeatmap();
  renderHeatmapStats();
  renderTagWeights();
  renderStagesInfo();
  updateNavBadge();
}

function updateNavBadge() {
  const all = Object.values(state.problems);
  const due = all.filter(p => p.priority_score > 0 && p.stage < REVIEW_STAGES.length - 1).length;
  const completed = all.length;
  const mastered = all.filter(p => p.stage >= REVIEW_STAGES.length - 1).length;

  const dueBadge = document.getElementById('nav-badge-due');
  if (due > 0) {
    dueBadge.textContent = due;
    dueBadge.classList.add('show');
  } else {
    dueBadge.classList.remove('show');
  }

  const completedBadge = document.getElementById('nav-badge-completed');
  if (completedBadge && completed > 0) {
    completedBadge.textContent = completed;
    completedBadge.classList.add('show');
  } else if (completedBadge) {
    completedBadge.classList.remove('show');
  }

  const masteredBadge = document.getElementById('nav-badge-mastered');
  if (masteredBadge) {
    if (mastered > 0) {
      masteredBadge.textContent = mastered;
      masteredBadge.classList.add('show');
    } else {
      masteredBadge.classList.remove('show');
    }
  }
}

/* ================================================================
 *  仪表盘
 * ================================================================ */

function renderDashboard() {
  const all = Object.values(state.problems);
  const total = all.length;
  const mastered = all.filter(p => p.stage >= REVIEW_STAGES.length - 1).length;
  const due = all.filter(p => p.priority_score > 0 && p.stage < REVIEW_STAGES.length - 1).length;

  const dueEl = document.getElementById('dash-due');
  const totalEl = document.getElementById('dash-total');
  const masteredEl = document.getElementById('dash-mastered');
  const streakEl = document.getElementById('dash-streak');

  dueEl.textContent = due;
  totalEl.textContent = total;
  masteredEl.textContent = mastered;
  streakEl.textContent = calcStreak();

  // 总题数点击跳转到已完成列表
  totalEl.style.cursor = 'pointer';
  totalEl.onclick = () => navigateTo('completed');

  // 最紧急列表
  const urgent = all
    .filter(p => p.priority_score > 0 && p.stage < REVIEW_STAGES.length - 1)
    .sort((a, b) => b.priority_score - a.priority_score)
    .slice(0, 6);

  const urgentEl = document.getElementById('dash-urgent-list');
  if (urgent.length === 0) {
    urgentEl.innerHTML = '<p class="text-muted" style="padding:8px 0">🎉 暂无逾期题目，做得好！</p>';
  } else {
    urgentEl.innerHTML = urgent.map(p => {
      const name = p.questionId ? `${p.questionId}. ${p.title}` : p.title;
      const fb = p.origin === 'cn' ? 'https://leetcode.cn' : 'https://leetcode.com';
      const url = p.url || `${fb}/problems/${p.slug}/`;
      return `<div class="urgent-item">
        <span class="diff-badge ${p.difficulty.toLowerCase()}">${p.difficulty[0]}</span>
        <a href="${esc(url)}" target="_blank" rel="noopener">${esc(name)}</a>
        <span class="urgent-overdue">${getTimeStr(p)}</span>
      </div>`;
    }).join('');
  }

  // 难度分布
  const counts = { Easy: 0, Medium: 0, Hard: 0 };
  all.forEach(p => { counts[p.difficulty] = (counts[p.difficulty] || 0) + 1; });
  const diffEl = document.getElementById('dash-difficulty');
  if (total === 0) {
    diffEl.innerHTML = '<p class="text-muted">暂无数据</p>';
  } else {
    diffEl.innerHTML = ['Easy', 'Medium', 'Hard'].map(d => {
      const pct = total > 0 ? (counts[d] / total * 100) : 0;
      const colors = { Easy: 'var(--easy)', Medium: 'var(--medium)', Hard: 'var(--hard)' };
      return `<div class="diff-bar-row">
        <span class="diff-bar-label" style="color:${colors[d]}">${d}</span>
        <div class="diff-bar-track">
          <div class="diff-bar-fill" style="width:${pct}%;background:${colors[d]}"></div>
        </div>
        <span class="diff-bar-count">${counts[d]}</span>
      </div>`;
    }).join('');
  }

  // 阶段分布
  const stageCounts = new Array(REVIEW_STAGES.length).fill(0);
  all.forEach(p => { if (p.stage < stageCounts.length) stageCounts[p.stage]++; });
  const stgEl = document.getElementById('dash-stages');
  if (total === 0) {
    stgEl.innerHTML = '<p class="text-muted">暂无数据</p>';
  } else {
    stgEl.innerHTML = REVIEW_STAGES.map((s, i) => {
      const pct = total > 0 ? (stageCounts[i] / total * 100) : 0;
      return `<div class="stage-bar-row">
        <span class="stage-bar-label">${s.label}</span>
        <div class="stage-bar-track">
          <div class="stage-bar-fill" style="width:${pct}%"></div>
        </div>
        <span class="stage-bar-count">${stageCounts[i]}</span>
      </div>`;
    }).join('');
  }

  // Mini heatmap (last 90 days)
  renderMiniHeatmap();
}

function renderMiniHeatmap() {
  const grid = document.getElementById('dash-mini-heatmap');
  if (!grid) return;
  grid.innerHTML = '';

  const today = new Date(); today.setHours(0, 0, 0, 0);
  const start = new Date(today);
  start.setDate(start.getDate() - 89);
  start.setDate(start.getDate() - start.getDay());

  const cur = new Date(start);
  while (cur <= today) {
    const ds = fmtDate(cur);
    const cnt = state.activityLog[ds] || 0;
    const cell = document.createElement('div');
    cell.className = `heatmap-cell level-${hmLevel(cnt)}`;
    cell.title = `${ds}：${cnt} 次`;
    grid.appendChild(cell);
    cur.setDate(cur.getDate() + 1);
  }
  // 补齐
  const rem = 7 - (grid.children.length % 7);
  if (rem < 7) for (let i = 0; i < rem; i++) {
    const c = document.createElement('div');
    c.className = 'heatmap-cell level-0';
    c.style.visibility = 'hidden';
    grid.appendChild(c);
  }
}

/* ================================================================
 *  复习队列
 * ================================================================ */

function renderQueue() {
  const container = document.getElementById('queue-grid');
  const search = (document.getElementById('queue-search')?.value || '').toLowerCase();
  const tagF = document.getElementById('queue-filter-tag')?.value || '';
  const diffF = document.getElementById('queue-filter-diff')?.value || '';
  const statusF = document.getElementById('queue-filter-status')?.value || 'due';

  let list = Object.values(state.problems);

  // 状态筛选
  if (statusF === 'due') {
    list = list.filter(p => p.priority_score > 0 && p.stage < REVIEW_STAGES.length - 1);
  } else if (statusF === 'mastered') {
    list = list.filter(p => p.stage >= REVIEW_STAGES.length - 1);
  }

  if (tagF)  list = list.filter(p => (p.tags || []).includes(tagF));
  if (diffF) list = list.filter(p => p.difficulty === diffF);
  if (search) {
    list = list.filter(p =>
      (p.title || '').toLowerCase().includes(search) ||
      (p.questionId || '').includes(search) ||
      (p.slug || '').includes(search)
    );
  }

  list.sort((a, b) => b.priority_score - a.priority_score);

  if (list.length === 0) {
    container.innerHTML = `<div class="empty-state">
      <div class="empty-icon">${statusF === 'due' ? '🎉' : '📚'}</div>
      <p class="empty-title">${statusF === 'due' ? '暂无待复习题目' : '没有匹配的题目'}</p>
      <p class="empty-hint">${statusF === 'due' ? '所有题目都已按时复习！' : '试试修改筛选条件'}</p>
    </div>`;
    return;
  }

  container.innerHTML = list.map(p => buildQCard(p)).join('');

  // 绑定文字按钮操作
  container.querySelectorAll('.act-note').forEach(b =>
    b.addEventListener('click', (e) => { e.stopPropagation(); openNote(b.dataset.slug); }));
  container.querySelectorAll('.act-reset').forEach(b =>
    b.addEventListener('click', (e) => { e.stopPropagation(); resetProblem(b.dataset.slug); }));
  container.querySelectorAll('.act-delete').forEach(b =>
    b.addEventListener('click', (e) => { e.stopPropagation(); deleteProblem(b.dataset.slug); }));

  // 卡片中间空白区域点击 → 打开笔记弹窗
  container.querySelectorAll('.q-body').forEach(body => {
    body.addEventListener('click', (e) => {
      if (e.target.closest('a') || e.target.closest('button')) return;
      openNote(body.dataset.slug);
    });
  });
}

function buildQCard(p) {
  const isOverdue = p.priority_score > 0 && p.stage < REVIEW_STAGES.length - 1;
  const isMastered = p.stage >= REVIEW_STAGES.length - 1;
  const cls = isOverdue ? 'overdue' : (isMastered ? '' : 'upcoming');
  const name = p.questionId ? `${p.questionId}. ${p.title}` : p.title;
  const fallbackBase = p.origin === 'cn' ? 'https://leetcode.cn' : 'https://leetcode.com';
  const url = p.url || `${fallbackBase}/problems/${p.slug}/`;
  const diffCls = (p.difficulty || 'Medium').toLowerCase();
  const stageLabel = REVIEW_STAGES[Math.min(p.stage, REVIEW_STAGES.length - 1)].label;

  const dots = Array.from({ length: REVIEW_STAGES.length - 1 }, (_, i) => {
    if (i < p.stage)      return '<div class="q-stage-dot filled"></div>';
    if (i === p.stage)    return '<div class="q-stage-dot current"></div>';
    return '<div class="q-stage-dot"></div>';
  }).join('');

  const tags = (p.tags || []).slice(0, 6)
    .map(t => `<span class="q-tag">${esc(t)}</span>`).join('');

  const note = p.note
    ? `<div class="q-note-preview">${esc(p.note.substring(0, 120))}</div>` : '';

  const codeIndicator = p.code
    ? '<span class="q-code-indicator">💻 已有代码</span>' : '';

  const score = (typeof p.priority_score === 'number' && isFinite(p.priority_score))
    ? p.priority_score.toFixed(2) : '—';

  return `<div class="q-card ${cls}" data-slug="${p.slug}">
    <div class="q-top">
      <a class="q-title" href="${esc(url)}" target="_blank" rel="noopener" title="${esc(name)}">${esc(name)}</a>
      <span class="diff-badge ${diffCls}">${p.difficulty}</span>
    </div>
    <div class="q-actions">
      <a class="q-act-btn q-act-goto" href="${esc(url)}" target="_blank" rel="noopener" title="在新标签页打开">
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M10.5 1.5L5 7M10.5 1.5H7.5M10.5 1.5V4.5M5.5 2.5H2.5C1.95 2.5 1.5 2.95 1.5 3.5V9.5C1.5 10.05 1.95 10.5 2.5 10.5H8.5C9.05 10.5 9.5 10.05 9.5 9.5V6.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg>
        跳转
      </a>
      <button class="q-act-btn q-act-note act-note" data-slug="${p.slug}" title="编辑笔记与代码">
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M8.5 1.5L10.5 3.5L4 10H2V8L8.5 1.5Z" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg>
        笔记
      </button>
      <button class="q-act-btn q-act-reset act-reset" data-slug="${p.slug}" title="重置复习阶段">
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M1.5 2V5H4.5M10.5 10V7H7.5M1.7 7A4.5 4.5 0 0 0 10.3 5M10.3 5L10.5 5M1.7 7L1.5 7" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg>
        重置
      </button>
      <button class="q-act-btn q-act-delete act-delete" data-slug="${p.slug}" title="删除题目">
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M1.5 3.5H10.5M4.5 5.5V8.5M7.5 5.5V8.5M2.5 3.5L3 10C3 10.28 3.22 10.5 3.5 10.5H8.5C8.78 10.5 9 10.28 9 10L9.5 3.5M4.5 3.5V2C4.5 1.72 4.72 1.5 5 1.5H7C7.28 1.5 7.5 1.72 7.5 2V3.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg>
        删除
      </button>
    </div>
    <div class="q-body" data-slug="${p.slug}">
      <div class="q-meta">
        <span class="${isOverdue ? 'q-meta-overdue' : 'q-meta-upcoming'}">⏱ ${getTimeStr(p)}</span>
        <span>📊 ${stageLabel}</span>
        <span>P: ${score}</span>
        ${codeIndicator}
        <div class="q-stage-bar">${dots}</div>
      </div>
      ${tags ? `<div class="q-tags">${tags}</div>` : ''}
      ${note}
    </div>
  </div>`;
}

/* ================================================================
 *  标签筛选器
 * ================================================================ */

function populateTagFilter() {
  const sel = document.getElementById('queue-filter-tag');
  if (!sel) return;
  const val = sel.value;
  const tags = new Set();
  Object.values(state.problems).forEach(p => (p.tags || []).forEach(t => tags.add(t)));
  sel.innerHTML = '<option value="">全部标签</option>';
  [...tags].sort().forEach(t => {
    const o = document.createElement('option');
    o.value = t; o.textContent = t;
    if (t === val) o.selected = true;
    sel.appendChild(o);
  });
}

/* ================================================================
 *  热力图
 * ================================================================ */

function renderHeatmap() {
  const grid = document.getElementById('hm-grid');
  const monthsEl = document.getElementById('hm-months');
  if (!grid || !monthsEl) return;
  grid.innerHTML = '';
  monthsEl.innerHTML = '';

  const today = new Date(); today.setHours(0, 0, 0, 0);
  const start = new Date(today);
  start.setDate(start.getDate() - 364);
  start.setDate(start.getDate() - start.getDay());

  const cur = new Date(start);
  let weekIdx = 0, lastMonth = -1;
  const months = [];

  while (cur <= today) {
    const ds = fmtDate(cur);
    const cnt = state.activityLog[ds] || 0;
    const cell = document.createElement('div');
    cell.className = `heatmap-cell level-${hmLevel(cnt)}`;
    cell.title = `${ds}：${cnt} 次活动`;
    grid.appendChild(cell);

    if (cur.getDay() === 0) {
      if (cur.getMonth() !== lastMonth) {
        months.push({ week: weekIdx, month: cur.getMonth() });
        lastMonth = cur.getMonth();
      }
      weekIdx++;
    }
    cur.setDate(cur.getDate() + 1);
  }

  const rem = 7 - (grid.children.length % 7);
  if (rem < 7) for (let i = 0; i < rem; i++) {
    const c = document.createElement('div');
    c.className = 'heatmap-cell level-0'; c.style.visibility = 'hidden';
    grid.appendChild(c);
  }

  const MNAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const cellPx = 15; // 12 + 3 gap
  months.forEach(({ week, month }) => {
    const sp = document.createElement('span');
    sp.textContent = MNAMES[month];
    sp.style.left = `${week * cellPx}px`;
    monthsEl.appendChild(sp);
  });
  monthsEl.style.width = `${weekIdx * cellPx}px`;
}

function renderHeatmapStats() {
  const el = document.getElementById('hm-stats-grid');
  if (!el) return;
  const entries = Object.entries(state.activityLog);
  const totalAct = entries.reduce((s, [, c]) => s + c, 0);
  const activeDays = entries.filter(([, c]) => c > 0).length;
  const longestStrk = calcLongestStreak();

  el.innerHTML = `
    <div class="hm-stat-card"><div class="hm-stat-val">${totalAct}</div><div class="hm-stat-lbl">总活动次数</div></div>
    <div class="hm-stat-card"><div class="hm-stat-val">${activeDays}</div><div class="hm-stat-lbl">活跃天数</div></div>
    <div class="hm-stat-card"><div class="hm-stat-val">${longestStrk}</div><div class="hm-stat-lbl">最长连续</div></div>
    <div class="hm-stat-card"><div class="hm-stat-val">${calcStreak()}</div><div class="hm-stat-lbl">当前连续</div></div>
  `;
}

/* ================================================================
 *  已完成题目 (Completed)
 * ================================================================ */

/** 已完成列表的筛选状态 */
let completedSearchText = '';
let completedSelectedTags = new Set();

function renderCompleted() {
  const container = document.getElementById('completed-grid');
  if (!container) return;

  // 获取所有题目（不限制 stage）
  let completed = Object.values(state.problems)
    .sort((a, b) => (b.first_accepted_time || 0) - (a.first_accepted_time || 0));

  // 搜索筛选（题目名称或题号）
  if (completedSearchText.trim()) {
    const search = completedSearchText.toLowerCase();
    completed = completed.filter(p => {
      const title = (p.title || '').toLowerCase();
      const id = (p.questionId || '').toLowerCase();
      return title.includes(search) || id.includes(search);
    });
  }

  // 标签筛选（多选，AND 逻辑：必须包含所有选中的标签）
  if (completedSelectedTags.size > 0) {
    completed = completed.filter(p => {
      const pTags = new Set(p.tags || []);
      for (const tag of completedSelectedTags) {
        if (!pTags.has(tag)) return false;
      }
      return true;
    });
  }

  if (completed.length === 0) {
    container.innerHTML = `<div class="empty-state">
      <div class="empty-icon">${completedSearchText || completedSelectedTags.size > 0 ? '🔍' : '📚'}</div>
      <p class="empty-title">${completedSearchText || completedSelectedTags.size > 0 ? '没有匹配的题目' : '还没有完成的题目'}</p>
      <p class="empty-hint">${completedSearchText || completedSelectedTags.size > 0 ? '试试其他关键词或标签' : '去 LeetCode 提交一道题试试吧！'}</p>
    </div>`;
    return;
  }

  container.innerHTML = completed.map(p => buildQCard(p)).join('');

  // 绑定操作
  container.querySelectorAll('.act-note').forEach(b =>
    b.addEventListener('click', (e) => { e.stopPropagation(); openNote(b.dataset.slug); }));
  container.querySelectorAll('.act-reset').forEach(b =>
    b.addEventListener('click', (e) => { e.stopPropagation(); resetProblem(b.dataset.slug); }));
  container.querySelectorAll('.act-delete').forEach(b =>
    b.addEventListener('click', (e) => { e.stopPropagation(); deleteProblem(b.dataset.slug); }));

  container.querySelectorAll('.q-body').forEach(body => {
    body.addEventListener('click', (e) => {
      if (e.target.closest('a') || e.target.closest('button')) return;
      openNote(body.dataset.slug);
    });
  });

  // 更新标签筛选UI
  renderCompletedTagFilter();
}

/** 渲染已完成列表的标签筛选器 */
function renderCompletedTagFilter() {
  const listEl = document.getElementById('completed-tag-list-web');
  const countEl = document.getElementById('completed-tag-count-web');
  if (!listEl) return;

  // 收集所有标签
  const tagSet = new Set();
  Object.values(state.problems).forEach(p => {
    (p.tags || []).forEach(t => tagSet.add(t));
  });
  const tags = [...tagSet].sort();

  listEl.innerHTML = tags.map(tag => `
    <div class="tag-filter-item">
      <input type="checkbox" id="ctag-web-${esc(tag)}" value="${esc(tag)}" 
        ${completedSelectedTags.has(tag) ? 'checked' : ''}>
      <label for="ctag-web-${esc(tag)}">${esc(tag)}</label>
    </div>
  `).join('');

  // 绑定复选框事件
  listEl.querySelectorAll('input[type="checkbox"]').forEach(cb => {
    cb.addEventListener('change', () => {
      const tag = cb.value;
      if (cb.checked) {
        completedSelectedTags.add(tag);
      } else {
        completedSelectedTags.delete(tag);
      }
      renderCompleted();
    });
  });

  // 更新选中数量显示
  if (countEl) {
    countEl.textContent = completedSelectedTags.size > 0 ? `(${completedSelectedTags.size})` : '';
  }
}

/* ================================================================
 *  已掌握题目 (Mastered)
 * ================================================================ */

function renderMastered() {
  const container = document.getElementById('mastered-grid');
  if (!container) return;

  const mastered = Object.values(state.problems)
    .filter(p => p.stage >= REVIEW_STAGES.length - 1)
    .sort((a, b) => (b.last_review_time || 0) - (a.last_review_time || 0));

  if (mastered.length === 0) {
    container.innerHTML = `<div class="empty-state">
      <div class="empty-icon">🏆</div>
      <p class="empty-title">还没有已掌握的题目</p>
      <p class="empty-hint">完成全部复习阶段后，题目将出现在这里</p>
    </div>`;
    return;
  }

  container.innerHTML = mastered.map(p => {
    const name = p.questionId ? `${p.questionId}. ${p.title}` : p.title;
    const fb = p.origin === 'cn' ? 'https://leetcode.cn' : 'https://leetcode.com';
    const url = p.url || `${fb}/problems/${p.slug}/`;
    const diffCls = (p.difficulty || 'Medium').toLowerCase();
    const completedDate = p.last_review_time ? fmtDate(new Date(p.last_review_time)) : '—';
    const reviewCount = (p.review_history || []).length;
    const hasCode = p.code ? '<span class="q-code-indicator">💻</span>' : '';
    const hasNote = p.note ? '<span class="q-code-indicator">📝</span>' : '';

    return `<div class="mastered-card" data-slug="${p.slug}">
      <div class="mastered-card-main">
        <div class="mastered-card-top">
          <a href="${esc(url)}" target="_blank" rel="noopener" class="mastered-title" title="${esc(name)}">${esc(name)}</a>
          <span class="diff-badge ${diffCls}">${p.difficulty}</span>
        </div>
        <div class="mastered-card-meta">
          <span>复习 ${reviewCount} 次</span>
          <span>掌握于 ${completedDate}</span>
          ${hasCode}${hasNote}
        </div>
        <div class="mastered-card-tags">
          ${(p.tags || []).slice(0, 5).map(t => `<span class="q-tag">${esc(t)}</span>`).join('')}
        </div>
      </div>
      <div class="mastered-card-actions">
        <a class="q-act-btn q-act-goto" href="${esc(url)}" target="_blank" rel="noopener">
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M10.5 1.5L5 7M10.5 1.5H7.5M10.5 1.5V4.5M5.5 2.5H2.5C1.95 2.5 1.5 2.95 1.5 3.5V9.5C1.5 10.05 1.95 10.5 2.5 10.5H8.5C9.05 10.5 9.5 10.05 9.5 9.5V6.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg>
          跳转
        </a>
        <button class="q-act-btn q-act-note mastered-note-btn" data-slug="${p.slug}">
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M8.5 1.5L10.5 3.5L4 10H2V8L8.5 1.5Z" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg>
          笔记
        </button>
      </div>
    </div>`;
  }).join('');

  // 绑定笔记按钮
  container.querySelectorAll('.mastered-note-btn').forEach(b =>
    b.addEventListener('click', (e) => { e.stopPropagation(); openNote(b.dataset.slug); }));

  // 卡片点击打开笔记
  container.querySelectorAll('.mastered-card').forEach(card => {
    card.addEventListener('click', (e) => {
      if (e.target.closest('a') || e.target.closest('button')) return;
      openNote(card.dataset.slug);
    });
  });
}

/* ================================================================
 *  近一周动态 (Recent Activity)
 * ================================================================ */

function renderRecent() {
  const container = document.getElementById('recent-grid');
  if (!container) return;

  const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;

  const recentProblems = Object.values(state.problems)
    .filter(p => {
      if (p.last_review_time && p.last_review_time >= sevenDaysAgo) return true;
      if (p.first_accepted_time && p.first_accepted_time >= sevenDaysAgo) return true;
      return false;
    })
    .sort((a, b) => {
      const aTime = Math.max(a.last_review_time || 0, a.first_accepted_time || 0);
      const bTime = Math.max(b.last_review_time || 0, b.first_accepted_time || 0);
      return bTime - aTime;
    });

  if (recentProblems.length === 0) {
    container.innerHTML = `<div class="empty-state">
      <div class="empty-icon">📅</div>
      <p class="empty-title">近 7 天没有活动</p>
      <p class="empty-hint">去 LeetCode 做几道题吧！</p>
    </div>`;
    return;
  }

  container.innerHTML = recentProblems.map(p => {
    const name = p.questionId ? `${p.questionId}. ${p.title}` : p.title;
    const fb = p.origin === 'cn' ? 'https://leetcode.cn' : 'https://leetcode.com';
    const url = p.url || `${fb}/problems/${p.slug}/`;
    const diffCls = (p.difficulty || 'Medium').toLowerCase();

    const isNewAC = p.first_accepted_time && p.first_accepted_time >= sevenDaysAgo
      && (!p.review_history || p.review_history.length <= 1);
    const activityType = isNewAC ? '新 AC' : '复习';
    const activityClass = isNewAC ? 'activity-new' : 'activity-review';
    const latestTime = Math.max(p.last_review_time || 0, p.first_accepted_time || 0);
    const timeAgo = getRelativeTime(latestTime);

    const stageLabel = REVIEW_STAGES[Math.min(p.stage, REVIEW_STAGES.length - 1)].label;
    const hasCode = p.code ? '<span class="q-code-indicator">💻</span>' : '';

    return `<div class="recent-card" data-slug="${p.slug}">
      <div class="recent-card-top">
        <span class="activity-badge ${activityClass}">${activityType}</span>
        <a href="${esc(url)}" target="_blank" rel="noopener" class="recent-title" title="${esc(name)}">${esc(name)}</a>
        <span class="diff-badge ${diffCls}">${p.difficulty}</span>
      </div>
      <div class="recent-card-meta">
        <span>📊 ${stageLabel}</span>
        <span>🕒 ${timeAgo}</span>
        ${hasCode}
      </div>
      <div class="recent-card-tags">
        ${(p.tags || []).slice(0, 5).map(t => `<span class="q-tag">${esc(t)}</span>`).join('')}
      </div>
    </div>`;
  }).join('');

  // 卡片点击打开笔记弹窗（点击空白区域）
  container.querySelectorAll('.recent-card').forEach(card => {
    card.addEventListener('click', (e) => {
      if (e.target.closest('a')) return;
      openNote(card.dataset.slug);
    });
  });
}

/** 获取相对时间 */
function getRelativeTime(timestamp) {
  const diff = Date.now() - timestamp;
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (minutes < 1) return '刚刚';
  if (minutes < 60) return `${minutes} 分钟前`;
  if (hours < 24) return `${hours} 小时前`;
  return `${days} 天前`;
}

/* ================================================================
 *  添加题目
 * ================================================================ */

async function handleAddProblem(e) {
  e.preventDefault();

  const title = document.getElementById('add-title').value.trim();
  if (!title) { toast('请输入题目名称', 'error'); return; }

  const id   = document.getElementById('add-id').value.trim();
  const diff = document.getElementById('add-difficulty').value;
  const tags = document.getElementById('add-tags').value
    .split(/[,，]/).map(s => s.trim()).filter(Boolean);
  const url  = document.getElementById('add-url').value.trim();
  const note = document.getElementById('add-note').value.trim();

  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
    || `problem-${Date.now()}`;

  if (state.problems[slug]) {
    toast('该题目已存在', 'error');
    return;
  }

  // 从 URL 自动推断 origin
  const detectedOrigin = (url && url.includes('leetcode.cn')) ? 'cn' : 'com';
  const baseUrl = detectedOrigin === 'cn'
    ? 'https://leetcode.cn' : 'https://leetcode.com';

  const now = Date.now();
  state.problems[slug] = {
    slug,
    questionId: id,
    title,
    difficulty: diff,
    tags,
    url: url || `${baseUrl}/problems/${slug}/`,
    origin: detectedOrigin,
    first_accepted_time: now,
    last_review_time: now,
    stage: 0,
    note,
    code: '',
    review_history: [now],
    priority_score: 0
  };

  state.problems[slug].priority_score =
    calcPriority(state.problems[slug], state.settings.tagWeights);

  // 记录活动
  const today = fmtDate(new Date());
  state.activityLog[today] = (state.activityLog[today] || 0) + 1;

  await persist();
  document.getElementById('add-form').reset();
  renderAll();
  toast(`「${title}」已加入复习队列！`, 'success');
}

/* ================================================================
 *  笔记
 * ================================================================ */

/** 代码历史浏览状态 */
let codeHistoryIndex = -1;
let currentCodeHistory = [];

function openNote(slug) {
  state.noteSlug = slug;
  const p = state.problems[slug];
  if (!p) return;
  const name = p.questionId ? `${p.questionId}. ${p.title}` : p.title;
  document.getElementById('note-modal-title').textContent = `笔记 — ${name}`;
  document.getElementById('note-textarea').value = p.note || '';
  document.getElementById('code-textarea').value = p.code || '';

  // 设置代码历史导航
  currentCodeHistory = p.codeHistory || [];
  codeHistoryIndex = currentCodeHistory.length > 0 ? currentCodeHistory.length - 1 : -1;

  const historyNav = document.getElementById('code-history-nav');
  if (historyNav) {
    if (currentCodeHistory.length > 1) {
      historyNav.style.display = 'flex';
      updateCodeHistoryLabel();
    } else {
      historyNav.style.display = 'none';
    }
  }

  // 重置 tab 到「思路笔记」
  document.querySelectorAll('.modal-tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.modal-tab-panel').forEach(pp => pp.classList.remove('active'));
  document.querySelector('.modal-tab[data-modal-tab="note"]').classList.add('active');
  document.getElementById('panel-note').classList.add('active');

  document.getElementById('note-modal').classList.add('show');
  setTimeout(() => document.getElementById('note-textarea').focus(), 100);
}

/** 更新代码历史导航标签 */
function updateCodeHistoryLabel() {
  const label = document.getElementById('code-history-label');
  if (!label) return;
  if (codeHistoryIndex >= 0 && codeHistoryIndex < currentCodeHistory.length) {
    const entry = currentCodeHistory[codeHistoryIndex];
    const dateStr = entry.time ? fmtDate(new Date(entry.time)) : '—';
    const langStr = entry.lang ? `[${entry.lang}]` : '';
    label.textContent = `第 ${codeHistoryIndex + 1}/${currentCodeHistory.length} 次提交 ${langStr} ${dateStr}`;
  }
  const prevBtn = document.getElementById('code-history-prev');
  const nextBtn = document.getElementById('code-history-next');
  if (prevBtn) prevBtn.disabled = codeHistoryIndex <= 0;
  if (nextBtn) nextBtn.disabled = codeHistoryIndex >= currentCodeHistory.length - 1;
}

function closeNote() {
  document.getElementById('note-modal').classList.remove('show');
  state.noteSlug = null;
}

async function saveNote() {
  if (!state.noteSlug) return;
  const note = document.getElementById('note-textarea').value.trim();
  const code = document.getElementById('code-textarea').value.trim();
  state.problems[state.noteSlug].note = note;
  state.problems[state.noteSlug].code = code;
  await persist();
  renderQueue();
  closeNote();
  toast('笔记已保存', 'success');
}

/* ================================================================
 *  题目操作
 * ================================================================ */

async function resetProblem(slug) {
  if (!confirm('确定要重置该题目的复习阶段吗？')) return;
  const p = state.problems[slug];
  if (!p) return;
  p.stage = 0;
  p.last_review_time = Date.now();
  p.priority_score = calcPriority(p, state.settings.tagWeights);
  await persist();
  renderAll();
  toast('已重置复习阶段', 'info');
}

async function deleteProblem(slug) {
  const name = state.problems[slug]?.title || slug;
  if (!confirm(`确定要删除「${name}」吗？此操作不可撤销。`)) return;
  delete state.problems[slug];
  await persist();
  renderAll();
  toast(`已删除「${name}」`, 'info');
}

/* ================================================================
 *  设置 - 标签权重
 * ================================================================ */

function renderTagWeights() {
  const el = document.getElementById('settings-tag-list');
  if (!el) return;
  const w = state.settings.tagWeights || {};
  const entries = Object.entries(w);

  if (entries.length === 0) {
    el.innerHTML = '<p class="text-muted" style="font-size:13px">暂未设置标签权重</p>';
    return;
  }

  el.innerHTML = entries.map(([tag, val]) => `
    <div class="tw-item">
      <span class="tw-name">${esc(tag)}</span>
      <span class="tw-val">×${val.toFixed(1)}</span>
      <button class="tw-remove" data-tag="${esc(tag)}" title="移除">×</button>
    </div>
  `).join('');

  el.querySelectorAll('.tw-remove').forEach(b =>
    b.addEventListener('click', () => removeTagWeight(b.dataset.tag)));
}

async function handleAddTagWeight() {
  const nameEl = document.getElementById('stag-name');
  const valEl  = document.getElementById('stag-weight');
  const tag = nameEl.value.trim();
  const val = parseFloat(valEl.value);
  if (!tag) { nameEl.focus(); return; }
  if (isNaN(val) || val < 0.1 || val > 5) { valEl.focus(); return; }

  state.settings.tagWeights[tag] = val;
  state.problems = refreshPriorities(state.problems, state.settings.tagWeights);
  await persist();
  nameEl.value = ''; valEl.value = '1.5';
  renderTagWeights();
  renderQueue();
  updateNavBadge();
  toast(`标签「${tag}」权重已设为 ×${val.toFixed(1)}`, 'success');
}

async function removeTagWeight(tag) {
  delete state.settings.tagWeights[tag];
  state.problems = refreshPriorities(state.problems, state.settings.tagWeights);
  await persist();
  renderTagWeights();
  renderQueue();
  updateNavBadge();
}

/* ================================================================
 *  设置 - 复习阶段信息
 * ================================================================ */

function renderStagesInfo() {
  const el = document.getElementById('settings-stages');
  if (!el) return;
  el.innerHTML = REVIEW_STAGES.map((s, i) => {
    const t = s.interval === Infinity ? '∞'
      : s.interval >= 24 ? `${s.interval / 24} 天` : `${s.interval} 小时`;
    return `<div class="stage-chip">${i + 1}. ${s.label} <b>${t}</b></div>`;
  }).join('');
}

/* ================================================================
 *  导出 / 导入 / 清空
 * ================================================================ */

async function exportData() {
  const payload = {
    version: '1.0.0',
    exportTime: new Date().toISOString(),
    problems: state.problems,
    settings: state.settings,
    activityLog: state.activityLog
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `leetcurve-backup-${fmtDate(new Date())}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
  toast('数据已导出', 'success');
}

async function importData(e) {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (!data.problems) { toast('无效备份文件', 'error'); return; }
    const cnt = Object.keys(data.problems).length;
    if (!confirm(`即将导入 ${cnt} 道题目数据，将覆盖现有数据。继续？`)) return;

    if (data.problems)   state.problems = data.problems;
    if (data.settings)    state.settings = data.settings;
    if (data.activityLog) state.activityLog = data.activityLog;

    state.problems = refreshPriorities(state.problems, state.settings.tagWeights);
    await persist();
    renderAll();
    toast(`成功导入 ${cnt} 道题目！`, 'success');
  } catch (err) {
    toast('文件解析失败: ' + err.message, 'error');
  }
  e.target.value = '';
}

async function clearAllData() {
  if (!confirm('确定要清空所有数据吗？此操作不可撤销！')) return;
  if (!confirm('再次确认：所有题目、设置、活动记录将被永久删除。')) return;

  state.problems = {};
  state.settings = { tagWeights: {} };
  state.activityLog = {};
  await persist();
  renderAll();
  toast('所有数据已清空', 'info');
}

/* ================================================================
 *  持久化
 * ================================================================ */

async function persist() {
  await Storage.setAll({
    problems: state.problems,
    settings: state.settings,
    activityLog: state.activityLog
  });
}

/* ================================================================
 *  工具函数
 * ================================================================ */

function esc(s) {
  if (!s) return '';
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

function fmtDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function hmLevel(c) {
  if (c === 0) return 0;
  if (c === 1) return 1;
  if (c <= 3)  return 2;
  if (c <= 5)  return 3;
  return 4;
}

function getTimeStr(p) {
  if (p.stage >= REVIEW_STAGES.length - 1) return '已掌握';
  const interval = REVIEW_STAGES[p.stage].interval * 3600000;
  const next = p.last_review_time + interval;
  const diff = next - Date.now();
  if (diff <= 0) return `逾期 ${fmtDur(Math.abs(diff))}`;
  return `${fmtDur(diff)} 后`;
}

function fmtDur(ms) {
  const h = Math.floor(ms / 3600000);
  const d = Math.floor(h / 24);
  const rh = h % 24;
  if (d > 0) return rh > 0 ? `${d}天${rh}小时` : `${d}天`;
  if (h > 0) return `${h}小时`;
  return `${Math.max(1, Math.floor(ms / 60000))}分钟`;
}

function calcStreak() {
  let streak = 0;
  const d = new Date(); d.setHours(0,0,0,0);
  while (true) {
    const ds = fmtDate(d);
    if (state.activityLog[ds] > 0) { streak++; d.setDate(d.getDate() - 1); }
    else break;
  }
  return streak;
}

function calcLongestStreak() {
  const dates = Object.keys(state.activityLog).filter(d => state.activityLog[d] > 0).sort();
  if (dates.length === 0) return 0;
  let longest = 1, cur = 1;
  for (let i = 1; i < dates.length; i++) {
    const diff = (new Date(dates[i]) - new Date(dates[i-1])) / 86400000;
    if (diff === 1) { cur++; longest = Math.max(longest, cur); }
    else cur = 1;
  }
  return longest;
}

function toast(msg, type = 'info') {
  const container = document.getElementById('toast-container');
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = msg;
  container.appendChild(el);
  setTimeout(() => {
    el.style.opacity = '0';
    el.style.transform = 'translateX(40px)';
    el.style.transition = 'all 0.3s ease';
    setTimeout(() => el.remove(), 300);
  }, 3000);
}
