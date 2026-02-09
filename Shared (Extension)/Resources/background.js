/**
 * LeetCurve - Background Service Worker
 * ======================================
 * 核心逻辑处理中心：
 *   - 存储管理（chrome.storage.local）
 *   - 艾宾浩斯遗忘曲线算法
 *   - 复习阶段推进
 *   - 消息路由与处理
 */

'use strict';

/* ================================================================
 *  常量定义
 * ================================================================ */

/**
 * 艾宾浩斯遗忘曲线复习间隔（单位：小时）
 * 阶段逐级递增，模拟科学记忆规律
 */
const REVIEW_STAGES = [
  { label: '第1次复习', interval: 24 },       // 1 天后
  { label: '第2次复习', interval: 48 },       // 2 天后
  { label: '第3次复习', interval: 96 },       // 4 天后
  { label: '第4次复习', interval: 168 },      // 7 天后
  { label: '第5次复习', interval: 360 },      // 15 天后
  { label: '第6次复习', interval: 720 },      // 30 天后
  { label: '已掌握',    interval: Infinity }  // 完全掌握
];

/** 难度权重系数 —— Hard 遗忘更快，Easy 遗忘更慢 */
const DIFFICULTY_WEIGHTS = {
  'Easy':   0.8,
  'Medium': 1.0,
  'Hard':   1.5
};

/** 智能冷冻期：同一题目 1 小时内的多次 AC 仅算一次 */
const COOLDOWN_MS = 60 * 60 * 1000;

/** 默认标签权重 */
const DEFAULT_TAG_WEIGHT = 1.0;

/* ================================================================
 *  存储工具层（Storage Abstraction）
 * ================================================================ */

/** 读取所有题目数据 */
async function getAllProblems() {
  const result = await chrome.storage.local.get('problems');
  return result.problems || {};
}

/** 写入所有题目数据 */
async function saveAllProblems(problems) {
  await chrome.storage.local.set({ problems });
}

/** 读取单个题目 */
async function getProblem(slug) {
  const problems = await getAllProblems();
  return problems[slug] || null;
}

/** 写入单个题目 */
async function saveProblem(slug, data) {
  const problems = await getAllProblems();
  problems[slug] = data;
  await saveAllProblems(problems);
}

/** 读取用户设置 */
async function getSettings() {
  const result = await chrome.storage.local.get('settings');
  return result.settings || { tagWeights: {} };
}

/** 写入用户设置 */
async function saveSettings(settings) {
  await chrome.storage.local.set({ settings });
}

/** 读取每日活动日志（热力图数据源） */
async function getActivityLog() {
  const result = await chrome.storage.local.get('activityLog');
  return result.activityLog || {};
}

/** 记录一次活动到今日 */
async function logActivity() {
  const log = await getActivityLog();
  const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
  log[today] = (log[today] || 0) + 1;
  await chrome.storage.local.set({ activityLog: log });
}

/* ================================================================
 *  优先级算法（Priority Algorithm）
 * ================================================================
 *
 *  公式：priority = overdueRatio × difficultyWeight × tagWeight
 *
 *  - overdueRatio = max(0, (已过时间 - 预定间隔) / 预定间隔)
 *    钳制到 >= 0，只有真正逾期的题目才会拥有正优先级
 *  - difficultyWeight: Easy=0.8, Medium=1.0, Hard=1.5
 *  - tagWeight: 取该题所有标签中用户设定的最大权重
 */

/**
 * 计算单个题目的优先级分数
 * @param {Object} problem  - 题目数据对象
 * @param {Object} tagWeights - 用户自定义标签权重 { 'DP': 1.5, 'BFS': 1.3, ... }
 * @returns {number} 优先级分数
 */
function calculatePriority(problem, tagWeights = {}) {
  // 已掌握的题目排在最后
  if (problem.stage >= REVIEW_STAGES.length - 1) {
    return -Infinity;
  }

  const now = Date.now();
  const stageInfo = REVIEW_STAGES[problem.stage];
  const intervalMs = stageInfo.interval * 3600000; // 小时 → 毫秒
  const elapsed = now - problem.last_review_time;

  // 逾期比率：钳制到 >= 0，未到期的题目优先级为 0
  const overdueRatio = Math.max(0, (elapsed - intervalMs) / intervalMs);

  // 难度权重
  const diffWeight = DIFFICULTY_WEIGHTS[problem.difficulty] || 1.0;

  // 标签权重：取所有标签中的最大权重值
  let maxTagWeight = DEFAULT_TAG_WEIGHT;
  if (problem.tags && problem.tags.length > 0) {
    for (const tag of problem.tags) {
      const w = tagWeights[tag];
      if (w !== undefined && w > maxTagWeight) {
        maxTagWeight = w;
      }
    }
  }

  return overdueRatio * diffWeight * maxTagWeight;
}

/**
 * 批量刷新所有题目的优先级分数
 * @returns {Object} 更新后的全量题目数据
 */
