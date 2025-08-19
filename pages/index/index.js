import { api } from '../../utils/api';

Page({
  data: {
    resumeName: '',
    position: ''
  },

  uploadResume() {
    wx.chooseMessageFile({
      count: 1,
      type: 'file',
      success: (res) => {
        const tempFile = res.tempFiles[0];
        this.setData({
          resumeName: tempFile.name
        });
      },
      fail: (err) => {
        console.log('File selection failed:', err);
      }
    });
  },

  onPositionInput(e) {
    this.setData({ position: e.detail.value });
  },

  async startInterview() {
    const { resumeName, position } = this.data;
    if (!resumeName || !position) return;

    wx.showLoading({ title: '正在生成题目...' });
    try {
      const res = await api.startInterview({ resumeName, position });
      wx.hideLoading();
      
      wx.navigateTo({
        url: `../interview/interview?interviewId=${res.interviewId}&question=${encodeURIComponent(JSON.stringify(res.question))}`
      });
    } catch (e) {
      wx.hideLoading();
      wx.showToast({ title: '出题失败，请重试', icon: 'error' });
    }
  },

  goToHistory() {
    wx.navigateTo({
      url: '../history/history'
    });
  }
});