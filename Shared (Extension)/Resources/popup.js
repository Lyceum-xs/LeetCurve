/**
 * LeetCurve - Popup Script
 * ========================
 * 负责所有 UI 交互逻辑：
 *   - 复习队列渲染与筛选
 *   - GitHub 风格学习热力图
 *   - 标签权重设置
 *   - 数据导入 / 导出
 *   - 笔记编辑
 */

'use strict';

/* ================================================================
 *  全局状态
 * ================================================================ */

let allProblems = {};       // 全量题目数据 { slug: {...} }
let activityLog = {};       // 活动日志 { 'YYYY-MM-DD': count }
let settings = { tagWeights: {} };
let stagesInfo = [];        // 复习阶段元信息
let currentNoteSlug = null; // 正在编辑笔记的题目 slug

/* ================================================================
 *  初始化
 * ================================================================ */

document.addEventListener('DOMContentLoaded', init);

async function init() {
  await loadAllData();
  setupEventListeners();
  renderAll();
}

/** 从 Background 加载全部数据 */
async function loadAllData() {
  const [probResp, logResp, setResp, stgResp] = await Promise.all([
    sendMessage({ type: 'GET_ALL_PROBLEMS' }),
    sendMessage({ type: 'GET_ACTIVITY_LOG' }),
    sendMessage({ type: 'GET_SETTINGS' }),
    sendMessage({ type: 'GET_STAGES_INFO' })
  ]);

  if (probResp.success) allProblems = probResp.data;
  if (logResp.success) activityLog = logResp.data;
  if (setResp.success) settings = setResp.data;
  if (stgResp.success) stagesInfo = stgResp.data;

  // 不再需要主题切换，使用固定白色+橙色主色调
}

/** 渲染全部 UI */
function renderAll() {
  renderStats();
  renderQueue();
  renderCompletedList();
  populateTagFilter();
  renderMasteredList();
  renderRecentActivity();
  renderHeatmap();
  renderHeatmapStats();
  renderTagWeights();
  renderStagesInfo();
}

/* ================================================================
 *  消息通信
 * ================================================================ */

function sendMessage(msg) {
  return new Promise(resolve => {
    chrome.runtime.sendMessage(msg, resp => {
      if (chrome.runtime.lastError) {
        console.warn('[LeetCurve] sendMessage error:', chrome.runtime.lastError);
        resolve({ success: false });
        return;
      }
      resolve(resp || { success: false });
    });
  });
}

/* ================================================================
 *  事件绑定
 * ================================================================ */

function setupEventListeners() {
  // Tab 切换
  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => switchTab(tab.dataset.tab));
  });

  // 筛选器
  document.getElementById('filter-tag').addEventListener('change', renderQueue);
  document.getElementById('filter-difficulty').addEventListener('change', renderQueue);
  document.getElementById('filter-status').addEventListener('change', renderQueue);

  // 打开完整 Web 面板
  document.getElementById('btn-open-dashboard').addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('web/index.html') });
  });

  // 笔记弹窗
  document.getElementById('note-modal-close').addEventListener('click', closeNoteModal);
  document.getElementById('note-cancel').addEventListener('click', closeNoteModal);
  document.getElementById('note-save').addEventListener('click', saveNote);

  // 弹窗内 tab 切换
  document.querySelectorAll('.modal-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.modal-tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.modal-tab-panel').forEach(p => p.classList.remove('active'));
      tab.classList.add('active');
      document.getElementById(`panel-${tab.dataset.modalTab}`).classList.add('active');
    });
  });

  // 点击遮罩关闭弹窗
  document.getElementById('note-modal').addEventListener('click', (e) => {
    if (e.target.classList.contains('modal-overlay')) closeNoteModal();
  });

  // 代码历史导航
  document.getElementById('code-history-prev').addEventListener('click', () => {
    if (codeHistoryIndex > 0) {
      codeHistoryIndex--;
      document.getElementById('code-textarea').value = currentCodeHistory[codeHistoryIndex].code || '';
      updateCodeHistoryLabel();
    }
  });
  document.getElementById('code-history-next').addEventListener('click', () => {
    if (codeHistoryIndex < currentCodeHistory.length - 1) {
      codeHistoryIndex++;
      document.getElementById('code-textarea').value = currentCodeHistory[codeHistoryIndex].code || '';
      updateCodeHistoryLabel();
    }
  });

  // 设置 - 添加标签权重
  document.getElementById('btn-add-tag-weight').addEventListener('click', addTagWeight);
  document.getElementById('input-tag-name').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') addTagWeight();
  });

  // 数据管理
  document.getElementById('btn-export').addEventListener('click', exportData);
  document.getElementById('btn-import').addEventListener('click', () => {
    document.getElementById('import-file').click();
  });
  document.getElementById('import-file').addEventListener('change', importData);

  // 已完成列表：搜索和筛选
  document.getElementById('completed-search')?.addEventListener('input', (e) => {
    completedSearchText = e.target.value;
    renderCompletedList();
  });

  document.getElementById('completed-tag-filter-btn')?.addEventListener('click', () => {
    const dropdown = document.getElementById('completed-tag-dropdown');
    if (dropdown) {
      dropdown.style.display = dropdown.style.display === 'none' ? 'block' : 'none';
    }
  });

  document.getElementById('completed-tag-clear')?.addEventListener('click', () => {
    completedSelectedTags.clear();
    renderCompletedList();
  });

  // 点击页面其他地方关闭标签筛选下拉框
  document.addEventListener('click', (e) => {
    const dropdown = document.getElementById('completed-tag-dropdown');
    const btn = document.getElementById('completed-tag-filter-btn');
    if (dropdown && btn && !dropdown.contains(e.target) && !btn.contains(e.target)) {
      dropdown.style.display = 'none';
    }
  });
}

