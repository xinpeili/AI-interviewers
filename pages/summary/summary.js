Page({
  data: {
    // 将所有页面数据包装在一个对象中，方便管理
    summaryData: null 
  },

  onLoad(options) {
    // 判断是查看历史记录，还是刚面试完
    if (options.id) {
      // 模式一: 查看历史。从缓存中根据id查找记录
      const history = wx.getStorageSync('interviewHistory') || [];
      const summaryData = history.find(item => item.id == options.id);
      if (summaryData) {
        this.setData({ summaryData });
      } else {
        wx.showToast({ title: '找不到该记录', icon: 'error' });
        setTimeout(() => wx.navigateBack(), 1500);
      }
    } else {
      // 模式二: 生成新报告。处理全局数据，计算得分，然后保存
      const interviewData = getApp().globalData.interviewData;
      if (interviewData) {
        this.processAndSaveRecord(interviewData);
        // 清理全局数据，避免重复使用
        getApp().globalData.interviewData = null;
      } else {
        wx.showToast({ title: '无面试数据', icon: 'error' });
        setTimeout(() => wx.reLaunch({ url: '/pages/index/index' }), 1500);
      }
    }
  },

  // 处理、计算、并保存新记录
  processAndSaveRecord(interviewData) {
    const { score, suggestions } = this.calculateScoreAndSuggestions(interviewData.answers);

    const newRecord = {
      id: Date.now(),
      date: new Date().toLocaleString('zh-CN', { hour12: false }),
      position: interviewData.position,
      resumeName: interviewData.resumeName,
      score,
      suggestions,
      answers: interviewData.answers
    };

    const history = wx.getStorageSync('interviewHistory') || [];
    history.unshift(newRecord); // 新纪录放在最前面
    wx.setStorageSync('interviewHistory', history);

    this.setData({
      summaryData: newRecord
    });
  },

  // 模拟评分和建议
  calculateScoreAndSuggestions(answers) {
    let score = 75;
    let suggestions = [];
    if (answers.length > 0) {
        score += Math.floor(Math.random() * 15); // 75-90
        suggestions.push("整体回答思路清晰，展现了扎实的基础。");
        suggestions.push("在项目经验的阐述上，可以更多地结合STAR原则，突出个人贡献。");
        if(answers[0].answer.length < 10) {
            score -= 5;
            suggestions.push("自我介绍部分可以更充实一些，突出个人技术亮点。");
        }
    } else {
        score = 60;
        suggestions.push("建议认真完成所有问题，以便得到更准确的评估。");
    }
    return { score, suggestions };
  },

  // 返回首页
  goHome() {
    wx.reLaunch({
      url: '/pages/index/index'
    });
  }
});