Page({
  data: {
    history: []
  },
  onShow() {
    this.loadHistory();
  },
  loadHistory() {
    const history = wx.getStorageSync('interviewHistory') || [];
    this.setData({ history });
  },
  viewDetail(e) {
    const { id } = e.currentTarget.dataset;
    wx.navigateTo({
      url: `../summary/summary?id=${id}`
    });
  },
  clearHistory() {
    wx.showModal({
      title: '确认',
      content: '确定要清空所有面试历史吗？此操作不可恢复。',
      success: (res) => {
        if (res.confirm) {
          wx.removeStorageSync('interviewHistory');
          this.loadHistory();
          wx.showToast({ title: '已清空', icon: 'success' });
        }
      }
    });
  }
});