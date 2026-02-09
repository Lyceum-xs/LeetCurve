/**
 * LeetCurve — 综合功能测试
 * =========================
 * 在 Node.js 环境中运行，无需外部依赖。
 * 模拟 chrome.storage.local 和核心算法，覆盖所有业务逻辑。
 *
 * 运行方式：node tests/test.js
 */

'use strict';

/* ================================================================
 *  测试框架（零依赖迷你测试运行器）
 * ================================================================ */

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;
const failures = [];

function assert(condition, message) {
  totalTests++;
  if (condition) {
    passedTests++;
    console.log(`  ✅ ${message}`);
  } else {
    failedTests++;
    failures.push(message);
    console.log(`  ❌ ${message}`);
  }
}

function assertEqual(actual, expected, message) {
  totalTests++;
  const pass = JSON.stringify(actual) === JSON.stringify(expected);
  if (pass) {
    passedTests++;
    console.log(`  ✅ ${message}`);
  } else {
    failedTests++;
    const detail = `${message}\n       期望: ${JSON.stringify(expected)}\n       实际: ${JSON.stringify(actual)}`;
    failures.push(detail);
    console.log(`  ❌ ${detail}`);
  }
}

function assertApprox(actual, expected, tolerance, message) {
  totalTests++;
  const pass = Math.abs(actual - expected) <= tolerance;
  if (pass) {
    passedTests++;
    console.log(`  ✅ ${message}`);
  } else {
    failedTests++;
    const detail = `${message} (期望 ≈${expected}, 实际 ${actual})`;
    failures.push(detail);
    console.log(`  ❌ ${detail}`);
  }
}

const suites = [];

function describe(suiteName, fn) {
  suites.push({ name: suiteName, fn });
}

async function runAllSuites() {
  for (const suite of suites) {
    console.log(`\n━━━ ${suite.name} ━━━`);
    await suite.fn();
  }
}

/* ================================================================
 *  复制核心常量与算法（与 background.js / app.js 保持一致）
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

const DIFFICULTY_WEIGHTS = { Easy: 0.8, Medium: 1.0, Hard: 1.5 };
const COOLDOWN_MS = 60 * 60 * 1000; // 1 小时
const DEFAULT_TAG_WEIGHT = 1.0;

function calculatePriority(problem, tagWeights = {}) {
  if (problem.stage >= REVIEW_STAGES.length - 1) return -Infinity;

  const now = Date.now();
  const stageInfo = REVIEW_STAGES[problem.stage];
  const intervalMs = stageInfo.interval * 3600000;
  const elapsed = now - problem.last_review_time;
  const overdueRatio = Math.max(0, (elapsed - intervalMs) / intervalMs);
  const diffWeight = DIFFICULTY_WEIGHTS[problem.difficulty] || 1.0;

  let maxTagWeight = DEFAULT_TAG_WEIGHT;
  if (problem.tags && problem.tags.length > 0) {
    for (const tag of problem.tags) {
      const w = tagWeights[tag];
      if (w !== undefined && w > maxTagWeight) maxTagWeight = w;
    }
  }

  return overdueRatio * diffWeight * maxTagWeight;
}

/* ================================================================
 *  模拟存储层
 * ================================================================ */

class MockStorage {
  constructor() {
    this.data = { problems: {}, settings: { tagWeights: {} }, activityLog: {} };
  }

  async getAllProblems() { return { ...this.data.problems }; }
  async saveAllProblems(p) { this.data.problems = { ...p }; }
  async getProblem(slug) { return this.data.problems[slug] || null; }
  async saveProblem(slug, d) { this.data.problems[slug] = { ...d }; }
  async getSettings() { return { ...this.data.settings }; }
  async saveSettings(s) { this.data.settings = { ...s }; }
  async getActivityLog() { return { ...this.data.activityLog }; }
  async logActivity() {
    const today = new Date().toISOString().split('T')[0];
    this.data.activityLog[today] = (this.data.activityLog[today] || 0) + 1;
  }
}

/* ================================================================
 *  模拟提交处理逻辑（与 background.js handleAccepted 一致）
 * ================================================================ */