/* ================================================================
 *  Tab 切换
 * ================================================================ */

function switchTab(tabName) {
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));

  document.querySelector(`.tab[data-tab="${tabName}"]`).classList.add('active');
  document.getElementById(`tab-${tabName}`).classList.add('active');

  // 切换到特定标签页时重新渲染
  if (tabName === 'heatmap') {
    renderHeatmap();
    renderHeatmapStats();
  } else if (tabName === 'completed') {
    renderCompletedList();
  } else if (tabName === 'mastered') {
    renderMasteredList();
  } else if (tabName === 'recent') {
    renderRecentActivity();
  }
}

/* ================================================================
 *  统计栏
 * ================================================================ */

function renderStats() {
  const problems = Object.values(allProblems);
  const total = problems.length;
  const mastered = problems.filter(p => p.stage >= stagesInfo.length - 1).length;
  const due = problems.filter(p =>
    p.priority_score > 0 && p.stage < stagesInfo.length - 1
  ).length;
  const streak = calculateStreak();

  const totalEl = document.getElementById('stat-total');
  const masteredEl = document.getElementById('stat-mastered');
  const dueEl = document.getElementById('stat-due');
  const streakEl = document.getElementById('stat-streak');

  totalEl.textContent = total;
  masteredEl.textContent = mastered;
  dueEl.textContent = due;
  streakEl.textContent = streak;

  // 总题数点击跳转到已完成列表
  totalEl.style.cursor = 'pointer';
  totalEl.onclick = () => switchTab('completed');
}

/** 计算连续活跃天数 */
function calculateStreak() {
  let streak = 0;
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const current = new Date(today);

  while (true) {
    const dateStr = current.toISOString().split('T')[0];
    if (activityLog[dateStr] && activityLog[dateStr] > 0) {
      streak++;
      current.setDate(current.getDate() - 1);
    } else {
      break;
    }
  }

  return streak;
}

/* ================================================================
 *  复习队列渲染
 * ================================================================ */

