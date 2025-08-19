import { api } from '../../utils/api';

Page({
  data: {
    history: []
  },
  onShow() {
    this.loadHistory();
  },
  async loadHistory() {
    wx.showLoading({ title: '加载中...' });
    try {
      const res = await api.getHistory();
      this.setData({ history: res });
      wx.hideLoading();
    } catch(e) {
      wx.hideLoading();
      wx.showToast({ title: '加载失败', icon: 'error' });
    }
  },
  viewDetail(e) {
    const { id } = e.currentTarget.dataset;
    // 注意：历史详情页也应通过API获取，这里暂时跳转到总结页并传入ID
    wx.navigateTo({
      url: `../summary/summary?interviewId=${id}`
    });
  },
  async clearHistory() {
    wx.showModal({
      title: '确认',
      content: '确定要清空所有面试历史吗？',
      success: async (res) => {
        if (res.confirm) {
          await api.clearHistory();
          this.loadHistory();
          wx.showToast({ title: '已清空', icon: 'success' });
        }
      }
    });
  }
});