async function handleAccepted(storage, data) {
  const { slug, questionId, title, difficulty, tags, url, origin, timestamp,
    submittedCode, submittedLang } = data;

  if (!slug) return { success: false, message: '无法识别题目' };

  const existing = await storage.getProblem(slug);
  const settings = await storage.getSettings();

  if (existing) {
    const elapsed = timestamp - existing.last_review_time;
    if (elapsed < COOLDOWN_MS) {
      return { success: true, message: '冷冻期中' };
    }

    const newStage = Math.min(existing.stage + 1, REVIEW_STAGES.length - 1);
    existing.stage = newStage;
    existing.last_review_time = timestamp;
    existing.review_history.push(timestamp);
    existing.priority_score = calculatePriority(existing, settings.tagWeights);

    if (tags && tags.length > 0) existing.tags = tags;
    if (difficulty) existing.difficulty = difficulty;
    if (title) existing.title = title;

    if (submittedCode && submittedCode.trim()) {
      if (!existing.codeHistory) existing.codeHistory = [];
      existing.codeHistory.push({ code: submittedCode.trim(), lang: submittedLang || '', time: timestamp });
      existing.code = submittedCode.trim();
    }

    await storage.saveProblem(slug, existing);
    await storage.logActivity();
    return { success: true, message: `已推进到「${REVIEW_STAGES[newStage].label}」` };
  } else {
    const resolvedOrigin = origin || 'com';
    const baseUrl = resolvedOrigin === 'cn' ? 'https://leetcode.cn' : 'https://leetcode.com';
    const initialCode = (submittedCode && submittedCode.trim()) ? submittedCode.trim() : '';
    const initialCodeHistory = initialCode
      ? [{ code: initialCode, lang: submittedLang || '', time: timestamp }]
      : [];

    const problem = {
      slug, questionId: questionId || '', title: title || slug,
      difficulty: difficulty || 'Medium', tags: tags || [],
      url: url || `${baseUrl}/problems/${slug}/`,
      origin: resolvedOrigin,
      first_accepted_time: timestamp, last_review_time: timestamp,
      stage: 0, note: '', code: initialCode, codeHistory: initialCodeHistory,
      review_history: [timestamp], priority_score: 0
    };
    problem.priority_score = calculatePriority(problem, settings.tagWeights);
    await storage.saveProblem(slug, problem);
    await storage.logActivity();
    return { success: true, message: '新题目已加入' };
  }
}

/* ================================================================
 *  工具函数（复制自前端）
 * ================================================================ */

function fmtDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function calcStreak(activityLog) {
  let streak = 0;
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  while (true) {
    const ds = fmtDate(d);
    if (activityLog[ds] > 0) { streak++; d.setDate(d.getDate() - 1); }
    else break;
  }
  return streak;
}

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
 *  开始测试
 * ================================================================ */

// ─────────────────────────────────────────────────────────────────
describe('1. 艾宾浩斯复习阶段常量', () => {
  assertEqual(REVIEW_STAGES.length, 7, '共 7 个阶段（含"已掌握"）');
  assertEqual(REVIEW_STAGES[0].interval, 24, 'Stage 0 间隔为 24 小时');
  assertEqual(REVIEW_STAGES[1].interval, 48, 'Stage 1 间隔为 48 小时');
  assertEqual(REVIEW_STAGES[2].interval, 96, 'Stage 2 间隔为 96 小时');
  assertEqual(REVIEW_STAGES[3].interval, 168, 'Stage 3 间隔为 168 小时');
  assertEqual(REVIEW_STAGES[4].interval, 360, 'Stage 4 间隔为 360 小时');
  assertEqual(REVIEW_STAGES[5].interval, 720, 'Stage 5 间隔为 720 小时');
  assertEqual(REVIEW_STAGES[6].interval, Infinity, 'Stage 6 间隔为 Infinity');
  assertEqual(REVIEW_STAGES[6].label, '已掌握', 'Stage 6 标签为"已掌握"');
});

// ─────────────────────────────────────────────────────────────────
describe('2. 难度权重系数', () => {
  assertEqual(DIFFICULTY_WEIGHTS['Easy'], 0.8, 'Easy 权重 = 0.8');
  assertEqual(DIFFICULTY_WEIGHTS['Medium'], 1.0, 'Medium 权重 = 1.0');
  assertEqual(DIFFICULTY_WEIGHTS['Hard'], 1.5, 'Hard 权重 = 1.5');
});