function renderQueue() {
  const container = document.getElementById('queue-list');
  const tagFilter = document.getElementById('filter-tag').value;
  const diffFilter = document.getElementById('filter-difficulty').value;
  const statusFilter = document.getElementById('filter-status').value;

  let problems = Object.values(allProblems);

  // 状态筛选
  if (statusFilter === 'due') {
    problems = problems.filter(p =>
      p.priority_score > 0 && p.stage < stagesInfo.length - 1
    );
  } else if (statusFilter === 'mastered') {
    problems = problems.filter(p => p.stage >= stagesInfo.length - 1);
  }

  // 标签筛选
  if (tagFilter) {
    problems = problems.filter(p => p.tags && p.tags.includes(tagFilter));
  }

  // 难度筛选
  if (diffFilter) {
    problems = problems.filter(p => p.difficulty === diffFilter);
  }

  // 按优先级排序
  problems.sort((a, b) => b.priority_score - a.priority_score);

  // 渲染
  if (problems.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">${statusFilter === 'due' ? '🎉' : '📚'}</div>
        <p class="empty-title">${statusFilter === 'due' ? '暂无待复习题目' : '没有匹配的题目'}</p>
        <p class="empty-hint">${statusFilter === 'due' ? '所有题目都按时复习了！' : '试试其他筛选条件'}</p>
      </div>
    `;
    return;
  }

  container.innerHTML = problems.map(p => renderProblemCard(p)).join('');

  // 绑定卡片交互 —— 文字按钮
  container.querySelectorAll('.action-btn-note').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      openNoteModal(btn.dataset.slug);
    });
  });

  container.querySelectorAll('.action-btn-reset').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      resetProblem(btn.dataset.slug);
    });
  });

  container.querySelectorAll('.action-btn-delete').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      deleteProblem(btn.dataset.slug);
    });
  });

  // 卡片中间空白区域点击 → 打开笔记弹窗
  container.querySelectorAll('.card-body').forEach(body => {
    body.addEventListener('click', (e) => {
      // 如果点击的是链接或按钮，不触发
      if (e.target.closest('a') || e.target.closest('button')) return;
      openNoteModal(body.dataset.slug);
    });
  });
}

/**
 * 渲染单个题目卡片
 * - 卡片中间空白区域可点击，触发笔记弹窗
 * - 右侧操作栏使用显式文字按钮
 */
function renderProblemCard(problem) {
  const isOverdue = problem.priority_score > 0 && problem.stage < stagesInfo.length - 1;
  const isMastered = problem.stage >= stagesInfo.length - 1;
  const cardClass = isOverdue ? 'overdue' : (isMastered ? '' : 'upcoming');

  // 时间信息
  const timeInfo = getTimeInfo(problem);

  // 阶段进度条
  const totalStages = stagesInfo.length - 1; // 排除"已掌握"
  const stageDots = Array.from({ length: totalStages }, (_, i) => {
    if (i < problem.stage) return '<div class="stage-dot filled"></div>';
    if (i === problem.stage) return '<div class="stage-dot current"></div>';
    return '<div class="stage-dot"></div>';
  }).join('');

  // 阶段标签
  const stageLabel = problem.stage < stagesInfo.length
    ? stagesInfo[problem.stage].label
    : '已掌握';

  // 标签
  const tagsHtml = (problem.tags || [])
    .slice(0, 5)
    .map(t => `<span class="tag-chip">${escapeHtml(t)}</span>`)
    .join('');

  // 笔记预览
  const noteHtml = problem.note
    ? `<div class="note-preview">${escapeHtml(problem.note.substring(0, 100))}</div>`
    : '';

  // 代码预览标记
  const codeIndicator = problem.code
    ? '<span class="code-indicator">💻 已有代码</span>'
    : '';

  // 显示标题
  const displayTitle = problem.questionId
    ? `${problem.questionId}. ${problem.title}`
    : problem.title;

  const url = problem.url || `https://leetcode.com/problems/${problem.slug}/`;
  const diffClass = (problem.difficulty || 'Medium').toLowerCase();

  return `
    <div class="problem-card ${cardClass}" data-slug="${problem.slug}">
      <div class="card-header">
        <div class="card-title">
          <a href="${escapeHtml(url)}" target="_blank" rel="noopener" title="${escapeHtml(displayTitle)}">
            ${escapeHtml(displayTitle)}
          </a>
        </div>
        <span class="difficulty-badge ${diffClass}">${problem.difficulty}</span>
      </div>

      <div class="card-body" data-slug="${problem.slug}">
        <div class="card-meta">
          <span class="meta-item ${isOverdue ? 'meta-overdue' : 'meta-upcoming'}">
            ⏱ ${timeInfo}
          </span>
          <span class="meta-item">📊 ${stageLabel}</span>
          <span class="meta-item" title="优先级分数">
            P: ${typeof problem.priority_score === 'number' && isFinite(problem.priority_score)
              ? problem.priority_score.toFixed(2)
              : '—'}
          </span>
          ${codeIndicator}
        </div>

        <div class="stage-bar">${stageDots}</div>

        ${tagsHtml ? `<div class="card-tags">${tagsHtml}</div>` : ''}
        ${noteHtml}
      </div>

      <div class="card-actions">
        <a class="action-btn action-btn-goto" href="${escapeHtml(url)}" target="_blank" rel="noopener" title="在新标签页打开题目">
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M10.5 1.5L5 7M10.5 1.5H7.5M10.5 1.5V4.5M5.5 2.5H2.5C1.95 2.5 1.5 2.95 1.5 3.5V9.5C1.5 10.05 1.95 10.5 2.5 10.5H8.5C9.05 10.5 9.5 10.05 9.5 9.5V6.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg>
          跳转题目
        </a>
        <button class="action-btn action-btn-note" data-slug="${problem.slug}" title="编辑笔记与代码">
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M8.5 1.5L10.5 3.5L4 10H2V8L8.5 1.5Z" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg>
          笔记
        </button>
        <button class="action-btn action-btn-reset" data-slug="${problem.slug}" title="重置复习阶段">
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M1.5 2V5H4.5M10.5 10V7H7.5M1.7 7A4.5 4.5 0 0 0 10.3 5M10.3 5L10.5 5M1.7 7L1.5 7" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg>
          重置
        </button>
        <button class="action-btn action-btn-delete" data-slug="${problem.slug}" title="删除题目">
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M1.5 3.5H10.5M4.5 5.5V8.5M7.5 5.5V8.5M2.5 3.5L3 10C3 10.28 3.22 10.5 3.5 10.5H8.5C8.78 10.5 9 10.28 9 10L9.5 3.5M4.5 3.5V2C4.5 1.72 4.72 1.5 5 1.5H7C7.28 1.5 7.5 1.72 7.5 2V3.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg>
          删除
        </button>
      </div>
    </div>
  `;
}

/** 日期分界线：凌晨 2:00（24 小时制） */
const DAY_BOUNDARY_HOUR = 2;

/**
 * 根据凌晨 2:00 分界线计算"复习日"序号
 * @param {number} timestamp - 毫秒时间戳
 * @returns {number} 自 epoch 以来的天数（按凌晨 2 点分界）
 */
function getReviewDay(timestamp) {
  const offsetMs = DAY_BOUNDARY_HOUR * 3600000;
  return Math.floor((timestamp - offsetMs) / 86400000);
}

/**
 * 计算距离下次复习的时间描述
 * 以凌晨 2:00 为日期分界线
 */
function getTimeInfo(problem) {
  if (problem.stage >= stagesInfo.length - 1) return '已掌握';

  const intervalDays = stagesInfo[problem.stage].interval;
  const todayDay = getReviewDay(Date.now());
  const reviewDay = getReviewDay(problem.last_review_time);
  const elapsedDays = todayDay - reviewDay;
  const remainDays = intervalDays - elapsedDays;

  if (remainDays <= 0) {
    const overdueDays = Math.abs(remainDays);
    return overdueDays === 0 ? '今日待复习' : `逾期 ${overdueDays} 天`;
  }
  return remainDays === 1 ? '明天复习' : `${remainDays} 天后复习`;
}

/** 格式化时间间隔 */
function formatDuration(ms) {
  const hours = Math.floor(ms / 3600000);
  const days = Math.floor(hours / 24);
  const remainHours = hours % 24;

  if (days > 0) {
    return remainHours > 0 ? `${days}天${remainHours}小时` : `${days}天`;
  }
  if (hours > 0) return `${hours}小时`;
  const mins = Math.max(1, Math.floor(ms / 60000));
  return `${mins}分钟`;
}

/* ================================================================
 *  标签筛选器填充
 * ================================================================ */

function populateTagFilter() {
  const select = document.getElementById('filter-tag');
  const existingValue = select.value;

  // 收集所有标签
  const tagSet = new Set();
  Object.values(allProblems).forEach(p => {
    (p.tags || []).forEach(t => tagSet.add(t));
  });

  const tags = [...tagSet].sort();

  // 保留第一项 "全部标签"
  select.innerHTML = '<option value="">全部标签</option>';
  tags.forEach(tag => {
    const opt = document.createElement('option');
    opt.value = tag;
    opt.textContent = tag;
    if (tag === existingValue) opt.selected = true;
    select.appendChild(opt);
  });
}

/* ================================================================
 *  笔记弹窗
 * ================================================================ */

/** 代码历史浏览状态 */
let codeHistoryIndex = -1; // -1 表示当前最新/手动编辑
let currentCodeHistory = [];

function openNoteModal(slug) {
  currentNoteSlug = slug;
  const problem = allProblems[slug];
  if (!problem) return;

  const displayTitle = problem.questionId
    ? `${problem.questionId}. ${problem.title}`
    : problem.title;

  document.getElementById('note-modal-title').textContent = `笔记 - ${displayTitle}`;
  document.getElementById('note-textarea').value = problem.note || '';
  document.getElementById('code-textarea').value = problem.code || '';

  // 设置代码历史导航
  currentCodeHistory = problem.codeHistory || [];
  codeHistoryIndex = currentCodeHistory.length > 0 ? currentCodeHistory.length - 1 : -1;

  const historyNav = document.getElementById('code-history-nav');
  if (currentCodeHistory.length > 1) {
    historyNav.style.display = 'flex';
    updateCodeHistoryLabel();
  } else {
    historyNav.style.display = 'none';
  }

  // 重置 tab 到「思路笔记」
  document.querySelectorAll('.modal-tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.modal-tab-panel').forEach(p => p.classList.remove('active'));
  document.querySelector('.modal-tab[data-modal-tab="note"]').classList.add('active');
  document.getElementById('panel-note').classList.add('active');

  document.getElementById('note-modal').classList.add('show');
  setTimeout(() => document.getElementById('note-textarea').focus(), 100);
}

/** 更新代码历史标签显示 */
function updateCodeHistoryLabel() {
  const label = document.getElementById('code-history-label');
  if (codeHistoryIndex >= 0 && codeHistoryIndex < currentCodeHistory.length) {
    const entry = currentCodeHistory[codeHistoryIndex];
    const dateStr = entry.time ? formatDate(new Date(entry.time)) : '—';
    const langStr = entry.lang ? `[${entry.lang}]` : '';
    label.textContent = `第 ${codeHistoryIndex + 1}/${currentCodeHistory.length} 次提交 ${langStr} ${dateStr}`;
  }

  // 按钮状态
  document.getElementById('code-history-prev').disabled = codeHistoryIndex <= 0;
  document.getElementById('code-history-next').disabled = codeHistoryIndex >= currentCodeHistory.length - 1;
}

function closeNoteModal() {
  document.getElementById('note-modal').classList.remove('show');
  currentNoteSlug = null;
}

async function saveNote() {
  if (!currentNoteSlug) return;

  const note = document.getElementById('note-textarea').value.trim();
  const code = document.getElementById('code-textarea').value.trim();
  const resp = await sendMessage({
    type: 'UPDATE_NOTE',
    data: { slug: currentNoteSlug, note, code }
  });

  if (resp.success) {
    allProblems[currentNoteSlug].note = note;
    allProblems[currentNoteSlug].code = code;
    renderQueue();
    closeNoteModal();
  }
}

/* ================================================================
 *  题目操作
 * ================================================================ */

async function resetProblem(slug) {
  if (!confirm('确定要重置该题目的复习阶段吗？')) return;

  const resp = await sendMessage({ type: 'RESET_PROBLEM', data: { slug } });
  if (resp.success) {
    // 重新加载数据
    const probResp = await sendMessage({ type: 'GET_ALL_PROBLEMS' });
    if (probResp.success) allProblems = probResp.data;
    renderAll();
  }
}

async function deleteProblem(slug) {
  const name = allProblems[slug]?.title || slug;
  if (!confirm(`确定要删除「${name}」吗？此操作不可撤销。`)) return;

  const resp = await sendMessage({ type: 'DELETE_PROBLEM', data: { slug } });
  if (resp.success) {
    delete allProblems[slug];
    renderAll();
  }
}

/* ================================================================
 *  已完成题目列表 (Completed List)
 * ================================================================ */

/** 已完成列表的筛选状态 */
let completedSearchText = '';
let completedSelectedTags = new Set();

function renderCompletedList() {
  const container = document.getElementById('completed-list');
  if (!container) return;

  // 获取所有题目（不限制 stage）
  let completed = Object.values(allProblems)
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
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">${completedSearchText || completedSelectedTags.size > 0 ? '🔍' : '📚'}</div>
        <p class="empty-title">${completedSearchText || completedSelectedTags.size > 0 ? '没有匹配的题目' : '还没有完成的题目'}</p>
        <p class="empty-hint">${completedSearchText || completedSelectedTags.size > 0 ? '试试其他关键词或标签' : '去 LeetCode 提交一道题试试吧！'}</p>
      </div>
    `;
    return;
  }

  container.innerHTML = completed.map(p => renderProblemCard(p)).join('');

  // 绑定卡片交互
  container.querySelectorAll('.action-btn-note').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      openNoteModal(btn.dataset.slug);
    });
  });

  container.querySelectorAll('.action-btn-reset').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      resetProblem(btn.dataset.slug);
    });
  });

  container.querySelectorAll('.action-btn-delete').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      deleteProblem(btn.dataset.slug);
    });
  });

  container.querySelectorAll('.card-body').forEach(body => {
    body.addEventListener('click', (e) => {
      if (e.target.closest('a') || e.target.closest('button')) return;
      openNoteModal(body.dataset.slug);
    });
  });

  // 更新标签筛选UI
  renderCompletedTagFilter();
}

/** 渲染已完成列表的标签筛选器 */
function renderCompletedTagFilter() {
  const listEl = document.getElementById('completed-tag-list');
  const countEl = document.getElementById('completed-tag-count');
  if (!listEl) return;

  // 收集所有标签
  const tagSet = new Set();
  Object.values(allProblems).forEach(p => {
    (p.tags || []).forEach(t => tagSet.add(t));
  });
  const tags = [...tagSet].sort();

  listEl.innerHTML = tags.map(tag => `
    <div class="tag-filter-item">
      <input type="checkbox" id="ctag-${escapeHtml(tag)}" value="${escapeHtml(tag)}" 
        ${completedSelectedTags.has(tag) ? 'checked' : ''}>
      <label for="ctag-${escapeHtml(tag)}">${escapeHtml(tag)}</label>
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
      renderCompletedList();
    });
  });

  // 更新选中数量显示
  if (countEl) {
    countEl.textContent = completedSelectedTags.size > 0 ? `(${completedSelectedTags.size})` : '';
  }
}

