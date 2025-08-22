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
    // 停止所有进行中的参考建议轮询
    if (this._refPollData) {
      for (const key in this._refPollData) {
        const poll = this._refPollData[key];
        if (poll && poll.timer) {
          clearTimeout(poll.timer);
        }
      }
      this._refPollData = null;
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

  // 为单个问题轮询参考建议
  _scheduleRefPollForIndex(interviewId, index) {
    if (!this._refPollData) {
      this._refPollData = {}; // 按 index 存储轮询状态 { count, timer }
    }
    if (!this._refPollData[index]) {
      this._refPollData[index] = { count: 0, timer: null };
    }

    const pollState = this._refPollData[index];
    const maxTries = 30; // 最多轮询约 60 秒

    if (pollState.count >= maxTries) {
      const keyLoading = `summaryData.answers[${index}]._loadingRef`;
      this.setData({ [keyLoading]: false });
      wx.showToast({ title: '生成超时', icon: 'none' });
      delete this._refPollData[index];
      return;
    }

    pollState.count++;

    if (pollState.timer) clearTimeout(pollState.timer);

    pollState.timer = setTimeout(async () => {
      try {
        const res = await api.getQuestionReference(interviewId, index);

        if (res && res.status === 'ready') {
          const refText = this._sanitizeReference(res.reference || '');
          const keyRef = `summaryData.answers[${index}].reference`;
          const keyLoading = `summaryData.answers[${index}]._loadingRef`;
          this.setData({ [keyRef]: refText, [keyLoading]: false });
          delete this._refPollData[index]; // 成功后停止
        } else if (res && res.status === 'generating') {
          this._scheduleRefPollForIndex(interviewId, index); // 继续轮询
        } else {
          throw new Error((res && res.message) || '获取建议失败');
        }
      } catch (e) {
        const keyLoading = `summaryData.answers[${index}]._loadingRef`;
        this.setData({ [keyLoading]: false });
        wx.showToast({ title: (e && e.message) || '获取失败', icon: 'none' });
        delete this._refPollData[index]; // 失败后停止
      }
    }, 2000);
  },

  // 新增：按需获取某题的参考思路
  async fetchQuestionReference(e) {
    const rawIndex = e.currentTarget.dataset.index;
    const index = Number(rawIndex);
    if (!Number.isInteger(index) || index < 0 || !this._interviewId) {
      return;
    }

    const data = this.data.summaryData;
    if (!data || !Array.isArray(data.answers) || !data.answers[index]) {
      return;
    }

    // 避免重复点击
    if (data.answers[index]._loadingRef) {
      return;
    }

    // 标记该项加载中
    const keyLoading = `summaryData.answers[${index}]._loadingRef`;
    this.setData({ [keyLoading]: true });

    try {
      const res = await api.getQuestionReference(this._interviewId, index);

      if (res && res.status === 'generating') {
        this._scheduleRefPollForIndex(this._interviewId, index);
      } else if (res && res.status === 'ready') {
        const refText = this._sanitizeReference(res.reference || '');
        const keyRef = `summaryData.answers[${index}].reference`;
        this.setData({ [keyRef]: refText, [keyLoading]: false });
      } else if (res && res.status === 'failed') {
        throw new Error(res.message || '生成失败，请重试');
      } else {
        // 兜底：对于已存在的直接返回内容的情况
        const refText = this._sanitizeReference((res && res.reference) || '');
        const keyRef = `summaryData.answers[${index}].reference`;
        this.setData({ [keyRef]: refText, [keyLoading]: false });
      }
    } catch (err) {
      this.setData({ [keyLoading]: false });
      wx.showToast({ title: (err && err.message) || '获取参考思路失败', icon: 'none' });
    }
  },

  goHome() {
    wx.reLaunch({ url: '/pages/index/index' });
  }
});