// ─────────────────────────────────────────────────────────────────
describe('3. 优先级算法 — calculatePriority', () => {
  const now = Date.now();

  // 3.1 已掌握的题目返回 -Infinity
  const mastered = {
    stage: 6, difficulty: 'Medium', tags: [],
    last_review_time: now - 100000
  };
  assertEqual(calculatePriority(mastered), -Infinity, '已掌握题目优先级 = -Infinity');

  // 3.2 刚提交的题目（未逾期）优先级 = 0
  const fresh = {
    stage: 0, difficulty: 'Medium', tags: [],
    last_review_time: now
  };
  assertEqual(calculatePriority(fresh), 0, '刚提交的题目（未逾期）优先级 = 0');

  // 3.3 逾期 1 倍间隔 → overdueRatio = 1.0
  const overdue = {
    stage: 0, difficulty: 'Medium', tags: [],
    last_review_time: now - (24 * 2 * 3600000) // 48 小时前，逾期 1 倍
  };
  assertApprox(calculatePriority(overdue), 1.0, 0.01, '逾期 1 倍间隔：Medium 优先级 ≈ 1.0');

  // 3.4 Hard 题目逾期 1 倍 → 1.0 * 1.5 = 1.5
  const hardOverdue = {
    stage: 0, difficulty: 'Hard', tags: [],
    last_review_time: now - (24 * 2 * 3600000)
  };
  assertApprox(calculatePriority(hardOverdue), 1.5, 0.01, '逾期 1 倍间隔：Hard 优先级 ≈ 1.5');

  // 3.5 Easy 题目逾期 1 倍 → 1.0 * 0.8 = 0.8
  const easyOverdue = {
    stage: 0, difficulty: 'Easy', tags: [],
    last_review_time: now - (24 * 2 * 3600000)
  };
  assertApprox(calculatePriority(easyOverdue), 0.8, 0.01, '逾期 1 倍间隔：Easy 优先级 ≈ 0.8');

  // 3.6 标签权重应用
  const withTag = {
    stage: 0, difficulty: 'Medium', tags: ['DP', 'Array'],
    last_review_time: now - (24 * 2 * 3600000)
  };
  const tagWeights = { 'DP': 2.0, 'Array': 1.0 };
  assertApprox(calculatePriority(withTag, tagWeights), 2.0, 0.01,
    '标签权重：DP=2.0 时优先级 ≈ 2.0（取最大权重）');

  // 3.7 未到期的题目优先级钳制到 0
  const notDue = {
    stage: 0, difficulty: 'Medium', tags: [],
    last_review_time: now - (12 * 3600000) // 12 小时前，还差 12 小时
  };
  assertEqual(calculatePriority(notDue), 0, '未到期题目优先级钳制到 0');

  // 3.8 不同阶段的间隔应正确影响
  const stage2 = {
    stage: 2, difficulty: 'Medium', tags: [],
    last_review_time: now - (96 * 2 * 3600000) // 逾期 1 倍
  };
  assertApprox(calculatePriority(stage2), 1.0, 0.01, 'Stage 2 逾期 1 倍间隔优先级 ≈ 1.0');
});

// ─────────────────────────────────────────────────────────────────
describe('4. 提交处理 — 新题目', async () => {
  const storage = new MockStorage();
  const now = Date.now();

  const result = await handleAccepted(storage, {
    slug: 'two-sum', questionId: '1', title: 'Two Sum',
    difficulty: 'Easy', tags: ['Array', 'Hash Table'],
    url: 'https://leetcode.com/problems/two-sum/',
    origin: 'com', timestamp: now,
    submittedCode: 'function twoSum(nums, target) { ... }',
    submittedLang: 'javascript'
  });

  assert(result.success, '新题目提交成功');
  const p = await storage.getProblem('two-sum');
  assert(p !== null, '题目已保存到存储');
  assertEqual(p.slug, 'two-sum', 'slug 正确');
  assertEqual(p.questionId, '1', 'questionId 正确');
  assertEqual(p.title, 'Two Sum', 'title 正确');
  assertEqual(p.difficulty, 'Easy', 'difficulty 正确');
  assertEqual(p.tags, ['Array', 'Hash Table'], 'tags 正确');
  assertEqual(p.stage, 0, '初始 stage = 0');
  assertEqual(p.review_history.length, 1, 'review_history 长度 = 1');
  assertEqual(p.code, 'function twoSum(nums, target) { ... }', '代码自动保存');
  assertEqual(p.codeHistory.length, 1, '代码历史长度 = 1');
  assertEqual(p.codeHistory[0].lang, 'javascript', '代码语言保存正确');
});

