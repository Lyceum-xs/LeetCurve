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
  populateTagFilter();
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
}

/* ================================================================
 *  Tab 切换
 * ================================================================ */

function switchTab(tabName) {
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));

  document.querySelector(`.tab[data-tab="${tabName}"]`).classList.add('active');
  document.getElementById(`tab-${tabName}`).classList.add('active');

  // 切换到热力图时重新渲染（确保尺寸正确）
  if (tabName === 'heatmap') {
    renderHeatmap();
    renderHeatmapStats();
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

  document.getElementById('stat-total').textContent = total;
  document.getElementById('stat-mastered').textContent = mastered;
  document.getElementById('stat-due').textContent = due;
  document.getElementById('stat-streak').textContent = streak;
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

  // 绑定卡片交互
  container.querySelectorAll('.card-btn-note').forEach(btn => {
    btn.addEventListener('click', () => openNoteModal(btn.dataset.slug));
  });

  container.querySelectorAll('.card-btn-reset').forEach(btn => {
    btn.addEventListener('click', () => resetProblem(btn.dataset.slug));
  });

  container.querySelectorAll('.card-btn-delete').forEach(btn => {
    btn.addEventListener('click', () => deleteProblem(btn.dataset.slug));
  });
}

/**
 * 渲染单个题目卡片
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

  // 显示标题
  const displayTitle = problem.questionId
    ? `${problem.questionId}. ${problem.title}`
    : problem.title;

  const url = problem.url || `https://leetcode.com/problems/${problem.slug}/`;
  const diffClass = (problem.difficulty || 'Medium').toLowerCase();

  return `
    <div class="problem-card ${cardClass}">
      <div class="card-header">
        <div class="card-title">
          <a href="${escapeHtml(url)}" target="_blank" title="${escapeHtml(displayTitle)}">
            ${escapeHtml(displayTitle)}
          </a>
        </div>
        <span class="difficulty-badge ${diffClass}">${problem.difficulty}</span>
      </div>

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
      </div>

      <div class="stage-bar">${stageDots}</div>

      ${tagsHtml ? `<div class="card-tags">${tagsHtml}</div>` : ''}
      ${noteHtml}

      <div class="card-actions">
        <button class="card-btn card-btn-note" data-slug="${problem.slug}" title="编辑笔记">📝</button>
        <button class="card-btn card-btn-reset" data-slug="${problem.slug}" title="重置阶段">🔄</button>
        <button class="card-btn card-btn-delete btn-danger" data-slug="${problem.slug}" title="删除">🗑</button>
      </div>
    </div>
  `;
}

/**
 * 计算距离下次复习的时间描述
 */
function getTimeInfo(problem) {
  if (problem.stage >= stagesInfo.length - 1) return '已掌握';

  const now = Date.now();
  const interval = stagesInfo[problem.stage].interval * 3600000;
  const nextReview = problem.last_review_time + interval;
  const diff = nextReview - now;

  if (diff <= 0) {
    // 逾期
    const overdue = Math.abs(diff);
    return `逾期 ${formatDuration(overdue)}`;
  } else {
    return `${formatDuration(diff)} 后复习`;
  }
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

  // 重置 tab 到「思路笔记」
  document.querySelectorAll('.modal-tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.modal-tab-panel').forEach(p => p.classList.remove('active'));
  document.querySelector('.modal-tab[data-modal-tab="note"]').classList.add('active');
  document.getElementById('panel-note').classList.add('active');

  document.getElementById('note-modal').classList.add('show');
  setTimeout(() => document.getElementById('note-textarea').focus(), 100);
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
      : stage.interval >= 24
        ? `${stage.interval / 24} 天`
        : `${stage.interval} 小时`;

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