/* ================================================================
 *  已掌握题目列表 (Mastered List)
 * ================================================================ */

function renderMasteredList() {
  const container = document.getElementById('mastered-list');
  const mastered = Object.values(allProblems)
    .filter(p => p.stage >= stagesInfo.length - 1)
    .sort((a, b) => (b.last_review_time || 0) - (a.last_review_time || 0));

  if (mastered.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">🏆</div>
        <p class="empty-title">还没有已掌握的题目</p>
        <p class="empty-hint">完成全部复习阶段后，题目将出现在这里</p>
      </div>
    `;
    return;
  }

  container.innerHTML = mastered.map(p => {
    const displayTitle = p.questionId
      ? `${p.questionId}. ${p.title}`
      : p.title;
    const url = p.url || `https://leetcode.com/problems/${p.slug}/`;
    const diffClass = (p.difficulty || 'Medium').toLowerCase();
    const completedDate = p.last_review_time
      ? formatDate(new Date(p.last_review_time))
      : '—';
    const reviewCount = (p.review_history || []).length;

    return `
      <div class="mastered-card">
        <div class="mastered-card-left">
          <a href="${escapeHtml(url)}" target="_blank" rel="noopener" class="mastered-title" title="${escapeHtml(displayTitle)}">
            ${escapeHtml(displayTitle)}
          </a>
          <div class="mastered-meta">
            <span class="difficulty-badge ${diffClass}">${p.difficulty}</span>
            <span class="mastered-info">复习 ${reviewCount} 次</span>
            <span class="mastered-info">掌握于 ${completedDate}</span>
          </div>
        </div>
        <div class="mastered-card-right">
          <button class="action-btn action-btn-note" data-slug="${p.slug}" title="查看笔记与代码">
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M8.5 1.5L10.5 3.5L4 10H2V8L8.5 1.5Z" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg>
            笔记
          </button>
        </div>
      </div>
    `;
  }).join('');

  // 绑定笔记按钮
  container.querySelectorAll('.action-btn-note').forEach(btn => {
    btn.addEventListener('click', () => openNoteModal(btn.dataset.slug));
  });
}