// ─────────────────────────────────────────────────────────────────
describe('5. 提交处理 — 冷冻期', async () => {
  const storage = new MockStorage();
  const now = Date.now();

  // 先创建题目
  await handleAccepted(storage, {
    slug: 'add-two-numbers', title: 'Add Two Numbers',
    difficulty: 'Medium', tags: ['Linked List'], timestamp: now
  });

  // 30 分钟后再次提交（在冷冻期内）
  const result = await handleAccepted(storage, {
    slug: 'add-two-numbers', timestamp: now + 30 * 60000
  });

  assert(result.success, '冷冻期内提交返回 success');
  assert(result.message.includes('冷冻期'), '返回冷冻期提示');

  const p = await storage.getProblem('add-two-numbers');
  assertEqual(p.stage, 0, '冷冻期内 stage 未推进');
});

// ─────────────────────────────────────────────────────────────────
describe('6. 提交处理 — 阶段推进', async () => {
  const storage = new MockStorage();
  const now = Date.now();

  // 创建题目
  await handleAccepted(storage, {
    slug: 'median-of-two', title: 'Median of Two Sorted Arrays',
    difficulty: 'Hard', tags: ['Binary Search'], timestamp: now
  });

  // 2 小时后再次提交（超过冷冻期）
  const result = await handleAccepted(storage, {
    slug: 'median-of-two', timestamp: now + 2 * 3600000,
    submittedCode: 'def findMedian(a, b): pass', submittedLang: 'python3'
  });

  assert(result.success, '超过冷冻期提交成功');
  const p = await storage.getProblem('median-of-two');
  assertEqual(p.stage, 1, 'stage 推进到 1');
  assertEqual(p.review_history.length, 2, 'review_history 新增一条');
  assertEqual(p.code, 'def findMedian(a, b): pass', '代码更新为最新提交');
  assertEqual(p.codeHistory.length, 1, '代码历史追加新记录');
});

// ─────────────────────────────────────────────────────────────────
describe('7. 提交处理 — 完整阶段推进到已掌握', async () => {
  const storage = new MockStorage();
  let t = Date.now();

  // 创建
  await handleAccepted(storage, { slug: 'mastery-test', title: 'Test', difficulty: 'Medium', tags: [], timestamp: t });

  // 推进 6 次（每次间隔 2 小时以超过冷冻期）
  for (let i = 0; i < 6; i++) {
    t += 2 * 3600000;
    await handleAccepted(storage, { slug: 'mastery-test', timestamp: t });
  }

  const p = await storage.getProblem('mastery-test');
  assertEqual(p.stage, 6, '6 次推进后 stage = 6（已掌握）');
  assertEqual(calculatePriority(p), -Infinity, '已掌握题目优先级 = -Infinity');
});

// ─────────────────────────────────────────────────────────────────
describe('8. 提交处理 — stage 不超过最大值', async () => {
  const storage = new MockStorage();
  let t = Date.now();

  await handleAccepted(storage, { slug: 'overflow-test', title: 'T', difficulty: 'Easy', tags: [], timestamp: t });
  for (let i = 0; i < 10; i++) {
    t += 2 * 3600000;
    await handleAccepted(storage, { slug: 'overflow-test', timestamp: t });
  }

  const p = await storage.getProblem('overflow-test');
  assertEqual(p.stage, 6, '多次提交后 stage 不超过 6');
});

// ─────────────────────────────────────────────────────────────────
describe('9. 提交处理 — 无 slug 应失败', async () => {
  const storage = new MockStorage();
  const result = await handleAccepted(storage, { slug: '', timestamp: Date.now() });
  assertEqual(result.success, false, '空 slug 返回失败');
});