async function refreshAllPriorities() {
  const problems = await getAllProblems();
  const settings = await getSettings();

  for (const slug of Object.keys(problems)) {
    problems[slug].priority_score = calculatePriority(
      problems[slug],
      settings.tagWeights
    );
  }

  await saveAllProblems(problems);
  return problems;
}

/* ================================================================
 *  提交处理逻辑（Submission Handler）
 * ================================================================ */

/**
 * 处理 Accepted 提交事件
 * - 新题 → 创建记录，stage = 0
 * - 旧题 → 检查冷冻期，通过则推进 stage
 */
async function handleAccepted(data) {
  const { slug, questionId, title, difficulty, tags, url, origin, timestamp,
    submittedCode, submittedLang } = data;

  if (!slug) {
    return { success: false, message: '无法识别题目' };
  }

  const existing = await getProblem(slug);
  const settings = await getSettings();

  if (existing) {
    /* ---------- 已有记录：检查冷冻期 ---------- */
    const elapsed = timestamp - existing.last_review_time;

    if (elapsed < COOLDOWN_MS) {
      const remainMin = Math.ceil((COOLDOWN_MS - elapsed) / 60000);
      return {
        success: true,
        message: `冷冻期中，${remainMin} 分钟后再次提交可推进复习阶段`
      };
    }

    // 推进复习阶段
    const newStage = Math.min(existing.stage + 1, REVIEW_STAGES.length - 1);
    const stageLabel = REVIEW_STAGES[newStage].label;

    existing.stage = newStage;
    existing.last_review_time = timestamp;
    existing.review_history.push(timestamp);
    existing.priority_score = calculatePriority(existing, settings.tagWeights);

    // 更新元数据（标签/难度/来源可能有变化）
    if (tags && tags.length > 0) existing.tags = tags;
    if (difficulty) existing.difficulty = difficulty;
    if (title) existing.title = title;
    if (origin) existing.origin = origin;
    if (url) existing.url = url;

    // 存储自动提取的代码（追加到代码记录）
    if (submittedCode && submittedCode.trim()) {
      const codeEntry = {
        code: submittedCode.trim(),
        lang: submittedLang || '',
        time: timestamp
      };
      if (!existing.codeHistory) existing.codeHistory = [];
      existing.codeHistory.push(codeEntry);
      // 同时更新最新代码到 code 字段（便于快速访问）
      existing.code = submittedCode.trim();
    }

    await saveProblem(slug, existing);
    await logActivity();

    return {
      success: true,
      message: `复习完成！已推进到「${stageLabel}」`
    };
  } else {
    /* ---------- 新题目：创建记录 ---------- */
    const resolvedOrigin = origin || 'com';
    const baseUrl = resolvedOrigin === 'cn'
      ? 'https://leetcode.cn' : 'https://leetcode.com';

    // 处理自动提取的代码
    const initialCode = (submittedCode && submittedCode.trim()) ? submittedCode.trim() : '';
    const initialCodeHistory = initialCode
      ? [{ code: initialCode, lang: submittedLang || '', time: timestamp }]
      : [];

    const problem = {
      slug,
      questionId: questionId || '',
      title: title || slug,
      difficulty: difficulty || 'Medium',
      tags: tags || [],
      url: url || `${baseUrl}/problems/${slug}/`,
      origin: resolvedOrigin,  // "com" | "cn"
      first_accepted_time: timestamp,
      last_review_time: timestamp,
      stage: 0,
      note: '',
      code: initialCode,
      codeHistory: initialCodeHistory,
      review_history: [timestamp],
      priority_score: 0
    };

    problem.priority_score = calculatePriority(problem, settings.tagWeights);

    await saveProblem(slug, problem);
    await logActivity();

    return {
      success: true,
      message: '新题目已加入复习队列！明天记得复习'
    };
  }
}

/* ================================================================
 *  Badge 更新
 * ================================================================ */

async function updateBadge() {
  const problems = await refreshAllPriorities();
  const dueCount = Object.values(problems).filter(
    p => p.priority_score > 0 && p.stage < REVIEW_STAGES.length - 1
  ).length;

  if (dueCount > 0) {
    chrome.action.setBadgeText({ text: String(dueCount) });
    chrome.action.setBadgeBackgroundColor({ color: '#ef4444' });
  } else {
    chrome.action.setBadgeText({ text: '' });
  }
}