/* ================================================================
 *  近一周动态 (Recent Activity)
 * ================================================================ */

function renderRecentActivity() {
  const container = document.getElementById('recent-list');
  const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;

  // 收集近 7 天内有活动的题目（新 AC 或完成复习）
  const recentProblems = Object.values(allProblems)
    .filter(p => {
      // 最近 review 时间在 7 天内
      if (p.last_review_time && p.last_review_time >= sevenDaysAgo) return true;
      // 首次 AC 时间在 7 天内
      if (p.first_accepted_time && p.first_accepted_time >= sevenDaysAgo) return true;
      return false;
    })
    .sort((a, b) => {
      const aTime = Math.max(a.last_review_time || 0, a.first_accepted_time || 0);
      const bTime = Math.max(b.last_review_time || 0, b.first_accepted_time || 0);
      return bTime - aTime;
    });

  if (recentProblems.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">📅</div>
        <p class="empty-title">近 7 天没有活动</p>
        <p class="empty-hint">去 LeetCode 做几道题吧！</p>
      </div>
    `;
    return;
  }

  container.innerHTML = recentProblems.map(p => {
    const displayTitle = p.questionId
      ? `${p.questionId}. ${p.title}`
      : p.title;
    const url = p.url || `https://leetcode.com/problems/${p.slug}/`;
    const diffClass = (p.difficulty || 'Medium').toLowerCase();

    // 判断活动类型
    const isNewAC = p.first_accepted_time && p.first_accepted_time >= sevenDaysAgo
      && (!p.review_history || p.review_history.length <= 1);
    const activityType = isNewAC ? '新 AC' : '复习';
    const activityClass = isNewAC ? 'activity-new' : 'activity-review';
    const latestTime = Math.max(p.last_review_time || 0, p.first_accepted_time || 0);
    const timeAgo = getRelativeTime(latestTime);

    const stageLabel = p.stage < stagesInfo.length
      ? stagesInfo[p.stage].label
      : '已掌握';

    return `
      <div class="recent-card" data-slug="${p.slug}">
        <div class="recent-card-header">
          <span class="activity-badge ${activityClass}">${activityType}</span>
          <a href="${escapeHtml(url)}" target="_blank" rel="noopener" class="recent-title" title="${escapeHtml(displayTitle)}">
            ${escapeHtml(displayTitle)}
          </a>
          <span class="difficulty-badge ${diffClass}">${p.difficulty}</span>
        </div>
        <div class="recent-card-meta">
          <span class="meta-item">📊 ${stageLabel}</span>
          <span class="meta-item">🕒 ${timeAgo}</span>
        </div>
      </div>
    `;
  }).join('');

  // 点击卡片（非链接区域）打开笔记弹窗
  container.querySelectorAll('.recent-card').forEach(card => {
    card.addEventListener('click', (e) => {
      if (e.target.closest('a')) return;
      openNoteModal(card.dataset.slug);
    });
  });
}

