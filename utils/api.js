// 使用云开发云函数替代本地 HTTP 接口
const call = (name, data = {}) => new Promise((resolve, reject) => {
  wx.cloud.callFunction({
    name,
    data,
    success: res => {
      // 云函数返回格式约定：{ code: 0, data: any } 或直接返回对象
      const payload = res?.result;
      if (!payload) return resolve(null);
      if (typeof payload === 'object' && payload !== null && 'code' in payload) {
        if (payload.code === 0) return resolve(payload.data);
        return reject(payload);
      }
      resolve(payload);
    },
    fail: err => reject(err)
  });
});

const api = {
  // 开始面试
  startInterview: (params) => call('interview', { action: 'start', ...params }),

  // 获取下一题
  getNextQuestion: (params) => call('interview', { action: 'next', ...params }),

  // 获取总结报告
  getSummary: (interviewId) => call('interview', { action: 'summary', interviewId }),
  
  // 按需获取某题的参考思路
  getQuestionReference: (interviewId, questionIndex) => call('interview', { action: 'reference', interviewId, questionIndex }),
  
  // 获取历史记录
  getHistory: () => call('interview', { action: 'history' }),

  // 清空历史
  clearHistory: () => call('interview', { action: 'clearHistory' })
};

export { api };