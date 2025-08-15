// index.js
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
        // For this demo, we'll just store the name
        console.log('Selected file:', tempFile);
      },
      fail: (err) => {
        console.log('File selection failed:', err);
      }
    });
  },

  onPositionInput(e) {
    this.setData({
      position: e.detail.value
    });
  },

  startInterview() {
    const { resumeName, position } = this.data;
    if (resumeName && position) {
      wx.navigateTo({
        url: `../interview/interview?position=${position}&resumeName=${encodeURIComponent(resumeName)}`
      });
    }
  },

  goToHistory() {
    wx.navigateTo({
      url: '../history/history'
    });
  }
});