/**
 * 获取相对时间描述
 */
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
 *  热力图
 * ================================================================ */

function renderHeatmap() {
  const grid = document.getElementById('heatmap-grid');
  const monthsContainer = document.getElementById('heatmap-months');
  grid.innerHTML = '';
  monthsContainer.innerHTML = '';

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // 从 ~365 天前的周日开始
  const start = new Date(today);
  start.setDate(start.getDate() - 364);
  start.setDate(start.getDate() - start.getDay()); // 回退到周日

  const current = new Date(start);
  let weekCount = 0;
  let lastMonth = -1;
  const monthLabels = [];

  while (current <= today) {
    const dateStr = formatDate(current);
    const count = activityLog[dateStr] || 0;
    const level = getHeatmapLevel(count);

    const cell = document.createElement('div');
    cell.className = `heatmap-cell level-${level}`;
    cell.title = `${dateStr}：${count} 次活动`;
    grid.appendChild(cell);

    // 记录月份标签（每周日检查）
    if (current.getDay() === 0) {
      const month = current.getMonth();
      if (month !== lastMonth) {
        monthLabels.push({ week: weekCount, month });
        lastMonth = month;
      }
      weekCount++;
    }

    current.setDate(current.getDate() + 1);
  }

  // 补齐最后一周
  const remainder = 7 - (grid.children.length % 7);
  if (remainder < 7) {
    for (let i = 0; i < remainder; i++) {
      const cell = document.createElement('div');
      cell.className = 'heatmap-cell level-0';
      cell.style.visibility = 'hidden';
      grid.appendChild(cell);
    }
  }

  // 渲染月份标签
  const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  // 简单布局：根据周数偏移
  const cellSize = 13; // 11px cell + 2px gap
  monthLabels.forEach(({ week, month }) => {
    const span = document.createElement('span');
    span.textContent = MONTH_NAMES[month];
    span.style.position = 'absolute';
    span.style.left = `${week * cellSize}px`;
    monthsContainer.appendChild(span);
  });
  monthsContainer.style.position = 'relative';
  monthsContainer.style.height = '14px';
  monthsContainer.style.width = `${weekCount * cellSize}px`;
}

