// pages/interview/interview.js

// 更专业的题库，包含建议答案
const questionBank = {
  general: [
    { 
      title: '请做个自我介绍。', 
      difficulty: 1, 
      suggestedAnswer: '一个好的自我介绍应该包括：1. 你是谁（姓名、背景）。 2. 你的关键技能和经历与该职位的匹配之处。 3. 你为什么对这个职位和公司感兴趣。力求简洁、有亮点，时间控制在1-2分钟内。'
    },
    { 
      title: '你最大的优点是什么？', 
      difficulty: 2,
      suggestedAnswer: '结合具体事例来回答。例如，可以说自己学习能力强，并举一个快速掌握某项新技术的例子。或者说自己沟通能力好，并举一个成功协调团队解决冲突的例子。避免空泛地自夸。'
    },
    { 
      title: '你最大的缺点是什么？', 
      difficulty: 3,
      suggestedAnswer: '选择一个真实、无伤大雅、且正在改进的缺点。例如：“我有时会过于关注细节，导致项目初期进展稍慢，但我已经学会了更好地把握全局，在关键节点上投入精力。” 展示你的自我认知和改进意愿。'
    },
    { 
      title: '你为什么想离开上一家公司？', 
      difficulty: 3,
      suggestedAnswer: '避免抱怨前公司或同事。可以从职业发展的角度来回答，例如寻求更大的挑战、希望在某个领域深耕、或者新公司的发展方向与你的规划更契合。'
    },
    {
      title: '你对我们公司有什么了解？',
      difficulty: 2,
      suggestedAnswer: '在面试前一定要做功课。可以谈谈公司的主要产品/业务、市场地位、企业文化、近期的重要新闻等。表达你对公司的认可和兴趣。'
    },
    {
      title: '谈一下你的一次失败经历，你从中学到了什么？',
      difficulty: 4,
      suggestedAnswer: '选择一个真实的工作相关经历。重点不在于失败本身，而在于你如何分析失败原因、采取补救措施以及总结反思，体现你的问题解决能力和成长型思维。'
    },
    {
      title: '你的职业规划是什么？',
      difficulty: 3,
      suggestedAnswer: '可以分为短期（1-2年）和长期（3-5年）来谈。短期规划应与当前应聘的职位紧密相关，表明你会如何投入工作。长期规划则展示你的上进心和对行业的热情。'
    },
    {
      title: '你如何保持学习，跟上技术发展的步伐？',
      difficulty: 3,
      suggestedAnswer: '可以列举一些具体方法，如：阅读技术博客（Hacker News, InfoQ）、关注开源社区（GitHub）、参加技术会议或线上分享、阅读官方文档、在个人项目中实践新技术等。'
    },
    {
      title: '你有什么问题想问我们吗？',
      difficulty: 2,
      suggestedAnswer: '一定要提问，这表明你的积极性和思考。可以问关于团队、技术栈、职业发展路径、或者对新人的期望等问题。避免问薪资福利等过于直接的问题（除非面试官主动提及）。'
    }
  ],
  frontend: [
    { 
      title: '谈谈你对Vue和React的看法，以及它们的异同。', 
      difficulty: 4,
      suggestedAnswer: '可以从数据绑定（Vue是双向，React是单向）、组件化、性能（虚拟DOM）、生态系统等多个维度进行比较。说明你在项目中是如何根据业务场景进行技术选型的。'
    },
    { 
      title: '解释一下浏览器的事件循环（Event Loop）机制。', 
      difficulty: 5,
      suggestedAnswer: '清晰地解释调用栈、宏任务（macrotask）队列、微任务（microtask）队列的概念。说明宏任务和微任务的执行顺序，并能举例说明（如setTimeout, Promise.then, async/await）。'
    },
    {
      title: 'CSS中，如何实现一个元素的水平垂直居中？',
      difficulty: 3,
      suggestedAnswer: '至少说出3种方法。例如：1. Flexbox布局（`display: flex; justify-content: center; align-items: center;`）。 2. Grid布局。 3. 绝对定位配合transform（`position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%);`）。'
    },
    {
      title: '什么是跨域？你有哪些解决跨域问题的方法？',
      difficulty: 4,
      suggestedAnswer: '解释同源策略。解决方法包括：1. JSONP（利用<script>标签的src属性）。 2. CORS（跨源资源共享，需要后端配合设置响应头）。 3. Nginx反向代理。 4. WebSocket。'
    },
    {
      title: '你如何进行前端性能优化？',
      difficulty: 5,
      suggestedAnswer: '可以从多个方面回答：1. 资源优化（代码压缩、图片懒加载、CDN）。 2. 渲染优化（减少重绘和回流、使用CSS3硬件加速）。 3. 构建优化（代码分割、Tree Shaking）。 4. 用户体验（骨架屏、预加载）。'
    },
    {
      title: '谈谈你对 TypeScript 的理解及其优缺点。',
      difficulty: 4,
      suggestedAnswer: '优点：静态类型检查、更好的代码提示和可读性、更适合大型项目协作。缺点：需要编译、有一定的学习成本。可以结合项目经验谈谈TypeScript如何帮助你减少了运行时错误。'
    },
    {
      title: 'Webpack 和 Vite 有什么核心区别？',
      difficulty: 4,
      suggestedAnswer: '核心区别在于开发服务器的构建方式。Webpack会先打包所有模块再启动服务器（Bundle-based），启动慢。Vite利用浏览器原生的ESM支持，按需编译模块（ESM-based），启动极快。可以谈谈它们分别适用的场景。'
    },
    {
      title: '请解释一下 "this" 在 JavaScript 中的不同指向。',
      difficulty: 3,
      suggestedAnswer: '分场景讨论：1. 全局上下文（指向window或undefined）。 2. 函数调用（非严格模式下指向window，严格模式下为undefined）。 3. 对象方法调用（指向该对象）。 4. 构造函数（指向新创建的实例）。 5. 箭头函数（继承外层作用域的this）。'
    }
  ],
  backend: [
    { 
      title: '请说明RESTful API的设计原则。', 
      difficulty: 4,
      suggestedAnswer: '关键原则包括：1. 资源（Resources）：所有事物都应被抽象为资源。 2. URI（统一资源标识符）：每个资源都有唯一的URI。 3. 统一接口：使用HTTP标准方法（GET, POST, PUT, DELETE）对资源进行操作。 4. 无状态（Stateless）。 5. 表述（Representation）：资源可以有多种表现形式（如JSON, XML）。'
    },
    { 
      title: '如何设计一个高并发系统的数据库架构？', 
      difficulty: 5,
      suggestedAnswer: '可以从多个层面回答：1. 数据库选型（SQL vs NoSQL）。 2. 读写分离。 3. 数据库分库分表（水平切分、垂直切分）。 4. 使用缓存（如Redis）减轻数据库压力。 5. 数据库索引优化。 6. 考虑使用消息队列进行流量削峰。'
    },
    {
      title: '谈谈你对微服务架构的理解。',
      difficulty: 4,
      suggestedAnswer: '解释微服务是将一个大型复杂软件应用拆分成一组小型、独立、可独立部署的服务。讨论其优点（技术异构性、弹性、可扩展性、简化部署）和缺点（分布式系统复杂性、运维成本、数据一致性问题）。'
    },
    {
      title: '什么是CAP理论？在分布式系统中如何权衡？',
      difficulty: 5,
      suggestedAnswer: '解释CAP分别指一致性（Consistency）、可用性（Availability）、分区容错性（Partition tolerance）。说明在分布式系统中，P是必须保证的，因此只能在C和A之间做权衡。CP（放弃可用性，保证一致性）和AP（放弃一致性，保证可用性）是常见的选择，并能举例说明（如银行转账要求CP，社交媒体发布可接受AP）。'
    },
    {
      title: '谈谈你对数据库索引的理解，以及如何优化SQL查询？',
      difficulty: 4,
      suggestedAnswer: '解释索引是提高查询速度的数据结构。优化方法：1. 为WHERE、JOIN、ORDER BY子句中的列创建索引。 2. 避免在索引列上使用函数或计算。 3. 使用EXPLAIN分析查询计划。 4. 注意索引覆盖。 5. 避免SELECT *。'
    },
    {
      title: '在你的项目中，你是如何处理用户认证和授权的？',
      difficulty: 4,
      suggestedAnswer: '可以介绍基于Token的认证流程，特别是JWT（JSON Web Token）。流程：1. 用户登录，服务器验证成功后生成JWT返回。 2. 客户端存储JWT。 3. 每次请求时在Header中携带JWT。 4. 服务器中间件验证JWT的有效性。授权则可以通过在JWT的payload中存储用户角色或权限信息来实现。'
    },
    {
      title: '什么是Docker？它解决了什么问题？',
      difficulty: 3,
      suggestedAnswer: 'Docker是一个开源的应用容器引擎。它解决的核心问题是“环境一致性”，确保应用在开发、测试、生产环境中拥有一致的运行环境，避免了“在我电脑上能跑”的尴尬。它通过容器化技术实现了轻量级的虚拟化。'
    },
    {
      title: '解释一下TCP的三次握手和四次挥手。',
      difficulty: 5,
      suggestedAnswer: '三次握手（建立连接）：1. 客户端发送SYN。 2. 服务器回复SYN+ACK。 3. 客户端发送ACK。四次挥手（断开连接）：1. 客户端发送FIN。 2. 服务器回复ACK。 3. 服务器发送FIN。 4. 客户端回复ACK。能画出状态转换图更佳。'
    }
  ]
};