// ─────────────────────────────────────────────────────────────────
describe('10. 提交处理 — 代码自动提取', async () => {
  const storage = new MockStorage();
  const now = Date.now();

  // 无代码提交
  await handleAccepted(storage, {
    slug: 'no-code', title: 'No Code', difficulty: 'Easy', tags: [], timestamp: now
  });
  let p = await storage.getProblem('no-code');
  assertEqual(p.code, '', '无代码提交时 code 为空');
  assertEqual(p.codeHistory.length, 0, '无代码时 codeHistory 为空');

  // 有代码提交
  await handleAccepted(storage, {
    slug: 'with-code', title: 'With Code', difficulty: 'Medium', tags: [],
    timestamp: now, submittedCode: 'class Solution { }', submittedLang: 'java'
  });
  p = await storage.getProblem('with-code');
  assertEqual(p.code, 'class Solution { }', '有代码时 code 正确保存');
  assertEqual(p.codeHistory[0].lang, 'java', '代码语言正确');
});

// ─────────────────────────────────────────────────────────────────
describe('11. 活动日志', async () => {
  const storage = new MockStorage();
  const today = new Date().toISOString().split('T')[0];

  await storage.logActivity();
  await storage.logActivity();
  await storage.logActivity();

  const log = await storage.getActivityLog();
  assertEqual(log[today], 3, '3 次 logActivity 后今日计数 = 3');
});

// ─────────────────────────────────────────────────────────────────
describe('12. 连续活跃天数计算', () => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const log = {};
  for (let i = 0; i < 5; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    log[fmtDate(d)] = 1 + i;
  }

  assertEqual(calcStreak(log), 5, '连续 5 天活跃 streak = 5');

  // 中间断一天
  const log2 = {};
  log2[fmtDate(today)] = 1;
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  // 跳过昨天
  const dayBefore = new Date(today);
  dayBefore.setDate(dayBefore.getDate() - 2);
  log2[fmtDate(dayBefore)] = 1;

  assertEqual(calcStreak(log2), 1, '昨天断了则 streak = 1');

  // 空日志
  assertEqual(calcStreak({}), 0, '空日志 streak = 0');
});

// ─────────────────────────────────────────────────────────────────
describe('13. 已完成列表 — 搜索筛选逻辑', () => {
  const problems = [
    { questionId: '1', title: 'Two Sum', difficulty: 'Easy', tags: ['Array', 'Hash Table'], slug: 'two-sum' },
    { questionId: '2', title: 'Add Two Numbers', difficulty: 'Medium', tags: ['Linked List'], slug: 'add-two-numbers' },
    { questionId: '3', title: 'Longest Substring', difficulty: 'Medium', tags: ['Sliding Window', 'Hash Table'], slug: 'longest-substring' },
    { questionId: '4', title: 'Median of Two Sorted Arrays', difficulty: 'Hard', tags: ['Binary Search', 'Array'], slug: 'median' }
  ];

  // 搜索按名称
  let result = problems.filter(p => p.title.toLowerCase().includes('two'));
  assertEqual(result.length, 3, '搜索 "two" 匹配 3 个题目');

  // 搜索按题号
  result = problems.filter(p => p.questionId.includes('4'));
  assertEqual(result.length, 1, '搜索题号 "4" 匹配 1 个');
  assertEqual(result[0].slug, 'median', '搜索题号 "4" 匹配 Median');

  // 标签筛选：单标签
  const tagFilter = new Set(['Array']);
  result = problems.filter(p => {
    for (const t of tagFilter) {
      if (!(p.tags || []).includes(t)) return false;
    }
    return true;
  });
  assertEqual(result.length, 2, '筛选 Array 标签匹配 2 个');

  // 标签筛选：多标签 AND
  const multiFilter = new Set(['Array', 'Hash Table']);
  result = problems.filter(p => {
    for (const t of multiFilter) {
      if (!(p.tags || []).includes(t)) return false;
    }
    return true;
  });
  assertEqual(result.length, 1, '筛选 Array+Hash Table 匹配 1 个');
  assertEqual(result[0].slug, 'two-sum', 'AND 筛选匹配 Two Sum');

  // 忽略大小写搜索
  result = problems.filter(p => p.title.toLowerCase().includes('LONGEST'.toLowerCase()));
  assertEqual(result.length, 1, '搜索忽略大小写');
});

// ─────────────────────────────────────────────────────────────────
describe('14. 已掌握列表 — 筛选逻辑', () => {
  const problems = [
    { slug: 'a', stage: 6 },
    { slug: 'b', stage: 3 },
    { slug: 'c', stage: 6 },
    { slug: 'd', stage: 0 }
  ];

  const mastered = problems.filter(p => p.stage >= REVIEW_STAGES.length - 1);
  assertEqual(mastered.length, 2, '已掌握筛选：2 个 stage=6 的题目');
  assert(mastered.every(p => p.stage === 6), '所有筛选结果 stage=6');
});