function getHeatmapLevel(count) {
  if (count === 0) return 0;
  if (count === 1) return 1;
  if (count <= 3) return 2;
  if (count <= 5) return 3;
  return 4;
}

function renderHeatmapStats() {
  const container = document.getElementById('heatmap-stats');
  const entries = Object.entries(activityLog);

  // 总活动次数
  const totalActivities = entries.reduce((sum, [, c]) => sum + c, 0);
  // 活跃天数
  const activeDays = entries.filter(([, c]) => c > 0).length;
  // 最长连续天数
  const longestStreak = calculateLongestStreak();

  container.innerHTML = `
    <div class="hm-stat-card">
      <div class="hm-stat-value">${totalActivities}</div>
      <div class="hm-stat-label">总活动次数</div>
    </div>
    <div class="hm-stat-card">
      <div class="hm-stat-value">${activeDays}</div>
      <div class="hm-stat-label">活跃天数</div>
    </div>
    <div class="hm-stat-card">
      <div class="hm-stat-value">${longestStreak}</div>
      <div class="hm-stat-label">最长连续</div>
    </div>
  `;
}

function calculateLongestStreak() {
  const dates = Object.keys(activityLog)
    .filter(d => activityLog[d] > 0)
    .sort();

  if (dates.length === 0) return 0;

  let longest = 1;
  let current = 1;

  for (let i = 1; i < dates.length; i++) {
    const prev = new Date(dates[i - 1]);
    const curr = new Date(dates[i]);
    const diff = (curr - prev) / 86400000; // 天数差

    if (diff === 1) {
      current++;
      longest = Math.max(longest, current);
    } else {
      current = 1;
    }
  }

  return longest;
}

