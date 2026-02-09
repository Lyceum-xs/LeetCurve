/**
 * LeetCurve - Network Interceptor (MAIN World)
 * =============================================
 * 运行在页面上下文中，拦截 LeetCode 的 fetch / XHR 响应，
 * 当检测到提交结果为 Accepted 时，向 window 派发自定义事件。
 *
 * 同时缓存 GraphQL 返回的题目元数据（title, difficulty, tags），
 * 确保 Accepted 事件携带完整信息。
 */
(function () {
  'use strict';

  /** 缓存当前页面的题目元数据 */
  let cachedQuestion = null;

  /* ================================================================
   *  工具函数
   * ================================================================ */

  /**
   * 从 URL 中提取题目 slug
   */
  function extractSlugFromURL() {
    const match = window.location.pathname.match(/\/problems\/([^/?#]+)/);
    return match ? match[1] : null;
  }

  /**
   * 尝试从 GraphQL 响应中提取题目元数据
   */
  function tryExtractQuestionData(json) {
    try {
      // LeetCode GraphQL 常见响应结构
      const question =
        json?.data?.question ||
        json?.data?.problemsetQuestionList?.questions?.[0];

      if (question && (question.titleSlug || question.title)) {
        cachedQuestion = {
          questionId: question.questionFrontendId || question.questionId || '',
          title: question.title || '',
          titleSlug: question.titleSlug || extractSlugFromURL(),
          difficulty: question.difficulty || 'Medium',
          tags: (question.topicTags || []).map(t => t.name || t.slug)
        };
      }
    } catch (_) { /* 静默 */ }
  }

  /**
   * 检查提交检查响应是否为 Accepted
   */
  function isAcceptedResponse(url, data) {
    // REST API: /submissions/detail/{id}/check/
    if (/\/submissions\/detail\/\d+\/check/.test(url)) {
      return data && data.state === 'SUCCESS' && data.status_msg === 'Accepted';
    }
    // GraphQL: submissionCheck 查询
    if (data?.data?.submissionCheck) {
      const check = data.data.submissionCheck;
      return check.statusMsg === 'Accepted' || check.status_msg === 'Accepted';
    }
    return false;
  }

  /**
   * 派发 Accepted 事件
   */
  function dispatchAccepted(submissionUrl, responseData) {
    const slug = extractSlugFromURL();
    const submissionId =
      submissionUrl?.match(/\/submissions\/detail\/(\d+)/)?.[1] || '';

    const detail = {
      slug,
      submissionId,
      questionId: cachedQuestion?.questionId || '',
      title: cachedQuestion?.title || '',
      difficulty: cachedQuestion?.difficulty || '',
      tags: cachedQuestion?.tags || [],
      timestamp: Date.now()
    };

    window.dispatchEvent(
      new CustomEvent('leetcurve-accepted', { detail })
    );
  }

  /* ================================================================
   *  Fetch 拦截
   * ================================================================ */

  const originalFetch = window.fetch;

  window.fetch = async function (...args) {
    const response = await originalFetch.apply(this, args);

    try {
      const url = typeof args[0] === 'string'
        ? args[0]
        : args[0]?.url || '';

      // 只处理 LeetCode 相关 URL
      if (
        url.includes('/submissions/detail/') ||
        url.includes('/graphql')
      ) {
        const clone = response.clone();
        clone.json().then(json => {
          // 缓存题目数据
          if (url.includes('/graphql')) {
            tryExtractQuestionData(json);
          }
          // 检测 Accepted
          if (isAcceptedResponse(url, json)) {
            dispatchAccepted(url, json);
          }
        }).catch(() => { /* 非 JSON 响应，忽略 */ });
      }
    } catch (_) { /* 静默失败，不影响页面 */ }

    return response;
  };

  /* ================================================================
   *  XMLHttpRequest 拦截
   * ================================================================ */

  const originalXHROpen = XMLHttpRequest.prototype.open;
  const originalXHRSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    this.__leetcurve_url = url;
    return originalXHROpen.apply(this, [method, url, ...rest]);
  };

  XMLHttpRequest.prototype.send = function (...args) {
    this.addEventListener('load', function () {
      try {
        const url = this.__leetcurve_url || '';
        if (
          url.includes('/submissions/detail/') ||
          url.includes('/graphql')
        ) {
          const json = JSON.parse(this.responseText);
          if (url.includes('/graphql')) {
            tryExtractQuestionData(json);
          }
          if (isAcceptedResponse(url, json)) {
            dispatchAccepted(url, json);
          }
        }
      } catch (_) { /* 静默 */ }
    });
    return originalXHRSend.apply(this, args);
  };

  console.log('[LeetCurve] Network interceptor loaded');
})();
