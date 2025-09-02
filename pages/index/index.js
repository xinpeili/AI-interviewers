import { api } from '../../utils/api';

Page({
  data: {
    resumeName: '',
    position: '',
    isPositionValid: false
  },
  
  // 分享给好友
  onShareAppMessage() {
    return {
      title: '小白面试通 - 好用的面试助手',
      path: '/pages/index/index',
      imageUrl: '/images/share-image.png' // 如果有分享图片可以设置
    };
  },
  
  // 分享到朋友圈
  onShareTimeline() {
    return {
      title: '小白面试通 - 好用的面试助手',
      query: '',
      imageUrl: '/images/share-image.png' // 如果有分享图片可以设置
    };
  },

  // 检查岗位是否有效
  checkPositionValid() {
    const cleanPosition = this.data.position.trim();
    const isValid = cleanPosition.length >= 2 && /[\u4e00-\u9fa5a-zA-Z]/.test(cleanPosition);
    this.setData({ isPositionValid: isValid });
    return isValid;
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
    const value = e.detail.value.trim();
    this.setData({ position: value });
    this.checkPositionValid();
  },

  async startInterview() {
    const { resumeName, position } = this.data;
    
    // 改进输入验证
    if (!position || position.trim().length === 0) {
      wx.showToast({ title: '请输入面试岗位', icon: 'none' });
      return;
    }
    
    // 检查岗位名称是否太短或无效
    if (position.trim().length < 2) {
      wx.showToast({ title: '岗位名称至少需要2个字符', icon: 'none' });
      return;
    }
    
    // 检查是否只包含空格、数字或特殊字符
    if (!/[\u4e00-\u9fa5a-zA-Z]/.test(position.trim())) {
      wx.showToast({ title: '请输入有效的岗位名称', icon: 'none' });
      return;
    }

    wx.showLoading({ title: '正在生成题目...' });
    try {
      const res = await api.startInterview({ resumeName, position: position.trim() });
      wx.hideLoading();
      
      if (!res || !res.interviewId || !res.question) {
        throw new Error('API返回数据格式错误');
      }
      
      wx.navigateTo({
        url: `../interview/interview?interviewId=${res.interviewId}&question=${encodeURIComponent(JSON.stringify(res.question))}`
      });
    } catch (e) {
      wx.hideLoading();
      console.error('面试启动失败:', e);
      
      let errorMessage = '出题失败，请重试';
      let errorDetail = '';
      
      // 检查是否是云函数返回的错误
      if (e && e.result) {
        const result = e.result;
        if (result.code) {
          errorMessage = `错误代码: ${result.code}`;
          errorDetail = result.message || '未知错误';
        } else if (result.error) {
          errorMessage = '云函数执行失败';
          errorDetail = result.error;
        } else {
          errorMessage = '云函数返回异常';
          errorDetail = JSON.stringify(result);
        }
      } else if (e && e.message) {
        if (e.message.includes('timeout') || e.message.includes('超时')) {
          errorMessage = '生成超时，请重试';
        } else if (e.message.includes('API') || e.message.includes('网络')) {
          errorMessage = '网络错误，请检查网络后重试';
        } else if (e.message.includes('AI') || e.message.includes('模型')) {
          errorMessage = '服务异常，请稍后重试';
        } else {
          errorDetail = e.message;
        }
      }
      
      const fullMessage = errorDetail ? `${errorMessage}\n\n错误详情: ${errorDetail}` : errorMessage;
      
      wx.showModal({
        title: '启动失败',
        content: fullMessage,
        showCancel: true,
        cancelText: '取消',
        confirmText: '重试',
        success: (modalRes) => {
          if (modalRes.confirm) {
            // 用户点击重试
            setTimeout(() => {
              this.startInterview();
            }, 1000);
          }
        }
      });
    }
  },

  goToHistory() {
    wx.navigateTo({
      url: '../history/history'
    });
  }
});