/* ================================================================
 *  设置 - 标签权重
 * ================================================================ */

function renderTagWeights() {
  const container = document.getElementById('tag-weights-list');
  const weights = settings.tagWeights || {};
  const entries = Object.entries(weights);

  if (entries.length === 0) {
    container.innerHTML = '<p style="font-size:12px;color:var(--text-muted)">暂未设置标签权重</p>';
    return;
  }

  container.innerHTML = entries.map(([tag, weight]) => `
    <div class="tag-weight-item">
      <span class="tag-weight-name">${escapeHtml(tag)}</span>
      <span class="tag-weight-value">×${weight.toFixed(1)}</span>
      <button class="tag-weight-remove" data-tag="${escapeHtml(tag)}" title="移除">×</button>
    </div>
  `).join('');

  // 绑定删除事件
  container.querySelectorAll('.tag-weight-remove').forEach(btn => {
    btn.addEventListener('click', () => removeTagWeight(btn.dataset.tag));
  });
}

async function addTagWeight() {
  const nameInput = document.getElementById('input-tag-name');
  const weightInput = document.getElementById('input-tag-weight');

  const tag = nameInput.value.trim();
  const weight = parseFloat(weightInput.value);

  if (!tag) { nameInput.focus(); return; }
  if (isNaN(weight) || weight < 0.1 || weight > 5) { weightInput.focus(); return; }

  settings.tagWeights[tag] = weight;

  const resp = await sendMessage({ type: 'SAVE_SETTINGS', data: settings });
  if (resp.success) {
    nameInput.value = '';
    weightInput.value = '1.5';
    renderTagWeights();
    // 刷新队列（权重变了，优先级也变了）
    const probResp = await sendMessage({ type: 'GET_ALL_PROBLEMS' });
    if (probResp.success) allProblems = probResp.data;
    renderQueue();
    renderStats();
  }
}

async function removeTagWeight(tag) {
  delete settings.tagWeights[tag];

  const resp = await sendMessage({ type: 'SAVE_SETTINGS', data: settings });
  if (resp.success) {
    renderTagWeights();
    const probResp = await sendMessage({ type: 'GET_ALL_PROBLEMS' });
    if (probResp.success) allProblems = probResp.data;
    renderQueue();
    renderStats();
  }
}

/* ================================================================
 *  设置 - 复习阶段信息
 * ================================================================ */

function renderStagesInfo() {
  const container = document.getElementById('stages-info');

  if (!stagesInfo || stagesInfo.length === 0) {
    container.innerHTML = '<p style="color:var(--text-muted)">加载中...</p>';
    return;
  }

  container.innerHTML = stagesInfo.map((stage, i) => {
    const intervalText = stage.interval === Infinity
      ? '∞'
      : `${stage.interval} 天`;

    return `
      <div class="stage-chip">
        ${i + 1}. ${stage.label}
        <span class="stage-interval">${intervalText}</span>
      </div>
    `;
  }).join('');
}

/* ================================================================
 *  数据导出 / 导入
 * ================================================================ */

async function exportData() {
  const resp = await sendMessage({ type: 'EXPORT_DATA' });
  if (!resp.success) {
    alert('导出失败');
    return;
  }

  const blob = new Blob(
    [JSON.stringify(resp.data, null, 2)],
    { type: 'application/json' }
  );
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `leetcurve-backup-${formatDate(new Date())}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

async function importData(e) {
  const file = e.target.files[0];
  if (!file) return;

  try {
    const text = await file.text();
    const data = JSON.parse(text);

    if (!data.problems) {
      alert('无效的备份文件：缺少 problems 字段');
      return;
    }

    if (!confirm(`即将导入 ${Object.keys(data.problems).length} 道题目的数据，是否继续？\n（将覆盖现有数据）`)) {
      return;
    }

    const resp = await sendMessage({ type: 'IMPORT_DATA', data });
    if (resp.success) {
      alert('导入成功！');
      await loadAllData();
      renderAll();
    } else {
      alert('导入失败：' + (resp.message || '未知错误'));
    }
  } catch (err) {
    alert('文件解析失败：' + err.message);
  }

  // 重置 file input
  e.target.value = '';
}

/* ================================================================
 *  工具函数
 * ================================================================ */

function escapeHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function formatDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}