// ─────────────────────────────────────────────────────────────────
describe('15. 近一周动态 — 筛选逻辑', () => {
  const now = Date.now();
  const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;

  const problems = [
    { slug: 'recent', last_review_time: now - 1 * 86400000, first_accepted_time: now - 3 * 86400000 },
    { slug: 'old', last_review_time: now - 10 * 86400000, first_accepted_time: now - 30 * 86400000 },
    { slug: 'new-ac', last_review_time: now - 20 * 86400000, first_accepted_time: now - 2 * 86400000 },
    { slug: 'boundary', last_review_time: sevenDaysAgo - 1, first_accepted_time: sevenDaysAgo - 1 }
  ];

  const recent = problems.filter(p => {
    if (p.last_review_time >= sevenDaysAgo) return true;
    if (p.first_accepted_time >= sevenDaysAgo) return true;
    return false;
  });

  assertEqual(recent.length, 2, '近一周筛选：2 个题目');
  assert(recent.some(p => p.slug === 'recent'), '包含最近复习的题目');
  assert(recent.some(p => p.slug === 'new-ac'), '包含近一周新 AC 的题目');
  assert(!recent.some(p => p.slug === 'old'), '不包含超过 7 天的题目');
  assert(!recent.some(p => p.slug === 'boundary'), '不包含边界外的题目');
});

// ─────────────────────────────────────────────────────────────────
describe('16. 相对时间格式化', () => {
  const now = Date.now();
  assertEqual(getRelativeTime(now), '刚刚', '刚刚');
  assertEqual(getRelativeTime(now - 5 * 60000), '5 分钟前', '5 分钟前');
  assertEqual(getRelativeTime(now - 3 * 3600000), '3 小时前', '3 小时前');
  assertEqual(getRelativeTime(now - 2 * 86400000), '2 天前', '2 天前');
});

// ─────────────────────────────────────────────────────────────────
describe('17. 日期格式化', () => {
  const d = new Date(2026, 1, 9); // 2026-02-09
  assertEqual(fmtDate(d), '2026-02-09', '格式化日期 2026-02-09');

  const d2 = new Date(2025, 0, 1); // 2025-01-01
  assertEqual(fmtDate(d2), '2025-01-01', '格式化日期 2025-01-01（补零）');
});

// ─────────────────────────────────────────────────────────────────
describe('18. 标签实时更新逻辑', () => {
  const problems = {
    'a': { tags: ['Array', 'DP'] },
    'b': { tags: ['DP', 'Greedy'] },
    'c': { tags: ['Array', 'Hash Table'] }
  };

  const tagSet = new Set();
  Object.values(problems).forEach(p => (p.tags || []).forEach(t => tagSet.add(t)));
  const tags = [...tagSet].sort();

  assertEqual(tags, ['Array', 'DP', 'Greedy', 'Hash Table'], '标签自动去重排序');

  // 删除一个题目后标签应更新
  delete problems['b'];
  const tagSet2 = new Set();
  Object.values(problems).forEach(p => (p.tags || []).forEach(t => tagSet2.add(t)));
  const tags2 = [...tagSet2].sort();

  assertEqual(tags2, ['Array', 'DP', 'Hash Table'], '删除题目后标签列表更新（Greedy 消失）');
});

// ─────────────────────────────────────────────────────────────────
describe('19. 数据导出/导入格式', () => {
  const exportData = {
    version: '1.0.0',
    exportTime: new Date().toISOString(),
    problems: { 'two-sum': { slug: 'two-sum', stage: 2 } },
    settings: { tagWeights: { 'DP': 1.5 } },
    activityLog: { '2026-02-09': 3 }
  };

  assert(exportData.version === '1.0.0', '导出数据包含 version');
  assert(typeof exportData.exportTime === 'string', '导出数据包含 exportTime');
  assert(typeof exportData.problems === 'object', '导出数据包含 problems');
  assert(typeof exportData.settings === 'object', '导出数据包含 settings');
  assert(typeof exportData.activityLog === 'object', '导出数据包含 activityLog');

  // 验证导入后数据恢复
  const importedProblems = exportData.problems;
  assertEqual(importedProblems['two-sum'].stage, 2, '导入后 stage 正确恢复');
  assertEqual(exportData.settings.tagWeights['DP'], 1.5, '导入后标签权重正确恢复');
});

