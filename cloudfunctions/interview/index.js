const cloud = require('wx-server-sdk');

// Polyfill fetch for Node 16 runtime (some SDKs rely on global fetch)
try {
  if (!globalThis.fetch) {
    globalThis.fetch = require('node-fetch');
  }
} catch (_) {}



let ZhipuAI;
try {
  ZhipuAI = require('zhipuai').ZhipuAI;
} catch (e) {
  ZhipuAI = null;
}

// Use explicit envId to match client; avoids directory mapping pitfalls during debugging
cloud.init({ env: process.env.TCB_ENV || process.env.CLOUD_ENV || cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;
const Interviews = db.collection('interviews');

let aiClient = null;
let lastAIError = null; // 追踪最近一次 AI 错误信息
let zhipuLoading = null;
async function ensureZhipu() {
  if (ZhipuAI) return true;
  if (zhipuLoading) {
    await zhipuLoading;
    return Boolean(ZhipuAI);
  }
  zhipuLoading = (async () => {
    try {
      let mod = null;
      try {
        mod = require('zhipuai');
      } catch (e1) {
        try {
          mod = await import('zhipuai');
        } catch (e2) {
          mod = null;
        }
      }
      if (mod) {
        ZhipuAI = mod.ZhipuAI || (mod.default && mod.default.ZhipuAI) || null;
      }
    } finally {
      zhipuLoading = null;
    }
  })();
  await zhipuLoading;
  return Boolean(ZhipuAI);
}

async function getAIClient() {
  if (aiClient) return aiClient;
  const sdkReady = await ensureZhipu();
  const apiKey = process.env.ZHIPUAI_API_KEY || process.env.ZHIPU_API_KEY || process.env.ZHIPU_KEY;
  if (!sdkReady || !apiKey) return null;
  aiClient = new ZhipuAI({ apiKey });
  return aiClient;
}

async function aiChat(messages, fallback, opts = {}) {
  const client = await getAIClient();
  if (!client) {
    lastAIError = 'client_not_initialized_or_api_key_missing';
    return { ok: false, text: fallback };
  }
  try {
    // 优化超时设置，平衡速度和成功率
    const envDefault = Number(process.env.AI_TIMEOUT_MS);
    const defaultTimeout = Number.isFinite(envDefault) ? Math.max(3000, Math.min(10000, Math.round(envDefault))) : 5000; // default 5s
    const timeoutMs = Number.isFinite(opts.timeoutMs) ? Math.max(3000, Math.round(opts.timeoutMs)) : defaultTimeout;
    const maxTokens = Number.isFinite(opts.maxTokens) ? Math.max(80, Math.min(800, Math.round(opts.maxTokens))) : 300;

    const resp = await Promise.race([
      client.chat.completions.create({
        model: String((opts && opts.model) || process.env.AI_MODEL || 'glm-4-air'),
        messages,
        temperature: (Number.isFinite(opts && opts.temperature) ? Math.max(0, Math.min(1, opts.temperature)) : (Number(process.env.AI_TEMPERATURE) || 0.6)),
        max_tokens: maxTokens,
      }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('ai_timeout')), timeoutMs))
    ]);
    let content = resp && resp.choices && resp.choices[0] && resp.choices[0].message && resp.choices[0].message.content;
    let text = '';
    if (Array.isArray(content)) {
      text = content.map(seg => (typeof seg === 'string' ? seg : (seg && seg.text) || '')).join('').trim();
    } else {
      text = (content || '').toString().trim();
    }
    if (!text) throw new Error('empty_ai_response');
    lastAIError = null;
    return { ok: true, text };
  } catch (e) {
    lastAIError = e?.message || String(e);
    console.error('AI error:', lastAIError);
    
    // 提供更详细的错误信息
    let errorDetail = 'AI调用失败';
    if (e.message) {
      if (e.message.includes('timeout') || e.message.includes('ai_timeout')) {
        errorDetail = 'AI响应超时';
      } else if (e.message.includes('empty_ai_response')) {
        errorDetail = 'AI返回内容为空';
      } else if (e.message.includes('client_not_initialized')) {
        errorDetail = 'AI客户端未初始化';
      } else if (e.message.includes('api_key')) {
        errorDetail = 'AI API密钥配置错误';
      } else {
        errorDetail = e.message;
      }
    }
    
    return { 
      ok: false, 
      text: fallback,
      error: errorDetail
    };
  }
}

// pickFallbackNextQuestion函数已移除，完全依赖AI生成问题

// 兜底题库已移除，完全依赖AI根据岗位生成问题

function composeSummaryPayload(itv, summaryObj) {
  // 格式化面试时间，确保显示友好
  let formattedDate = itv.date || '';
  if (formattedDate) {
    try {
      // 如果是ISO格式，转换为友好格式
      if (formattedDate.includes('T') || formattedDate.includes('Z')) {
        const date = new Date(formattedDate);
        formattedDate = date.toLocaleString('zh-CN', { 
          year: 'numeric', 
          month: '2-digit', 
          day: '2-digit', 
          hour: '2-digit', 
          minute: '2-digit',
          timeZone: 'Asia/Shanghai'
        });
      }
    } catch (e) {
      // 如果转换失败，保持原格式
    }
  }
  
  const base = {
    position: itv.position || '',
    resumeName: itv.resumeName || '',
    date: formattedDate,
    score: Number(summaryObj && summaryObj.score) || 0,
    suggestions: Array.isArray(summaryObj && summaryObj.suggestions) ? summaryObj.suggestions : [],
  };
  const answers = Array.isArray(itv.answers)
    ? itv.answers.map((a) => ({
        question: a && a.question ? a.question : null,
        answer: (a && a.answer) || '',
        reference: (a && a.reference) || '',
      }))
    : [];
  return { ...base, answers };
}


