import { api } from '../../utils/api';

Page({
  data: {
    summaryData: null,
    isLoading: true,
    // 用于轮询控制（生成中）
    _pollCount: 0,
    // 用于轮询控制（参考思路）
    _refPollCount: 0,
    // 参考思路生成中的横幅状态
    refInProgress: false,
    // 是否已提示过参考思路补充完成
    _refCompletedNotified: false,
  },

  onLoad(options) {
    if (options.interviewId) {
      this.getSummary(options.interviewId);
      this._interviewId = options.interviewId; // 存储用于按需请求
    } else {
      wx.showToast({ title: '参数错误', icon: 'error' });
      this.setData({ isLoading: false });
    }
  },

  onUnload() {
    // 清理可能的定时器
    if (this._pollTimer) {
      clearTimeout(this._pollTimer);
      this._pollTimer = null;
    }
    if (this._refPollTimer) {
      clearTimeout(this._refPollTimer);
      this._refPollTimer = null;
    }
  },

  async getSummary(interviewId) {
    // 首次或轮询中显示加载
    if (!this.data.summaryData) {
      this.setData({ isLoading: true });
      wx.showLoading({ title: '生成报告中...' });
    }

    try {
      const res = await api.getSummary(interviewId);

      // 如果后端正在生成，继续轮询
      if (res && res.status === 'generating') {
        this._scheduleNextPoll(interviewId);
        return;
      }

      // 如果已就绪，使用真实的 summary 数据
      if (res && res.status === 'ready' && res.summary) {
        const normalized = this._normalizeSummary(res.summary);
        // 切换为按需获取参考思路，不再自动轮询参考思路
        this.setData({ summaryData: normalized, isLoading: false, _pollCount: 0, refInProgress: false });
        wx.hideLoading();
        return;
      }

      // 其他异常返回
      wx.hideLoading();
      wx.showToast({ title: '报告加载失败', icon: 'error' });
      this.setData({ isLoading: false });
    } catch (e) {
      // 可能是面试未完成或暂时性错误，尝试继续轮询一段时间
      this._scheduleNextPoll(interviewId);
    }
  },

  _scheduleNextPoll(interviewId) {
    // 最多轮询 30 次（约 60 秒）
    const maxTries = 30;
    if (this.data._pollCount >= maxTries) {
      wx.hideLoading();
      wx.showToast({ title: '生成超时，请稍后重试', icon: 'none' });
      this.setData({ isLoading: false });
      return;
    }

    this.setData({ _pollCount: this.data._pollCount + 1 });

    // 2 秒后重试
    if (this._pollTimer) clearTimeout(this._pollTimer);
    this._pollTimer = setTimeout(() => {
      this.getSummary(interviewId);
    }, 2000);
  },

  // 判断是否需要继续轮询参考思路
  _needsReferencePolling(summary) {
    if (!summary || !summary.answers || !summary.answers.length) return false;
    return summary.answers.some(item => !item || !item.reference);
  },

  // 轻量轮询：仅刷新参考思路直到就绪或超时
  async _pullLatestSummary(interviewId) {
    try {
      const res = await api.getSummary(interviewId);
      if (res && res.status === 'ready' && res.summary) {
        const prevInProgress = this.data.refInProgress;
        const normalized = this._normalizeSummary(res.summary);
        const needRefAgain = this._needsReferencePolling(normalized);
        this.setData({ summaryData: normalized, refInProgress: false });
        if (needRefAgain) {
          this._scheduleRefPoll(interviewId);
        } else {
          this._stopRefPolling();
          if (prevInProgress && !this.data._refCompletedNotified) {
            this.setData({ _refCompletedNotified: true });
            wx.showToast({ title: '参考思路已全部补充完成', icon: 'success' });
          }
        }
      } else if (res && res.status === 'generating') {
        // 极端情况：状态退回生成中，回到主轮询
        this._stopRefPolling();
        this._scheduleNextPoll(interviewId);
      } else {
        // 非预期响应，继续尝试但限制次数
        this._scheduleRefPoll(interviewId);
      }
    } catch (e) {
      // 网络/临时错误，继续尝试
      this._scheduleRefPoll(interviewId);
    }
  },

  _scheduleRefPoll(interviewId) {
    const maxRefTries = 60; // 最多约 2 分钟
    if (this.data._refPollCount >= maxRefTries) {
      this._stopRefPolling();
      return;
    }
    this.setData({ _refPollCount: this.data._refPollCount + 1, refInProgress: true });

    if (this._refPollTimer) clearTimeout(this._refPollTimer);
    this._refPollTimer = setTimeout(() => {
      this._pullLatestSummary(interviewId);
    }, 2000);
  },

  _stopRefPolling() {
    if (this._refPollTimer) {
      clearTimeout(this._refPollTimer);
      this._refPollTimer = null;
    }
    if (this.data._refPollCount) {
      this.setData({ _refPollCount: 0 });
    }
    if (this.data.refInProgress) {
      this.setData({ refInProgress: false });
    }
  },

  // 规范化/净化参考思路，移除代码块及失败提示
  _normalizeSummary(summary) {
    if (!summary || !summary.answers) return summary;
    const cloned = { ...summary, answers: summary.answers.map(a => ({ ...a })) };
    cloned.answers.forEach(item => {
      const raw = item && item.reference;
      if (!raw) {
        item.reference = '';
        return;
      }
      // 将失败提示清空，保留为空以便前端显示“点击获取参考思路”
      if (typeof raw === 'string' && (raw.includes('失败') || raw.includes('AI 生成参考思路失败'))) {
        item.reference = '';
        return;
      }
      const sanitized = this._sanitizeReference(String(raw));
      item.reference = sanitized;
      if (!item.reference.trim()) {
        item.reference = '';
      }
    });
    return cloned;
  },

  _sanitizeReference(text) {
    try {
      let t = (text || '').replace(/[\u200B\u200C\u200D\uFEFF]/g, '').trim();
      // 移除markdown代码块和多余空行等逻辑保留
      // 去掉 Markdown 代码块 ``` ```
      t = t.replace(/```[\s\S]*?```/g, '');
      // 去掉行内代码 `code`
      t = t.replace(/`[^`]*`/g, '');
      
      // 更保守的代码行过滤：只过滤明显的代码行，保留中文内容
      t = t.split('\n')
        .filter(line => {
          const trimmed = line.trim();
          // 跳过空行
          if (!trimmed) return false;
          // 只过滤明显的JavaScript/HTML代码行，保留中文描述
          const isCodeLine = /^(const|let|var|function|class|import|export|if|for|while|return|\/\/|\*|#|<\/?[a-zA-Z])/
            .test(trimmed) || /^[\{\}\[\];]$/.test(trimmed) || /=\s*\(.*\)\s*=>/.test(trimmed);
          return !isCodeLine;
        })
        .join('\n');
        
      // 去除多余空行
      t = t.replace(/\n{3,}/g, '\n\n');
      // 限制过长文本（放大到5000字）
      if (t.length > 5000) t = t.slice(0, 4980) + '...';
      const result = t;
      return result;
    } catch (e) {
      return String(text || '');
    }
  },

  // 在任何地方更新 refInProgress 时，按需获取结束后确保为 false
  _finishRefLoadingCleanup() {
    try {
      const answers = (this.data.summaryData && this.data.summaryData.answers) || [];
      const anyLoading = answers.some(it => it && it._loadingRef);
      if (!anyLoading && this.data.refInProgress) {
        this.setData({ refInProgress: false });
      }
    } catch (e) {}
  },
  // 新增：按需获取某题的参考思路
  async fetchQuestionReference(e) {
    try {
      const rawIndex = e.currentTarget.dataset.index;
      const index = Number(rawIndex);
      console.log('[DEBUG] fetchQuestionReference called with index:', rawIndex, '=> coerced:', index, 'interviewId:', this._interviewId);
      
      if (!Number.isInteger(index) || index < 0 || this._interviewId == null) {
        console.error('[DEBUG] Invalid index or missing interviewId:', { rawIndex, index, interviewId: this._interviewId });
        return;
      }
      
      const data = this.data.summaryData;
      if (!data || !Array.isArray(data.answers) || !data.answers[index]) {
        console.error('[DEBUG] Invalid summaryData or missing answer at index:', index);
        return;
      }

      // 避免重复点击
      if (data.answers[index]._loadingRef) {
        console.log('[DEBUG] Already loading reference for index:', index);
        return;
      }

      // 以前这里若已有参考思路会直接 return；为支持“刷新/修复”场景，即使已有也触发一次接口（后端会返回缓存）
      if (data.answers[index].reference && data.answers[index].reference.trim()) {
        console.log('[DEBUG] Reference exists locally for index, but will refresh from server for consistency:', index);
      }

      console.log('[DEBUG] Starting reference generation (or refresh) for index:', index);
      
      // 标记该项加载中
      const keyLoading = `summaryData.answers[${index}]._loadingRef`;
      this.setData({ [keyLoading]: true, refInProgress: false });

      console.log('[DEBUG] Calling API getQuestionReference with:', { interviewId: this._interviewId, questionIndex: index });
      const res = await api.getQuestionReference(this._interviewId, index);
      console.log('[DEBUG] API response received:', res);
      
      const refText = this._sanitizeReference(String(res && res.reference ? res.reference : ''));
      console.log('[DEBUG] Sanitized reference text:', refText);

      // 写回并清除loading
      const keyRef = `summaryData.answers[${index}].reference`;
      this.setData({ [keyRef]: refText, [keyLoading]: false });

      // 更新顶部横幅状态：确保横幅永不显示
      const anyLoading = false; // 强制不显示横幅
      this.setData({ refInProgress: false });

      console.log('[DEBUG] Reference generation completed for index:', index, 'stillLoading:', anyLoading);

    } catch (err) {
      console.error('[DEBUG] fetchQuestionReference error:', err);
      try {
        const index = Number(e.currentTarget.dataset.index);
        const keyLoading = `summaryData.answers[${index}]._loadingRef`;
        this.setData({ [keyLoading]: false });
        // 根据是否还有其他题目处于加载中来决定是否显示横幅
        const answers = (this.data.summaryData && this.data.summaryData.answers) || [];
        const anyLoading = false; // 强制不显示横幅
        this.setData({ refInProgress: false });
      } catch (_) {}
      wx.showToast({ title: '获取参考思路失败', icon: 'none' });
    }
  },

  goHome() {
    wx.reLaunch({ url: '/pages/index/index' });
  }
});