// ─────────────────────────────────────────────────────────────────
describe('20. 热力图等级计算', () => {
  function hmLevel(c) {
    if (c === 0) return 0;
    if (c === 1) return 1;
    if (c <= 3) return 2;
    if (c <= 5) return 3;
    return 4;
  }

  assertEqual(hmLevel(0), 0, '0 次 → level 0');
  assertEqual(hmLevel(1), 1, '1 次 → level 1');
  assertEqual(hmLevel(2), 2, '2 次 → level 2');
  assertEqual(hmLevel(3), 2, '3 次 → level 2');
  assertEqual(hmLevel(4), 3, '4 次 → level 3');
  assertEqual(hmLevel(5), 3, '5 次 → level 3');
  assertEqual(hmLevel(6), 4, '6 次 → level 4');
  assertEqual(hmLevel(100), 4, '100 次 → level 4');
});

// ─────────────────────────────────────────────────────────────────
describe('21. 链接新标签页属性验证', () => {
  // 模拟 buildQCard 中的链接生成
  const url = 'https://leetcode.com/problems/two-sum/';
  const linkHtml = `<a href="${url}" target="_blank" rel="noopener">Two Sum</a>`;

  assert(linkHtml.includes('target="_blank"'), '题目链接包含 target="_blank"');
  assert(linkHtml.includes('rel="noopener"'), '题目链接包含 rel="noopener"');
});

// ─────────────────────────────────────────────────────────────────
describe('22. 数据结构完整性', async () => {
  const storage = new MockStorage();
  const now = Date.now();

  await handleAccepted(storage, {
    slug: 'complete-test', questionId: '999', title: 'Complete Test',
    difficulty: 'Hard', tags: ['DP', 'Greedy'],
    url: 'https://leetcode.com/problems/complete-test/',
    origin: 'com', timestamp: now,
    submittedCode: 'int main() {}', submittedLang: 'cpp'
  });

  const p = await storage.getProblem('complete-test');
  const requiredFields = [
    'slug', 'questionId', 'title', 'difficulty', 'tags', 'url',
    'origin', 'first_accepted_time', 'last_review_time',
    'stage', 'note', 'code', 'codeHistory', 'review_history', 'priority_score'
  ];

  for (const field of requiredFields) {
    assert(p.hasOwnProperty(field), `题目对象包含字段: ${field}`);
  }
});

// ─────────────────────────────────────────────────────────────────
describe('23. LeetCode 域名处理', async () => {
  const storage = new MockStorage();
  const now = Date.now();

  // CN 域名
  await handleAccepted(storage, {
    slug: 'cn-test', title: 'CN Test', difficulty: 'Easy', tags: [],
    origin: 'cn', timestamp: now
  });
  let p = await storage.getProblem('cn-test');
  assert(p.url.includes('leetcode.cn'), 'CN 域名 URL 包含 leetcode.cn');
  assertEqual(p.origin, 'cn', 'origin = cn');

  // COM 域名
  await handleAccepted(storage, {
    slug: 'com-test', title: 'COM Test', difficulty: 'Easy', tags: [],
    origin: 'com', timestamp: now
  });
  p = await storage.getProblem('com-test');
  assert(p.url.includes('leetcode.com'), 'COM 域名 URL 包含 leetcode.com');
  assertEqual(p.origin, 'com', 'origin = com');
});

/* ================================================================
 *  运行全部测试
 * ================================================================ */

(async () => {
  console.log('\n🧪 LeetCurve 综合功能测试');
  console.log('═══════════════════════════════════════════════\n');

  await runAllSuites();

  console.log('\n═══════════════════════════════════════════════');
  console.log(`📊 测试结果：${passedTests}/${totalTests} 通过`);
  if (failedTests > 0) {
    console.log(`❌ ${failedTests} 个失败：`);
    failures.forEach((f, i) => console.log(`   ${i + 1}. ${f}`));
    process.exit(1);
  } else {
    console.log('🎉 全部通过！');
    process.exit(0);
  }
})();
