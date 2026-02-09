/**
 * LeetCurve - Network Interceptor (MAIN World)
 * =============================================
 * 运行在页面上下文中，拦截 LeetCode 的 fetch / XHR 响应，
 * 当检测到提交结果为 Accepted 时，向 window 派发自定义事件。
 *
 * 同时缓存 GraphQL 返回的题目元数据（title, difficulty, tags），
 * 确保 Accepted 事件携带完整信息。
 *
 * 增强：自动抓取用户提交的完整源代码（从 Monaco Editor 或提交请求体）
 */
(function () {
  'use strict';

  /** 缓存当前页面的题目元数据 */
  let cachedQuestion = null;

  /** 缓存最近一次提交的代码（从提交请求体中捕获） */
  let lastSubmittedCode = '';

  /** 缓存最近一次提交的语言 */
  let lastSubmittedLang = '';

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
   * 尝试从请求体中提取提交的代码
   * LeetCode 提交请求通常包含 typed_code / code 字段
   */
  function tryExtractSubmittedCode(url, requestBody) {
    try {
      if (!requestBody) return;

      let body = null;

      if (typeof requestBody === 'string') {
        body = JSON.parse(requestBody);
      } else if (requestBody instanceof FormData) {
        // FormData 方式
        const code = requestBody.get('typed_code') || requestBody.get('code');
        if (code) {
          lastSubmittedCode = code;
          lastSubmittedLang = requestBody.get('lang') || '';
        }
        return;
      } else if (typeof requestBody === 'object') {
        body = requestBody;
      }

      if (body) {
        // GraphQL submit mutation
        if (body.variables && (body.variables.typed_code || body.variables.code)) {
          lastSubmittedCode = body.variables.typed_code || body.variables.code || '';
          lastSubmittedLang = body.variables.lang || '';
        }
        // REST API submit
        if (body.typed_code || body.code) {
          lastSubmittedCode = body.typed_code || body.code || '';
          lastSubmittedLang = body.lang || '';
        }
      }
    } catch (_) { /* 静默 */ }
  }

  /**
   * 从页面 Monaco Editor 实例中提取当前编辑器中的代码
   */
  function extractCodeFromMonaco() {
    try {
      // 方式1：通过 Monaco API（LeetCode 使用的编辑器）
      if (window.monaco && window.monaco.editor) {
        const editors = window.monaco.editor.getModels();
        if (editors && editors.length > 0) {
          // 通常最后一个 model 是用户代码
          const model = editors[editors.length - 1];
          const code = model.getValue();
          if (code && code.trim().length > 0) return code;
        }
      }

      // 方式2：通过 DOM 提取 Monaco 编辑器内容
      const monacoEditor = document.querySelector('.monaco-editor');
      if (monacoEditor) {
        const viewLines = monacoEditor.querySelectorAll('.view-line');
        if (viewLines.length > 0) {
          const lines = Array.from(viewLines).map(line => {
            return line.textContent || '';
          });
          const code = lines.join('\n');
          if (code.trim().length > 0) return code;
        }
      }

      // 方式3：CodeMirror（部分 LeetCode 版本）
      const cmElement = document.querySelector('.CodeMirror');
      if (cmElement && cmElement.CodeMirror) {
        const code = cmElement.CodeMirror.getValue();
        if (code && code.trim().length > 0) return code;
      }
    } catch (_) { /* 静默 */ }
    return '';
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
   * 尝试从 Accepted 响应中提取代码（某些 API 会返回）
   */
  function tryExtractCodeFromResponse(data) {
    try {
      if (data?.code) return data.code;
      if (data?.data?.submissionCheck?.code) return data.data.submissionCheck.code;
      if (data?.data?.submissionDetails?.code) return data.data.submissionDetails.code;
    } catch (_) { /* 静默 */ }
    return '';
  }

  /**
   * 获取最佳可用的提交代码
   * 优先级：请求体缓存 > 响应中的代码 > Monaco 编辑器
   */
  function getBestAvailableCode(responseData) {
    // 1. 从提交请求体缓存获取（最可靠）
    if (lastSubmittedCode && lastSubmittedCode.trim().length > 0) {
      return lastSubmittedCode;
    }

    // 2. 从 Accepted 响应中提取
    const responseCode = tryExtractCodeFromResponse(responseData);
    if (responseCode && responseCode.trim().length > 0) {
      return responseCode;
    }

    // 3. 从 Monaco 编辑器提取（当前编辑器内容）
    const monacoCode = extractCodeFromMonaco();
    if (monacoCode && monacoCode.trim().length > 0) {
      return monacoCode;
    }

    return '';
  }

  /**
   * 派发 Accepted 事件（携带完整代码）
   */
  function dispatchAccepted(submissionUrl, responseData) {
    const slug = extractSlugFromURL();
    const submissionId =
      submissionUrl?.match(/\/submissions\/detail\/(\d+)/)?.[1] || '';

    // 获取提交的代码
    const submittedCode = getBestAvailableCode(responseData);

    const detail = {
      slug,
      submissionId,
      questionId: cachedQuestion?.questionId || '',
      title: cachedQuestion?.title || '',
      difficulty: cachedQuestion?.difficulty || '',
      tags: cachedQuestion?.tags || [],
      submittedCode: submittedCode,
      submittedLang: lastSubmittedLang || '',
      timestamp: Date.now()
    };

    window.dispatchEvent(
      new CustomEvent('leetcurve-accepted', { detail })
    );

    // 派发后清空代码缓存，避免下次提交误用
    lastSubmittedCode = '';
    lastSubmittedLang = '';
  }

  /* ================================================================
   *  Fetch 拦截
   * ================================================================ */

  const originalFetch = window.fetch;

  window.fetch = async function (...args) {
    try {
      const url = typeof args[0] === 'string'
        ? args[0]
        : args[0]?.url || '';

      // 拦截提交请求，提取代码
      if (url.includes('/submit') || url.includes('/graphql')) {
        const options = args[1] || (typeof args[0] === 'object' ? args[0] : {});
        if (options.body) {
          tryExtractSubmittedCode(url, options.body);
        }
      }
    } catch (_) { /* 静默 */ }

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
    // 拦截提交请求体，提取代码
    try {
      const url = this.__leetcurve_url || '';
      if (url.includes('/submit') || url.includes('/graphql')) {
        tryExtractSubmittedCode(url, args[0]);
      }
    } catch (_) { /* 静默 */ }

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

  console.log('[LeetCurve] Network interceptor loaded (with code capture)');
})();
