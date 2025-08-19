const BASE_URL = 'http://localhost:3001/api'; // 你的后端服务地址

// 封装 wx.request
const request = (method, url, data) => {
  return new Promise((resolve, reject) => {
    wx.request({
      url: `${BASE_URL}${url}`,
      method,
      data,
      success: (res) => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(res.data);
        } else {
          reject(res);
        }
      },
      fail: (err) => {
        reject(err);
      }
    });
  });
};

const api = {
  // 开始面试
  startInterview: (params) => request('POST', '/interview', params),

  // 获取下一题 (注意，这里传给后端的 body 变了)
  getNextQuestion: (params) => request('POST', `/interview/${params.interviewId}/next`, {
    question: params.question,
    answer: params.answer
  }),

  // 获取总结报告
  getSummary: (interviewId) => request('GET', `/interview/${interviewId}/summary`),
  
  // 按需获取某题的参考思路
  getQuestionReference: (interviewId, questionIndex) => request('POST', `/interview/${interviewId}/reference`, {
    questionIndex
  }),
  
  // 获取历史记录
  getHistory: () => request('GET', '/history'),

  // 清空历史
  clearHistory: () => request('DELETE', '/history')
};

export { api };