async function genNextQuestion(position, answered = [], totalQuestions = 15) {
  // 若达到题量上限，返回 null 表示结束
  const limit = Number.isFinite(Number(totalQuestions)) ? Math.max(3, Math.min(15, Math.round(totalQuestions))) : 15;
  const answeredArr = Array.isArray(answered) ? answered : [];
  if (answeredArr.length >= limit) return null;

  const titles = answeredArr.map(q => (q && q.title) || '').filter(Boolean);
  const answeredCount = answeredArr.length;

  // 精确识别岗位类型，避免串岗位
  const isFrontendPosition = /(前端|前端开发|前端工程师|前端程序员|web前端|UI开发|JavaScript|React|Vue|Angular)/i.test(position || '');
  const isBackendPosition = /(后端|后端开发|后端工程师|后端程序员|Java|Python|Go|Node\.js|服务器|API)/i.test(position || '');
  const isFullStackPosition = /(全栈|全栈开发|全栈工程师|全栈程序员)/i.test(position || '');
  const isDataPosition = /(数据|数据分析|数据工程师|算法|机器学习|AI|人工智能)/i.test(position || '');
  const isDevOpsPosition = /(运维|DevOps|运维工程师|系统运维|云原生|Docker|Kubernetes)/i.test(position || '');
  const isTestPosition = /(测试|测试工程师|QA|质量保证|自动化测试)/i.test(position || '');
  const isGeneralTechPosition = /(技术|开发|工程师|程序员|架构师)/i.test(position || '') && !isFrontendPosition && !isBackendPosition && !isFullStackPosition && !isDataPosition && !isDevOpsPosition && !isTestPosition;
  
  let sysPrompt = '';
  if (isFrontendPosition) {
    // 前端岗位：专门的前端技术问题
    if (answeredCount < 3) {
      sysPrompt = '你是一位资深前端技术面试官。请生成一个前端基础技术问题，考察候选人的HTML、CSS、JavaScript基本功。问题要具体、可操作，避免过于宽泛。';
    } else if (answeredCount < 6) {
      sysPrompt = '你是一位资深前端技术面试官。请生成一个前端项目经验相关的问题，考察候选人的实际前端项目能力和技术应用。';
    } else if (answeredCount < 9) {
      sysPrompt = '你是一位资深前端技术面试官。请生成一个前端技术深度问题，考察候选人的前端框架、性能优化、工程化等能力。';
    } else if (answeredCount < 12) {
      sysPrompt = '你是一位资深前端技术面试官。请生成一个前端系统设计问题，考察候选人的前端架构、组件设计、用户体验等能力。';
    } else {
      sysPrompt = '你是一位资深前端技术面试官。请生成一个综合性的前端技术问题，考察候选人的前端技术广度、学习能力和职业发展。';
    }
  } else if (isBackendPosition) {
    // 后端岗位：专门的后端技术问题
    if (answeredCount < 3) {
      sysPrompt = '你是一位资深后端技术面试官。请生成一个后端基础技术问题，考察候选人的编程语言、数据库、网络等基本功。';
    } else if (answeredCount < 6) {
      sysPrompt = '你是一位资深后端技术面试官。请生成一个后端项目经验相关的问题，考察候选人的实际后端项目能力和技术应用。';
    } else if (answeredCount < 9) {
      sysPrompt = '你是一位资深后端技术面试官。请生成一个后端技术深度问题，考察候选人的系统设计、性能优化、架构等能力。';
    } else if (answeredCount < 12) {
      sysPrompt = '你是一位资深后端技术面试官。请生成一个后端系统设计问题，考察候选人的微服务、分布式、高并发等能力。';
    } else {
      sysPrompt = '你是一位资深后端技术面试官。请生成一个综合性的后端技术问题，考察候选人的后端技术广度、学习能力和职业发展。';
    }
  } else if (isFullStackPosition) {
    // 全栈岗位：前后端结合的问题
    if (answeredCount < 3) {
      sysPrompt = '你是一位资深全栈技术面试官。请生成一个全栈基础技术问题，考察候选人的前后端技术基本功。';
    } else if (answeredCount < 6) {
      sysPrompt = '你是一位资深全栈技术面试官。请生成一个全栈项目经验相关的问题，考察候选人的实际全栈项目能力。';
    } else if (answeredCount < 9) {
      sysPrompt = '你是一位资深全栈技术面试官。请生成一个全栈技术深度问题，考察候选人的前后端技术理解和问题解决能力。';
    } else if (answeredCount < 12) {
      sysPrompt = '你是一位资深全栈技术面试官。请生成一个全栈系统设计问题，考察候选人的前后端架构设计能力。';
    } else {
      sysPrompt = '你是一位资深全栈技术面试官。请生成一个综合性的全栈技术问题，考察候选人的技术广度和学习能力。';
    }
  } else if (isDataPosition) {
    // 数据岗位：专门的数据和算法问题
    if (answeredCount < 3) {
      sysPrompt = '你是一位资深数据技术面试官。请生成一个数据基础技术问题，考察候选人的数据结构、算法、统计学等基本功。';
    } else if (answeredCount < 6) {
      sysPrompt = '你是一位资深数据技术面试官。请生成一个数据项目经验相关的问题，考察候选人的实际数据项目能力。';
    } else if (answeredCount < 9) {
      sysPrompt = '你是一位资深数据技术面试官。请生成一个数据技术深度问题，考察候选人的机器学习、深度学习等能力。';
    } else if (answeredCount < 12) {
      sysPrompt = '你是一位资深数据技术面试官。请生成一个数据系统设计问题，考察候选人的数据架构、ETL、数据治理等能力。';
    } else {
      sysPrompt = '你是一位资深数据技术面试官。请生成一个综合性的数据技术问题，考察候选人的数据技术广度和学习能力。';
    }
  } else if (isDevOpsPosition) {
    // 运维岗位：专门的运维和云原生问题
    if (answeredCount < 3) {
      sysPrompt = '你是一位资深运维技术面试官。请生成一个运维基础技术问题，考察候选人的Linux、网络、脚本等基本功。';
    } else if (answeredCount < 6) {
      sysPrompt = '你是一位资深运维技术面试官。请生成一个运维项目经验相关的问题，考察候选人的实际运维项目能力。';
    } else if (answeredCount < 9) {
      sysPrompt = '你是一位资深运维技术面试官。请生成一个运维技术深度问题，考察候选人的容器化、云原生、监控等能力。';
    } else if (answeredCount < 12) {
      sysPrompt = '你是一位资深运维技术面试官。请生成一个运维系统设计问题，考察候选人的CI/CD、自动化、高可用等能力。';
    } else {
      sysPrompt = '你是一位资深运维技术面试官。请生成一个综合性的运维技术问题，考察候选人的运维技术广度和学习能力。';
    }
  } else if (isTestPosition) {
    // 测试岗位：专门的测试和质量保证问题
    if (answeredCount < 3) {
      sysPrompt = '你是一位资深测试技术面试官。请生成一个测试基础技术问题，考察候选人的测试理论、测试方法等基本功。';
    } else if (answeredCount < 6) {
      sysPrompt = '你是一位资深测试技术面试官。请生成一个测试项目经验相关的问题，考察候选人的实际测试项目能力。';
    } else if (answeredCount < 9) {
      sysPrompt = '你是一位资深测试技术面试官。请生成一个测试技术深度问题，考察候选人的自动化测试、性能测试等能力。';
    } else if (answeredCount < 12) {
      sysPrompt = '你是一位资深测试技术面试官。请生成一个测试系统设计问题，考察候选人的测试架构、质量保证等能力。';
    } else {
      sysPrompt = '你是一位资深测试技术面试官。请生成一个综合性的测试技术问题，考察候选人的测试技术广度和学习能力。';
    }
  } else if (isGeneralTechPosition) {
    // 通用技术岗位：通用技术问题
    if (answeredCount < 3) {
      sysPrompt = '你是一位资深技术面试官。请生成一个基础技术问题，考察候选人的技术基本功。问题要具体、可操作，避免过于宽泛。';
    } else if (answeredCount < 6) {
      sysPrompt = '你是一位资深技术面试官。请生成一个项目经验相关的问题，考察候选人的实际项目能力和技术应用。';
    } else if (answeredCount < 9) {
      sysPrompt = '你是一位资深技术面试官。请生成一个技术深度问题，考察候选人的技术理解和解决问题的能力。';
    } else if (answeredCount < 12) {
      sysPrompt = '你是一位资深技术面试官。请生成一个系统设计或架构相关的问题，考察候选人的系统思维和设计能力。';
    } else {
      sysPrompt = '你是一位资深技术面试官。请生成一个综合性的技术问题，考察候选人的技术广度、学习能力和职业发展。';
    }
  } else {
    // 其他岗位：根据岗位名称生成相关问题，支持任何岗位类型
    if (answeredCount < 3) {
      sysPrompt = `你是一位资深${position || '技术'}面试官。请生成一个${position || '该岗位'}基础问题，考察候选人的基本功。问题要具体、可操作，避免过于宽泛。`;
    } else if (answeredCount < 6) {
      sysPrompt = `你是一位资深${position || '技术'}面试官。请生成一个${position || '该岗位'}经验相关的问题，考察候选人的实际能力和应用。`;
    } else if (answeredCount < 9) {
      sysPrompt = `你是一位资深${position || '技术'}面试官。请生成一个${position || '该岗位'}深度问题，考察候选人的问题解决能力。`;
    } else if (answeredCount < 12) {
      sysPrompt = `你是一位资深${position || '技术'}面试官。请生成一个${position || '该岗位'}设计问题，考察候选人的设计等能力。`;
    } else {
      sysPrompt = `你是一位资深${position || '技术'}面试官。请生成一个综合性的${position || '该岗位'}问题，考察候选人的广度、学习能力和职业发展。`;
    }
  }

  const usr = `岗位：${position || '软件工程师'}
已问过的问题：${titles.length ? titles.join('、') : '无'}
已答题数量：${answeredCount}
要求：
1. 生成的问题必须与已问过的问题完全不同，避免任何重复
2. 问题要具体、可操作，适合该岗位
3. 问题要有变化性，不要总是问项目经历
4. 可以问技术细节、团队协作、学习能力、问题解决等不同方面
5. 问题长度控制在20-40字之间`;

  // 增加超时时间，提高AI生成成功率
  const res = await aiChat([
    { role: 'system', content: sysPrompt },
    { role: 'user', content: usr },
  ], '', { 
    timeoutMs: Number(process.env.NEXTQ_TIMEOUT_MS) || 8000, // 增加到8000ms，大幅提高成功率
    maxTokens: 200, // 增加token数量，给AI更多空间
    temperature: 0.7 // 增加创造性
  });

  if (res && res.ok && res.text) {
    const text = String(res.text).trim().replace(/^[\-\d\.\)\s【】\[\]]+/u, '');
    if (text && !titles.includes(text)) {
      // 根据问题类型和岗位设置难度
      let difficulty = 3;
      const isTechnicalPosition = /(技术|开发|工程师|程序员|架构师|前端|后端|全栈|算法|数据|运维|测试|安卓|ios|android)/i.test(position || '');
      if (isTechnicalPosition) {
        if (answeredCount < 3) difficulty = 2; // 基础题
        else if (answeredCount < 6) difficulty = 3; // 项目题
        else if (answeredCount < 9) difficulty = 4; // 深度题
        else if (answeredCount < 12) difficulty = 4; // 设计题
        else difficulty = 3; // 综合题
      }
      return { title: text, difficulty };
    }
  }

  // AI生成失败，返回错误状态，提示用户重新点击
  return { error: 'AI生成问题失败，请重新点击获取问题' };
}