/* ================================================================
 *  消息路由（Message Router）
 * ================================================================ */

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    try {
      switch (message.type) {

        /* --- 提交检测 --- */
        case 'SUBMISSION_ACCEPTED': {
          const result = await handleAccepted(message.data);
          await updateBadge();
          sendResponse(result);
          break;
        }

        /* --- 获取复习队列（按优先级排序） --- */
        case 'GET_REVIEW_QUEUE': {
          const problems = await refreshAllPriorities();
          const queue = Object.values(problems)
            .filter(p => p.stage < REVIEW_STAGES.length - 1)
            .sort((a, b) => b.priority_score - a.priority_score);
          sendResponse({ success: true, data: queue });
          break;
        }

        /* --- 获取全量题目数据 --- */
        case 'GET_ALL_PROBLEMS': {
          const problems = await refreshAllPriorities();
          sendResponse({ success: true, data: problems });
          break;
        }

        /* --- 更新笔记 & 代码 --- */
        case 'UPDATE_NOTE': {
          const { slug, note, code } = message.data;
          const problem = await getProblem(slug);
          if (problem) {
            if (note !== undefined) problem.note = note;
            if (code !== undefined) problem.code = code;
            await saveProblem(slug, problem);
            sendResponse({ success: true });
          } else {
            sendResponse({ success: false, message: '题目不存在' });
          }
          break;
        }

        /* --- 删除题目 --- */
        case 'DELETE_PROBLEM': {
          const allProblems = await getAllProblems();
          delete allProblems[message.data.slug];
          await saveAllProblems(allProblems);
          await updateBadge();
          sendResponse({ success: true });
          break;
        }

        /* --- 重置题目阶段 --- */
        case 'RESET_PROBLEM': {
          const prob = await getProblem(message.data.slug);
          if (prob) {
            prob.stage = 0;
            prob.last_review_time = Date.now();
            const s = await getSettings();
            prob.priority_score = calculatePriority(prob, s.tagWeights);
            await saveProblem(message.data.slug, prob);
            await updateBadge();
            sendResponse({ success: true });
          } else {
            sendResponse({ success: false, message: '题目不存在' });
          }
          break;
        }

        /* --- 设置相关 --- */
        case 'GET_SETTINGS': {
          const settings = await getSettings();
          sendResponse({ success: true, data: settings });
          break;
        }
        case 'SAVE_SETTINGS': {
          await saveSettings(message.data);
          await refreshAllPriorities();
          await updateBadge();
          sendResponse({ success: true });
          break;
        }

        /* --- 活动日志 --- */
        case 'GET_ACTIVITY_LOG': {
          const log = await getActivityLog();
          sendResponse({ success: true, data: log });
          break;
        }

        /* --- 复习阶段信息 --- */
        case 'GET_STAGES_INFO': {
          sendResponse({ success: true, data: REVIEW_STAGES });
          break;
        }

        /* --- 获取已掌握题目列表 --- */
        case 'GET_MASTERED_PROBLEMS': {
          const allProbs = await getAllProblems();
          const mastered = Object.values(allProbs)
            .filter(p => p.stage >= REVIEW_STAGES.length - 1)
            .sort((a, b) => (b.last_review_time || 0) - (a.last_review_time || 0));
          sendResponse({ success: true, data: mastered });
          break;
        }

        /* --- 获取近 7 天活动题目 --- */
        case 'GET_RECENT_ACTIVITY': {
          const allP = await getAllProblems();
          const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
          const recent = Object.values(allP)
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
          sendResponse({ success: true, data: recent });
          break;
        }

        /* --- 导出全量数据 --- */
        case 'EXPORT_DATA': {
          const expProblems = await getAllProblems();
          const expSettings = await getSettings();
          const expLog = await getActivityLog();
          sendResponse({
            success: true,
            data: {
              version: '1.0.0',
              exportTime: new Date().toISOString(),
              problems: expProblems,
              settings: expSettings,
              activityLog: expLog
            }
          });
          break;
        }

        /* --- 导入数据 --- */
        case 'IMPORT_DATA': {
          const imp = message.data;
          if (imp.problems) await saveAllProblems(imp.problems);
          if (imp.settings) await saveSettings(imp.settings);
          if (imp.activityLog) {
            await chrome.storage.local.set({ activityLog: imp.activityLog });
          }
          await updateBadge();
          sendResponse({ success: true, message: '数据导入成功' });
          break;
        }

        default:
          sendResponse({ success: false, message: `未知消息类型: ${message.type}` });
      }
    } catch (error) {
      console.error('[LeetCurve] Background error:', error);
      sendResponse({ success: false, message: error.message });
    }
  })();

  // 返回 true 以保持消息通道开放（异步 sendResponse）
  return true;
});

/* ================================================================
 *  定时任务 & 生命周期
 * ================================================================ */

// 每小时自动刷新一次优先级 & 更新 Badge
chrome.alarms.create('refreshPriorities', { periodInMinutes: 60 });

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === 'refreshPriorities') {
    await updateBadge();
  }
});

// 浏览器启动时刷新
chrome.runtime.onStartup.addListener(() => updateBadge());

// 扩展安装 / 更新时初始化
chrome.runtime.onInstalled.addListener(async (details) => {
  if (details.reason === 'install') {
    await chrome.storage.local.set({
      problems: {},
      settings: { tagWeights: {} },
      activityLog: {}
    });
    console.log('[LeetCurve] 扩展已安装，存储初始化完成');
  }
  await updateBadge();
});

console.log('[LeetCurve] Service Worker 已启动');
