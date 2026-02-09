/**
 * LeetCurve - Content Script (ISOLATED World)
 * ============================================
 * 职责：
 *   1. 监听来自 inject.js (MAIN world) 的 Accepted 自定义事件
 *   2. 从 DOM 补全题目元数据（难度、标签等）
 *   3. 与 Background Service Worker 通信
 *   4. 在页面展示 Toast 反馈
 */
(function () {
  'use strict';

  /** 防重复：5 秒内同一 slug 只处理一次 */
  let lastProcessed = { slug: '', time: 0 };
  const DEDUP_INTERVAL = 5000;

  /* ================================================================
   *  DOM 数据提取
   * ================================================================ */

  /**
   * 从当前页面 DOM 中提取题目元数据
   * 采用多重选择器兼容 LeetCode 不同版本的 UI
   */
  function extractFromDOM() {
    const url = window.location.href;
    const slugMatch = url.match(/\/problems\/([^/?#]+)/);
    const slug = slugMatch ? slugMatch[1] : null;

    if (!slug) return null;

    // --- 标题 ---
    let title = '';
    const titleSelectors = [
      '[data-cy="question-title"]',
      'div[class*="text-title-large"]',
      'div[data-track-load="description_content"] h4',
      'span[class*="title-cell"]'
    ];
    for (const sel of titleSelectors) {
      const el = document.querySelector(sel);
      if (el && el.textContent.trim()) {
        title = el.textContent.trim();
        break;
      }
    }
    if (!title) {
      title = document.title
        .replace(/ - LeetCode.*$/i, '')
        .replace(/ - 力扣.*$/i, '')
        .trim();
    }

    // --- 难度 ---
    let difficulty = '';
    const diffSelectors = [
      'div[class*="text-difficulty-easy"]',
      'div[class*="text-difficulty-medium"]',
      'div[class*="text-difficulty-hard"]',
      'span[class*="difficulty"]',
      'div[diff]'
    ];
    for (const sel of diffSelectors) {
      const el = document.querySelector(sel);
      if (el) {
        const text = el.textContent.trim().toLowerCase();
        if (text.includes('easy') || text.includes('简单')) {
          difficulty = 'Easy';
        } else if (text.includes('hard') || text.includes('困难')) {
          difficulty = 'Hard';
        } else if (text.includes('medium') || text.includes('中等')) {
          difficulty = 'Medium';
        }
        if (difficulty) break;
      }
    }

    // --- 标签 ---
    const tags = [];
    const tagSelectors = [
      'a[href*="/tag/"]',
      'a[href*="/topic/"]',
      'div[class*="topic-tag"]'
    ];
    for (const sel of tagSelectors) {
      document.querySelectorAll(sel).forEach(el => {
        const tag = el.textContent.trim();
        if (tag && !tags.includes(tag)) tags.push(tag);
      });
    }

    // --- 题号 ---
    let questionId = '';
    const idMatch = title.match(/^(\d+)[.\s]/);
    if (idMatch) questionId = idMatch[1];

    return { slug, questionId, title, difficulty, tags };
  }

  /* ================================================================
   *  事件监听 & 消息发送
   * ================================================================ */

  /**
   * 监听 inject.js 派发的 Accepted 事件
   */
  window.addEventListener('leetcurve-accepted', (e) => {
    const eventData = e.detail;
    const slug = eventData.slug;

    // 去重
    if (
      slug === lastProcessed.slug &&
      Date.now() - lastProcessed.time < DEDUP_INTERVAL
    ) {
      return;
    }
    lastProcessed = { slug, time: Date.now() };

    console.log('[LeetCurve] Accepted detected:', slug);

    // 从 DOM 补全元数据
    const domData = extractFromDOM() || {};

    // 判断当前域：com 或 cn
    const hostname = window.location.hostname;
    const origin = hostname.includes('leetcode.cn') ? 'cn' : 'com';

    // 合并数据：inject.js 数据优先，DOM 数据补全
    const payload = {
      slug: slug,
      questionId: eventData.questionId || domData.questionId || '',
      title: eventData.title || domData.title || slug,
      difficulty: eventData.difficulty || domData.difficulty || 'Medium',
      tags: (eventData.tags && eventData.tags.length > 0)
        ? eventData.tags
        : (domData.tags || []),
      url: `${window.location.origin}/problems/${slug}/`,
      origin: origin,  // "com" | "cn"，用于回跳时选择正确域名
      timestamp: eventData.timestamp || Date.now()
    };

    // 发送至 Background Service Worker
    chrome.runtime.sendMessage(
      { type: 'SUBMISSION_ACCEPTED', data: payload },
      (response) => {
        if (chrome.runtime.lastError) {
          console.warn('[LeetCurve] Message error:', chrome.runtime.lastError);
          return;
        }
        if (response && response.success) {
          console.log('[LeetCurve]', response.message);
          showToast(response.message);
        }
      }
    );
  });

  /* ================================================================
   *  页面内 Toast 提示
   * ================================================================ */

  function showToast(message) {
    // 移除已有的 toast
    const existing = document.getElementById('leetcurve-toast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.id = 'leetcurve-toast';
    toast.innerHTML = `
      <div style="display:flex;align-items:center;gap:8px">
        <span style="font-size:18px">📈</span>
        <div>
          <div style="font-weight:600;font-size:13px">LeetCurve</div>
          <div style="font-size:12px;opacity:0.9;margin-top:2px">${message}</div>
        </div>
      </div>
    `;

    Object.assign(toast.style, {
      position: 'fixed',
      bottom: '24px',
      right: '24px',
      background: 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)',
      color: '#fff',
      padding: '14px 20px',
      borderRadius: '12px',
      fontSize: '14px',
      zIndex: '2147483647',
      boxShadow: '0 8px 24px rgba(99, 102, 241, 0.35)',
      transition: 'all 0.4s cubic-bezier(0.16, 1, 0.3, 1)',
      opacity: '0',
      transform: 'translateY(16px) scale(0.95)',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      maxWidth: '320px'
    });

    document.body.appendChild(toast);

    // 入场动画
    requestAnimationFrame(() => {
      toast.style.opacity = '1';
      toast.style.transform = 'translateY(0) scale(1)';
    });

    // 3 秒后退场
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(16px) scale(0.95)';
      setTimeout(() => toast.remove(), 400);
    }, 3500);
  }

  console.log('[LeetCurve] Content script loaded on:', window.location.href);
})();