Page({
  data: {
    position: '',
    resumeName: '', // 新增
    questions: [],
    currentQuestionIndex: 0,
    userAnswer: '',
    answers: []
  },

  onLoad(options) {
    this.setData({
      position: options.position,
      resumeName: decodeURIComponent(options.resumeName) // 新增
    });
    this.generateQuestions();
  },

  generateQuestions() {
    const { position } = this.data;
    let generatedQuestions = [];
    
    // 随机抽取4个通用问题
    generatedQuestions.push(...questionBank.general.sort(() => 0.5 - Math.random()).slice(0, 4));
  
    const lowerCasePosition = position.toLowerCase();
    if (lowerCasePosition.includes('frontend') || lowerCasePosition.includes('前端')) {
      // 随机抽取5个前端问题
      generatedQuestions.push(...questionBank.frontend.sort(() => 0.5 - Math.random()).slice(0, 5));
    } else if (lowerCasePosition.includes('backend') || lowerCasePosition.includes('后端')) {
      // 随机抽取5个后端问题
      generatedQuestions.push(...questionBank.backend.sort(() => 0.5 - Math.random()).slice(0, 5));
    } else {
      // 如果岗位不明确，再加5个通用问题
      generatedQuestions.push(...questionBank.general.sort(() => 0.5 - Math.random()).slice(4, 9));
    }
    
    // 最终随机打乱问题顺序
    this.setData({
      questions: generatedQuestions.sort(() => 0.5 - Math.random())
    });
  },

  onAnswerInput(e) {
    this.setData({
      userAnswer: e.detail.value
    });
  },

  nextQuestion() {
    const { userAnswer, answers, currentQuestionIndex, questions, position, resumeName } = this.data;
    
    const newAnswers = [...answers, { question: questions[currentQuestionIndex], answer: userAnswer }];
    this.setData({
        answers: newAnswers,
        userAnswer: ''
    });

    if (currentQuestionIndex < questions.length - 1) {
      this.setData({
        currentQuestionIndex: currentQuestionIndex + 1
      });
    } else {
      // 面试结束，将完整数据存入全局，由总结页处理
      getApp().globalData.interviewData = {
        answers: newAnswers,
        position: position,
        resumeName: resumeName
      };
      wx.redirectTo({
        url: '../summary/summary'
      });
    }
  }
});