async function genReference(question, answer, position) {
  // 优化提示词，让AI更快生成
  const sys = '你是资深面试官。请针对候选人的回答给出3-4条精炼的改进建议，每条建议20-30字，直击要点，中文输出。';
  const usr = `岗位：${position || '通用'}
问题：${question || ''}
回答：${answer || ''}
请给出3-4条具体改进建议：`;

  // 优化AI调用参数，提高生成速度
  const res = await aiChat([
    { role: 'system', content: sys },
    { role: 'user', content: usr },
  ], '', {
    timeoutMs: Number(process.env.REF_TIMEOUT_MS) || 5000, // 减少到5000ms，平衡速度和质量
    maxTokens: Number(process.env.REF_MAX_TOKENS) || 200, // 减少到200，加快生成
    model: String(process.env.REF_MODEL || process.env.AI_MODEL || 'glm-4-flash'), // 使用最快的模型
    temperature: 0.3, // 降低温度，提高生成速度和稳定性
  });

  const aiText = (res && res.ok && res.text ? String(res.text).trim() : '');
  return aiText;
}

async function genSummary(itv) {
  const fallback = () => {
    const answers = Array.isArray(itv.answers) ? itv.answers : [];
    const count = answers.length || 0;
    const totalLen = answers.reduce((s, a) => s + String(a?.answer || '').trim().length, 0);
    const avgLen = count > 0 ? totalLen / count : 0;
    const avgDiff = count > 0 ? (answers.reduce((s, a) => s + (Number(a?.question?.difficulty) || 3), 0) / count) : 3;

    // 极严格的评分标准，大幅提高门槛
    let base = 5; // 大幅降低基线分数
    let qualitySum = 0;
    let totalPenalty = 0;
    
    for (const a of answers) {
      const ans = String(a?.answer || '').trim();
      const qd = Number(a?.question?.difficulty) || 3;
      const len = ans.length;
      let per = 0;
      
      // 极严格的长度评分
      if (len < 50) per += 0; // 太短不给分
      else if (len < 100) per += 1; // 偏短，给很少分
      else if (len < 200) per += 2; // 中等长度
      else if (len < 400) per += 3; // 较好长度
      else if (len < 600) per += 4; // 很好长度
      else per += 5; // 优秀长度
      
      // 量化指标加分（更严格）
      const hasNumber = /\d|%/.test(ans);
      if (hasNumber) per += 1; // 大幅降低加分
      
      // STAR框架加分（更严格）
      const hasSTAR = /(情境|任务|行动|结果|反思|STAR)/i.test(ans);
      if (hasSTAR) per += 1; // 大幅降低加分
      
      // 内容质量检查（更严格）
      const hasConcreteContent = /(项目|系统|功能|技术|方案|解决|优化|改进|架构|设计|实现|开发)/i.test(ans);
      if (hasConcreteContent) per += 1;
      
      // 专业术语检查（新增）
      const hasProfessionalTerms = /(算法|框架|工具|平台|服务|接口|协议|标准|规范|流程|方法论)/i.test(ans);
      if (hasProfessionalTerms) per += 1;
      
      // 难度加权（更严格）
      per += Math.max(-2, Math.min(2, Math.round((qd - 3) * 1)));
      
      // 低质量回答惩罚（极严格）
      if (len < 30) {
        per = 0; // 太短直接0分
        totalPenalty += 5; // 大幅增加惩罚
      } else if (/不知道|不会|随便|无|N\/?A|不清楚|不了解|不知道|不懂|没做过/i.test(ans)) {
        per = Math.max(0, per - 10); // 大幅增加惩罚
        totalPenalty += 5;
      } else if (len < 50) {
        per = Math.max(0, per - 5); // 大幅增加偏短惩罚
      } else if (len < 80) {
        per = Math.max(0, per - 2); // 增加短回答惩罚
      }
      
      // 敷衍回答检测（新增）
      if (/哈哈|呵呵|嗯嗯|好的|可以|还行|不错|一般|凑合/i.test(ans)) {
        per = Math.max(0, per - 8);
        totalPenalty += 3;
      }
      
      // 重复内容检测（新增）
      const words = ans.split(/\s+/);
      const uniqueWords = new Set(words);
      if (words.length > 0 && uniqueWords.size / words.length < 0.6) {
        per = Math.max(0, per - 3); // 重复词汇过多扣分
      }
      
      per = Math.max(0, Math.min(8, per)); // 单题最高8分（大幅降低）
      qualitySum += per;
    }
    
    const avgQuality = count > 0 ? (qualitySum / count) : 0; // 0~8

    // 完成度奖励（极严格）
    const limitInput = Number(itv.totalQuestions);
    const limit = Number.isFinite(limitInput) ? Math.max(3, Math.min(15, Math.round(limitInput))) : 8;
    const completionRatio = limit > 0 ? Math.min(1, count / limit) : 0;
    const completionBonus = Math.round(completionRatio * 5); // 大幅降低完成度奖励

    // 质量惩罚（极严格）
    let penalty = 0;
    if (avgLen < 100) penalty += 15; // 平均长度过短，大幅扣分
    else if (avgLen < 150) penalty += 8; // 中等长度，适度扣分
    else if (avgLen < 200) penalty += 3; // 偏短，轻微扣分
    
    // 计算最终分数
    let score = base + avgQuality + completionBonus - penalty - totalPenalty;
    
    // 难度微调
    score += Math.max(-5, Math.min(5, Math.round((avgDiff - 3) * 1)));
    
    // 分数范围限制
    score = Math.max(0, Math.min(70, Math.round(score))); // 最高70分，最低0分

    // 基于实际回答内容生成个性化建议
    const suggestions = [];
    
    // 分析回答质量，生成针对性建议
    if (avgLen < 100) {
      suggestions.push('回答内容严重不足，建议每个问题至少回答100字以上，包含具体细节、技术要点和实例');
    } else if (avgLen < 150) {
      suggestions.push('回答内容偏短，建议增加具体细节、技术要点和实例说明，每个问题至少150字');
    } else if (avgLen < 200) {
      suggestions.push('回答内容还可以更详细，建议增加更多技术细节和项目经验描述');
    }
    
    // 检查是否有量化指标
    const hasQuantitativeData = answers.some(a => /\d|%/.test(String(a?.answer || '')));
    if (!hasQuantitativeData) {
      suggestions.push('建议在回答中加入具体的数据、指标和成果，如"提升了30%性能"、"减少了50%错误率"等');
    }
    
    // 检查是否使用STAR框架
    const hasSTAR = answers.some(a => /(情境|任务|行动|结果|反思|STAR)/i.test(String(a?.answer || '')));
    if (!hasSTAR) {
      suggestions.push('建议使用STAR框架组织回答：情境(Situation)-任务(Task)-行动(Action)-结果(Result)-反思(Reflection)');
    }
    
    // 检查是否有具体技术内容
    const hasTechnicalContent = answers.some(a => /(项目|系统|功能|技术|方案|解决|优化|改进|架构|设计)/i.test(String(a?.answer || '')));
    if (!hasTechnicalContent) {
      suggestions.push('建议在回答中体现具体的技术细节、解决方案和实现过程，避免空泛描述');
    }
    
    // 检查回答质量
    const lowQualityAnswers = answers.filter(a => {
      const ans = String(a?.answer || '').trim();
      return ans.length < 50 || /不知道|不会|随便|无|N\/?A|不清楚|不了解/i.test(ans);
    });
    
    if (lowQualityAnswers.length > 0) {
      suggestions.push(`有${lowQualityAnswers.length}个问题回答质量较差，建议认真思考后重新作答，展现专业能力`);
    }
    
    // 根据岗位类型添加针对性建议
    if (itv.position) {
      const position = itv.position.toLowerCase();
      if (position.includes('管理') || position.includes('lead') || position.includes('主管')) {
        suggestions.push(`结合${itv.position}岗位要求，建议在回答中体现团队协作、项目管理和决策能力`);
      } else if (position.includes('技术') || position.includes('开发') || position.includes('工程师')) {
        suggestions.push(`结合${itv.position}岗位要求，建议在回答中突出技术深度、问题解决能力和技术架构思维`);
      } else if (position.includes('产品') || position.includes('运营')) {
        suggestions.push(`结合${itv.position}岗位要求，建议在回答中体现用户思维、数据分析和产品策略能力`);
      }
    }
    
    // 如果建议数量不足，补充通用建议
    while (suggestions.length < 3) {
      if (suggestions.length === 0) {
        suggestions.push('建议在回答中体现自己的思考过程、决策逻辑和问题解决能力，展示专业素养');
      } else if (suggestions.length === 1) {
        suggestions.push('建议结合具体项目经验，用实例和数据说明自己的能力和贡献，避免空泛描述');
      } else {
        suggestions.push('建议在回答中展示自己的学习能力、持续改进态度和职业发展规划');
      }
    }
    
    return { score, suggestions: suggestions.slice(0, 5) };
  };

  const prompt = [
    { 
      role: 'system', 
      content: `你是资深面试官和职业发展顾问。请根据候选人的面试表现，进行严格评估，分析其优势、不足，并给出个性化的改进建议。

要求：
1. 评分：100分制，基于回答质量、逻辑性、专业度等综合评估，要求严格公正
2. 建议：3-5条，必须基于候选人的实际回答内容，针对性强，可操作
3. 分析：结合岗位要求，指出具体改进方向
4. 格式：仅返回JSON，{"score":85,"suggestions":["具体建议1","具体建议2"]}

评分标准（要求极严格）：
- 80-100分：回答全面深入、逻辑清晰严密、专业度极高、有具体案例和数据支撑、技术细节丰富
- 70-79分：回答较好、逻辑较清晰、有一定专业性和具体内容、有技术要点
- 60-69分：回答一般、逻辑基本清晰、有一定专业性但深度不够、内容偏简单
- 50-59分：回答偏简单、逻辑不够清晰、专业性不足、缺乏具体内容
- 40-49分：回答过于简单、逻辑混乱、缺乏专业性和具体内容
- 30-39分：回答质量很差、逻辑混乱、缺乏基本专业性
- 30分以下：回答敷衍了事、内容空洞、不符合面试要求

评分原则：
- 回答过短（少于100字）不得高于50分
- 回答空洞无物不得高于40分
- 回答敷衍了事不得高于30分
- 敷衍词汇（哈哈、呵呵、还行等）出现不得高于35分
- 必须基于实际回答内容，不能给同情分
- 要求严格公正，体现真实水平` 
    },
    { 
      role: 'user', 
      content: `岗位：${itv.position || '通用'}

面试问题与回答：
${(itv.answers || []).map((a, i) => `Q${i + 1}: ${a.question?.title || ''}
A${i + 1}: ${a.answer || '未作答'}`).join('\n\n')}

请基于以上实际回答内容，给出个性化评分和改进建议。` 
    },
  ];
  // 为总结放宽 AI 超时与 tokens，尽量返回真实 AI 评分与建议
  const res = await aiChat(prompt, '', { timeoutMs: Number(process.env.SUMMARY_TIMEOUT_MS) || 8000, maxTokens: 800 });
  if (!res.ok || !res.text) {
    console.log('AI总结生成失败，使用兜底逻辑');
    return fallback();
  }
  
  try {
    const cleaned = res.text.replace(/```json|```/g, '').trim();
    const json = JSON.parse(cleaned);
    if (typeof json?.score === 'number' && Array.isArray(json?.suggestions)) {
      const score = Math.max(0, Math.min(100, Math.round(json.score)));
      const suggestions = json.suggestions.slice(0, 5);
      
      // 验证AI生成的建议质量，如果太通用则使用兜底
      const isGeneric = suggestions.some(s => 
        s.includes('建议') && (s.length < 20 || /建议.*[改进|提升|加强]/i.test(s))
      );
      
      if (isGeneric && suggestions.length < 3) {
        console.log('AI建议过于通用，使用兜底逻辑');
        return fallback();
      }
      
      console.log('AI总结生成成功，评分:', score, '建议数量:', suggestions.length);
      return { score, suggestions };
    }
  } catch (err) {
    console.log('AI总结JSON解析失败:', err.message);
  }
  
  console.log('使用兜底总结逻辑');
  return fallback();
}

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext();
  const action = event && event.action;

  try {
    // Ensure collection exists (ignore if already created)
    try { await db.createCollection('interviews'); } catch (_) {}

    if (action === 'health') {
      // 简单健康检查
      return { ok: true, now: Date.now() };
    }



    if (action === 'aiStatus') {
      const apiKeyPresent = Boolean(process.env.ZHIPUAI_API_KEY || process.env.ZHIPU_API_KEY || process.env.ZHIPU_KEY);
      const sdkReady = await ensureZhipu();
      return {
        hasZhipuSDK: Boolean(sdkReady),
        apiKeyConfigured: apiKeyPresent,
        model: 'glm-4-air',
        lastAIError: lastAIError || null,
        env: process.env.TCB_ENV || process.env.CLOUD_ENV || 'dynamic',
      };
    }



    if (action === 'start') {
      const { position, resumeName } = event || {};
      if (!position) {
        return { code: 400, message: '岗位不能为空' };
      }
      
      // 清理岗位信息
      const cleanPosition = (position || '').trim();
      if (!cleanPosition) {
        return { code: 400, message: '岗位不能为空' };
      }
      
      const totalQInput = Number(event && event.totalQuestions);
      const totalQuestions = Number.isFinite(totalQInput) ? Math.max(3, Math.min(15, Math.round(totalQInput))) : 15; // 默认15题
      const interview = {
        _openid: OPENID,
        position: cleanPosition,
        resumeName,
        date: new Date().toISOString(),
        answers: [],
        isCompleted: false,
        summary: {},
        totalQuestions,
      };
      const addRes = await Interviews.add({ data: interview });
      // 根据岗位类型生成不同的首题 - 更精确的判断逻辑
      const technicalKeywords = [
        '技术', '开发', '工程师', '程序员', '架构师', '前端', '后端', '全栈',
        '算法', '数据', '运维', '测试', '安卓', 'ios', 'android', 'java', 
        'python', 'javascript', 'react', 'vue', 'node', '数据库', '系统', 
        '网络', '安全', '云计算', '人工智能', '机器学习', '深度学习'
      ];
      
      // 检查是否包含技术关键词，但排除一些常见的非技术岗位
      const nonTechnicalKeywords = ['产品', '运营', '市场', '销售', '客服', '人事', '财务', '行政', '设计', '编辑', '翻译', '教师', '医生', '律师'];
      
      let isTechnicalPosition = false;
      if (cleanPosition.length >= 2) {
        // 检查是否包含技术关键词
        const hasTechnicalKeyword = technicalKeywords.some(keyword => 
          cleanPosition.toLowerCase().includes(keyword.toLowerCase())
        );
        
        // 检查是否包含非技术关键词
        const hasNonTechnicalKeyword = nonTechnicalKeywords.some(keyword => 
          cleanPosition.toLowerCase().includes(keyword.toLowerCase())
        );
        
        // 如果包含技术关键词且不包含非技术关键词，则认为是技术岗位
        isTechnicalPosition = hasTechnicalKeyword && !hasNonTechnicalKeyword;
      }
      
      let systemPrompt = '';
      if (isTechnicalPosition) {
        systemPrompt = "你是一位资深的技术面试官。你的任务是根据用户提供的技术岗位信息，提出一个合适的开场技术面试问题。问题应该考察候选人的技术基础、学习能力或项目经验。请严格以 JSON 格式返回，包含 'id' (字符串, 'q_1'), 'title' (字符串, 问题内容), 和 'difficulty' (数字, 1-5)。所有返回内容都必须是中文。不要返回任何非 JSON 内容。";
      } else {
        systemPrompt = "你是一位资深的面试官。你的任务是根据用户提供的岗位信息，提出一个合适的开场面试问题。请严格以 JSON 格式返回，包含 'id' (字符串, 'q_1'), 'title' (字符串, 问题内容), 和 'difficulty' (数字, 1-5)。所有返回内容都必须是中文。不要返回任何非 JSON 内容。";
      }
      
      const userPrompt = resumeName 
        ? `岗位: ${cleanPosition}，简历: ${resumeName}。请基于简历内容生成一个有针对性的开场面试问题。`
        : `岗位: ${cleanPosition}。请生成一个适合该岗位的开场面试问题。`;
      const prompt = [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ];
      
      // 根据岗位类型设置默认首题
      let firstQuestion = { id: 'q_1', title: '请做一个自我介绍，并概述你与岗位相关的经验。', difficulty: 2 };
      
      if (isTechnicalPosition) {
        // 技术岗位的默认首题
        const techFirstQuestions = [
          { id: 'q_1', title: '请介绍一下你的技术背景，以及你熟悉的技术栈。', difficulty: 2 },
          { id: 'q_1', title: '请分享一个你最近学习的新技术，以及你是如何应用的。', difficulty: 2 },
          { id: 'q_1', title: '请描述一下你参与过的最有挑战性的技术项目。', difficulty: 3 }
        ];
        firstQuestion = techFirstQuestions[Math.floor(Math.random() * techFirstQuestions.length)];
      } else {
        // 非技术岗位的默认首题
        const nonTechFirstQuestions = [
          { id: 'q_1', title: '请做一个自我介绍，并概述你与岗位相关的经验和技能。', difficulty: 2 },
          { id: 'q_1', title: '请分享一个你在工作中遇到的最大挑战，以及你是如何解决的。', difficulty: 2 },
          { id: 'q_1', title: '请描述一下你对这个岗位的理解，以及你认为最重要的能力是什么。', difficulty: 2 }
        ];
        firstQuestion = nonTechFirstQuestions[Math.floor(Math.random() * nonTechFirstQuestions.length)];
      }
      
      try {
        const res = await aiChat(prompt, '', { timeoutMs: Number(process.env.FIRSTQ_TIMEOUT_MS) || 6000, maxTokens: 300 });
        if (res && res.ok && res.text) {
          const cleaned = res.text.replace(/```json|```/g, '').trim();
          const fb = cleaned.indexOf('{');
          const lb = cleaned.lastIndexOf('}');
          const jsonStr = (fb !== -1 && lb !== -1 && lb > fb) ? cleaned.substring(fb, lb + 1) : cleaned;
          try {
            const obj = JSON.parse(jsonStr);
            if (obj && obj.title) {
              firstQuestion = { id: obj.id || 'q_1', title: obj.title, difficulty: Number(obj.difficulty) || 2 };
            }
          } catch (parseError) {
            // JSON解析失败，使用默认问题
          }
        } else if (res && !res.ok) {
          // AI调用失败，使用默认问题
        }
              } catch (aiError) {
          // AI调用异常，使用默认问题
        }
      
      return { 
        interviewId: addRes._id, 
        question: firstQuestion,
        position: cleanPosition,
        isTechnical: isTechnicalPosition
      };
    }

    if (action === 'next') {
      const { interviewId, question, answer } = event || {};
      if (!interviewId || !question || !answer) return { code: 400, message: '参数缺失' };
      const doc = await Interviews.doc(interviewId).get();
      const itv = doc.data;
      if (!itv || itv._openid !== OPENID) return { code: 404, message: '面试未找到' };

      const answers = Array.isArray(itv.answers) ? itv.answers.slice() : [];
      answers.push({ question, answer, reference: '' });

      // Decide next question via AI and whether to complete
      const answeredQuestions = answers.map(a => a.question).filter(Boolean);
      let nextQuestion = await genNextQuestion(itv.position, answeredQuestions, itv.totalQuestions);
      
      // 检查AI是否生成失败
      if (nextQuestion && nextQuestion.error) {
        // AI生成失败，不更新面试状态，返回错误信息
        return { 
          error: nextQuestion.error,
          message: 'AI生成问题失败，请重新点击获取问题'
        };
      }
      
      let isCompleted = !nextQuestion;

      await Interviews.doc(interviewId).update({
        data: {
          answers,
          isCompleted,
        },
      });

      return { nextQuestion: nextQuestion || null };
    }

    if (action === 'reference') {
      const { interviewId, questionIndex } = event || {};
      if (!interviewId || typeof questionIndex !== 'number') return { code: 400, message: '参数缺失' };

      const doc = await Interviews.doc(interviewId).get();
      const itv = doc.data;
      if (!itv || itv._openid !== OPENID) return { code: 404, message: '面试未找到' };

      const idx = Number(questionIndex);
      const answers = Array.isArray(itv.answers) ? itv.answers.slice() : [];
      if (idx < 0 || idx >= answers.length) return { code: 400, message: '索引越界' };

      const item = answers[idx] || {};

      // 已有参考建议，直接返回
      if ((item.reference || '').trim()) {
        return { status: 'ready', reference: item.reference };
      }

      // 轮询阶段：若处于生成中，则在本次请求内完成生成
      if (item.reference_processing) {
        try {
          const refText = await genReference(item?.question?.title || '', item?.answer || '', itv.position);
          
          // 清理文本，移除markdown语法，确保内容完整
          let cleanRefText = refText || '';
          cleanRefText = cleanRefText
            .replace(/```[\s\S]*?```/g, '') // 移除代码块
            .replace(/`[^`]*`/g, '') // 移除行内代码
            .replace(/\*\*([^*]+)\*\*/g, '$1') // 移除粗体
            .replace(/\*([^*]+)\*/g, '$1') // 移除斜体
            .replace(/^[\-\d\.\)\s]+/gm, '') // 移除列表标记
            .replace(/\n{3,}/g, '\n\n') // 减少多余空行
            .trim();
          
          answers[idx] = { ...item, reference: cleanRefText, reference_processing: false };
          await Interviews.doc(interviewId).update({ data: { answers } });
          return { status: 'ready', reference: cleanRefText };
        } catch (e) {
          answers[idx] = { ...item, reference: '', reference_processing: false };
          await Interviews.doc(interviewId).update({ data: { answers } });
          return { status: 'ready', reference: '' };
        }
      }

      // 首次请求：尝试快速生成（使用更快的模型和更短的超时），成功则直接返回
      try {
        // 使用更快的模型和更短的超时进行快速生成
        const quick = await aiChat([
          { role: 'system', content: '你是资深面试官。请针对候选人的回答给出3-4条精炼的改进建议，每条建议20-30字，直击要点。' },
          { role: 'user', content: `岗位：${itv.position || '通用'}
问题：${item?.question?.title || ''}
回答：${item?.answer || ''}
请给出3-4条具体改进建议：` },
        ], '', {
          timeoutMs: 3000, // 增加到3秒，提高成功率
          maxTokens: 150,  // 增加token数，确保内容完整
          model: 'glm-4-flash', // 使用更快的模型
          temperature: 0.2, // 降低温度，提高生成速度
        });
        
        if (quick && quick.ok && quick.text) {
          // 清理文本，移除markdown语法，确保内容完整
          let refText = quick.text
            .replace(/```[\s\S]*?```/g, '') // 移除代码块
            .replace(/`[^`]*`/g, '') // 移除行内代码
            .replace(/\*\*([^*]+)\*\*/g, '$1') // 移除粗体
            .replace(/\*([^*]+)\*/g, '$1') // 移除斜体
            .replace(/^[\-\d\.\)\s]+/gm, '') // 移除列表标记
            .replace(/\n{3,}/g, '\n\n') // 减少多余空行
            .trim();
          
          // 增加长度限制，确保内容完整
          if (refText.length > 600) refText = refText.slice(0, 600) + '...';
          
          answers[idx] = { ...item, reference: refText, reference_processing: false };
          await Interviews.doc(interviewId).update({ data: { answers } });
          return { status: 'ready', reference: refText };
        }
      } catch (_) {
        // 忽略错误，进入轮询
      }

      // 首次请求：标记处理中并立即返回，让前端开始轮询
      answers[idx] = { ...item, reference_processing: true };
      await Interviews.doc(interviewId).update({ data: { answers } });
      
      // 启动后台生成任务
      setTimeout(async () => {
        try {
          const refText = await genReference(item?.question?.title || '', item?.answer || '', itv.position);
          if (refText) {
            // 清理文本，移除markdown语法
            let cleanRefText = refText
              .replace(/```[\s\S]*?```/g, '')
              .replace(/`[^`]*`/g, '')
              .replace(/\*\*([^*]+)\*\*/g, '$1')
              .replace(/\*([^*]+)\*/g, '$1')
              .replace(/^[\-\d\.\)\s]+/gm, '')
              .replace(/\n{3,}/g, '\n\n')
              .trim();
            
            // 更新数据库
            const currentDoc = await Interviews.doc(interviewId).get();
            const currentAnswers = currentDoc.data.answers || [];
            if (currentAnswers[idx] && !currentAnswers[idx].reference) {
              currentAnswers[idx].reference = cleanRefText;
              currentAnswers[idx].reference_processing = false;
              await Interviews.doc(interviewId).update({ data: { answers: currentAnswers } });
            }
          }
        } catch (e) {
          // 后台生成失败，标记为处理完成，让前端可以重试
          const currentDoc = await Interviews.doc(interviewId).get();
          const currentAnswers = currentDoc.data.answers || [];
          if (currentAnswers[idx] && currentAnswers[idx].reference_processing) {
            currentAnswers[idx].reference_processing = false;
            await Interviews.doc(interviewId).update({ data: { answers: currentAnswers } });
          }
        }
      }, 1000); // 1秒后开始后台生成
      
      return { status: 'generating' };
    }

    if (action === 'summary') {
      const { interviewId } = event || {};
      if (!interviewId) return { code: 400, message: '参数缺失' };

      const doc = await Interviews.doc(interviewId).get();
      const itv = doc.data;
      if (!itv || itv._openid !== OPENID) return { code: 404, message: '面试未找到' };

      // 已有总结
      if (itv.summary && typeof itv.summary.score === 'number') {
        const payload = composeSummaryPayload(itv, itv.summary);
        return { status: 'ready', summary: payload };
      }

      // 未答完，提示继续答题
      if (!itv.isCompleted) {
        return { status: 'generating' };
      }

      // 轮询阶段：处于处理中，则本次完成生成
      if (itv.summary_processing) {
        try {
          const out = await genSummary(itv);
          await Interviews.doc(interviewId).update({ data: { summary: out, summary_processing: false } });
          const payload = composeSummaryPayload(itv, out);
          return { status: 'ready', summary: payload };
        } catch (e) {
          await Interviews.doc(interviewId).update({ data: { summary_processing: false } });
          return { status: 'failed' };
        }
      }

      // 首次请求：标记处理中并返回，让前端轮询
      await Interviews.doc(interviewId).update({ data: { summary_processing: true } });
      return { status: 'generating' };
    }

    if (action === 'status') {
      // 兼容保留：返回 SDK 初始化与最近错误概况
      const apiKeyPresent = Boolean(process.env.ZHIPUAI_API_KEY || process.env.ZHIPU_API_KEY || process.env.ZHIPU_KEY);
      const sdkReady = await ensureZhipu();
      return { ok: true, hasZhipuSDK: Boolean(sdkReady), apiKeyConfigured: apiKeyPresent, lastAIError: lastAIError || null };
    }

    if (action === 'history') {
      const { data } = await Interviews.where({ _openid: OPENID, isCompleted: true }).get();
      const filtered = (data || []).filter((i) => i.summary && typeof i.summary.score === 'number');
      const sorted = filtered.sort((a, b) => {
        try {
          const dateA = new Date(a.date || 0);
          const dateB = new Date(b.date || 0);
          return dateB.getTime() - dateA.getTime();
        } catch (e) {
          return 0; // 如果日期解析失败，保持原顺序
        }
      });
      const list = sorted.map((i) => {
        // 格式化历史记录中的时间
        let formattedDate = '未知时间';
        try {
          // 检查日期字段的类型和内容
          if (i.date) {
            let dateToParse = i.date;
            
            // 如果date是对象且有特定字段，尝试提取
            if (typeof i.date === 'object' && i.date !== null) {
              if (i.date.date) dateToParse = i.date.date;
              else if (i.date.timestamp) dateToParse = i.date.timestamp;
              else if (i.date.value) dateToParse = i.date.value;
            }
            
            // 尝试解析日期
            const date = new Date(dateToParse);
            if (!isNaN(date.getTime())) {
              formattedDate = date.toLocaleString('zh-CN', { 
                year: 'numeric', 
                month: '2-digit', 
                day: '2-digit', 
                hour: '2-digit', 
                minute: '2-digit',
                timeZone: 'Asia/Shanghai'
              });
            }
          }
        } catch (e) {
          // 时间格式化失败，使用默认值
        }
        
        return { 
          id: i._id, 
          position: i.position, 
          date: formattedDate, 
          score: i.summary.score 
        };
      });
      return list;
    }

    if (action === 'clearHistory') {
      const { data } = await Interviews.where({ _openid: OPENID }).get();
      for (const d of data) {
        await Interviews.doc(d._id).remove();
      }
      return { success: true };
    }

    return { code: 400, message: '未知 action' };
  } catch (e) {
    console.error('Interview function error:', e);
    return { code: 500, message: '服务器错误', error: String(e?.message || e) };
  }
};