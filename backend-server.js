require('dotenv').config(); // 读取 .env 文件
const express = require('express');
const cors = require('cors');
const { ZhipuAI } = require('zhipuai'); // 引入智谱 AI

// 启动前检查 API Key
if (!process.env.ZHIPU_API_KEY) {
    console.error("错误：未在 .env 文件中找到 ZHIPU_API_KEY。");
    console.error("请访问 https://open.bigmodel.cn/ 获取密钥并配置到 .env 文件中。");
    process.exit(1);
}

const app = express();
const port = 3001;

// 初始化智谱 AI 客户端
const zhipu = new ZhipuAI({
    apiKey: process.env.ZHIPU_API_KEY,
});

app.use(cors());
app.use(express.json());

// 模拟数据库 (保持不变)
const DB = { interviews: {} };

// AI 服务 - 基于智谱 GLM 模型
const aiService = {
    async callGLM(systemPrompt, userPrompt) {
        try {
            const completion = await zhipu.chat.completions.create({
                model: "glm-4",
                messages: [
                    { "role": "system", "content": systemPrompt },
                    { "role": "user", "content": userPrompt }
                ],
                tool_choice: "auto",
            });

            const originalResponse = completion.choices[0].message.content;

            if (!originalResponse) {
                console.error("AI response is null or empty.");
                throw new Error("AI response is null or empty.");
            }

            let contentToParse = originalResponse.trim();

            // Step 1: If the response is wrapped in Markdown, extract the content.
            const markdownMatch = contentToParse.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
            if (markdownMatch && markdownMatch[1]) {
                contentToParse = markdownMatch[1].trim();
            }

            // Step 2: Find the boundaries of the JSON object.
            const firstBrace = contentToParse.indexOf('{');
            const lastBrace = contentToParse.lastIndexOf('}');

            if (firstBrace === -1 || lastBrace === -1 || lastBrace < firstBrace) {
                // If no valid JSON object found, try to extract plain text for reference field
                if (systemPrompt.includes("提供参考思路") || userPrompt.includes("参考思路")) {
                    console.warn("No JSON found, creating fallback reference from plain text");
                    return { reference: contentToParse.replace(/^(参考思路|reference)[：:]\s*/i, '').trim() };
                }
                
                console.error("Could not find a valid JSON object in the response.", { originalResponse });
                throw new Error("No JSON object found in AI response.");
            }

            // Step 3: Extract the potential JSON string.
            let jsonString = contentToParse.substring(firstBrace, lastBrace + 1);

            // Step 4: Enhanced repair for string content
            // Handle multiple possible string fields that may contain problematic content
            const stringFields = ['reference', 'title', 'content', 'suggestions'];
            
            stringFields.forEach(field => {
                // Match field: "value" pattern and repair it - including nested fields
                const fieldPattern = new RegExp(`"${field}"\\s*:\\s*"([\\s\\S]*?)"(?=\\s*[,}])`, 'g');
                jsonString = jsonString.replace(fieldPattern, (match, capturedGroup) => {
                    // Clean and properly escape the captured content
                    let cleanContent = capturedGroup
                        .replace(/\\/g, '\\\\')  // Escape backslashes first
                        .replace(/"/g, '\\"')    // Escape quotes
                        .replace(/\n/g, '\\n')   // Escape newlines
                        .replace(/\r/g, '\\r')   // Escape carriage returns
                        .replace(/\t/g, '\\t')   // Escape tabs
                        // Fix single-quoted objects inside string values (convert to double quotes)
                        .replace(/\{'\s*([^']+?)'\s*:\s*'([^']*?)'\s*(?:,\s*'([^']+?)'\s*:\s*'([^']*?)')?\s*\}/g, (objMatch, key1, val1, key2, val2) => {
                            if (key2 && val2) {
                                return `{"${key1}": "${val1}", "${key2}": "${val2}"}`;
                            }
                            return `{"${key1}": "${val1}"}`;
                        })
                        // Fix single-quoted arrays inside string values
                        .replace(/\['\s*([^']+?)'\s*(?:,\s*'([^']*?)')?\s*(?:,\s*'([^']*?)')?\s*\]/g, (arrMatch, item1, item2, item3) => {
                            const items = [item1, item2, item3].filter(Boolean);
                            return `["${items.join('", "')}"]`;
                        })
                        // Fix incomplete arrays/objects within strings
                        .replace(/\[([^\]]*?)(?:\]|$)/g, (arrMatch, content) => {
                            if (!arrMatch.endsWith(']')) {
                                return `[${content}]`;
                            }
                            return arrMatch;
                        })
                        .replace(/\{([^\}]*?)(?:\}|$)/g, (objMatch, content) => {
                            if (!objMatch.endsWith('}')) {
                                return `{${content}}`;
                            }
                            return objMatch;
                        });
                    
                    return `"${field}": "${cleanContent}"`;
                });
            });

            // Also handle array of strings (for suggestions)
            jsonString = jsonString.replace(/"suggestions"\s*:\s*\[([\s\S]*?)\]/g, (match, items) => {
                // Fix each item in the array
                const fixedItems = items.split(',').map(item => {
                    // Remove existing quotes and add properly escaped quotes
                    const content = item.replace(/^"([\s\S]*)"$/, '$1')
                        .replace(/\\/g, '\\\\')
                        .replace(/"/g, '\\"')
                        .replace(/\n/g, '\\n')
                        .replace(/\r/g, '\\r')
                        .replace(/\t/g, '\\t');
                    return `"${content}"`;
                }).join(',');
                return `"suggestions": [${fixedItems}]`;
            });

            // Step 5: Additional cleanup for malformed JSON
            // Remove trailing commas before closing braces/brackets
            jsonString = jsonString.replace(/,(\s*[}\]])/g, '$1');
            // Fix incomplete arrays at end of string
            jsonString = jsonString.replace(/\[([^\]]*?)(?:,\s*)?$/g, '[$1]');
            // Fix incomplete objects at end of string  
            jsonString = jsonString.replace(/\{([^\}]*?)(?:,\s*)?$/g, '{$1}');
            
            // Step 6: Parse the repaired JSON string.
            try {
                const result = JSON.parse(jsonString);
                
                // Add special handling for reference field to ensure it's never set to failure message
                if (typeof result.reference === 'string' && result.reference.includes('失败')) {
                    result.reference = "参考思路生成中..."; // Use a neutral placeholder instead
                }
                
                return result;
            } catch (error) {
                console.error("Failed to parse the JSON string even after repair.", {
                    originalResponse: originalResponse.substring(0, 500) + '...',
                    repairedJsonString: jsonString.substring(0, 500) + '...',
                    parseError: error.message,
                });
                
                // Enhanced fallback: try to extract reference content more aggressively
                if (systemPrompt.includes("提供参考思路") || userPrompt.includes("参考思路")) {
                    // Method 1: Try to extract reference field directly with better regex
                    const referencePatterns = [
                        /"reference"\s*:\s*"((?:[^"\\]|\\.)*)"/,  // Standard JSON string
                        /"reference"\s*:\s*"([^"]*(?:{[^}]*}[^"]*)*)"/,  // String with objects
                        /reference["']?\s*[:=]\s*["']([^"']*(?:{[^}]*}[^"']*)*)/i,  // Loose matching
                        /"reference"\s*:\s*"([^"]*(?:\[[^\]]*\][^"]*)*)"/,  // String with arrays
                    ];
                    
                    for (const pattern of referencePatterns) {
                        const match = originalResponse.match(pattern);
                        if (match && match[1]) {
                            let content = match[1]
                                .replace(/\\"/g, '"')
                                .replace(/\\n/g, '\n')
                                .replace(/\\t/g, '\t')
                                .replace(/\\r/g, '\r')
                                .trim();
                            
                            if (content.length > 10 && !content.includes('失败')) {
                                console.log("Successfully extracted reference using fallback pattern");
                                return { reference: content };
                            }
                        }
                    }
                    
                    // Method 2: Extract content between quotes after "reference"
                    const quoteMatch = originalResponse.match(/reference["']?\s*[:=]\s*["']([^"']*)/i);
                    if (quoteMatch && quoteMatch[1] && quoteMatch[1].length > 10) {
                        const content = quoteMatch[1].trim();
                        if (!content.includes('失败') && !content.includes('error')) {
                            console.log("Extracted reference using quote matching");
                            return { reference: content };
                        }
                    }
                    
                    // Method 3: If patterns fail, try to extract readable Chinese text from the response
                    const chineseContentMatch = originalResponse.match(/([^{}"]*[\u4e00-\u9fa5][^{}"]*(?:[\u4e00-\u9fa5][^{}"]*)*)/);
                    if (chineseContentMatch && chineseContentMatch[0].length > 20) {
                        const cleanText = chineseContentMatch[0]
                            .replace(/^\W*/, '')  // Remove leading non-word chars
                            .replace(/\W*$/, '')  // Remove trailing non-word chars
                            .trim();
                        
                        if (cleanText && !cleanText.includes('失败') && !cleanText.includes('error')) {
                            console.log("Extracted Chinese content as fallback reference");
                            return { reference: cleanText };
                        }
                    }
                    
                    // Method 4: Last resort - return empty for frontend to handle
                    console.warn("All reference extraction methods failed, returning empty");
                    return { reference: "" };
                }
                
                // For other fields like score and suggestions, try direct extraction
                const scoreMatch = jsonString.match(/"score"\s*:\s*(\d+)/);
                const suggestionsMatch = jsonString.match(/"suggestions"\s*:\s*\[(.*?)\]/);
                
                if (scoreMatch || suggestionsMatch) {
                    const result = {};
                    if (scoreMatch) result.score = parseInt(scoreMatch[1], 10);
                    if (suggestionsMatch) {
                        try {
                            result.suggestions = JSON.parse(`[${suggestionsMatch[1]}]`);
                        } catch {
                            result.suggestions = ["处理建议时发生错误"];
                        }
                    }
                    return result;
                }
                
                throw new Error(`Failed to parse AI response as JSON. Reason: ${error.message}`);
            }
        } catch (error) {
            // This will catch errors from the API call itself or from our parsing logic.
            console.error("An error occurred in callGLM:", error);
            // Re-throw the original error to be handled by the caller.
            throw error;
        }
    },

    async generateFirstQuestion({ position }) {
        const systemPrompt = "你是一位资深的面试官。你的任务是根据用户提供的岗位，提出一个合适的开场面试问题。如果简历中包含工作年限，请结合考虑，否则忽略。请严格以 JSON 格式返回，包含 'id' (字符串, 'q_1'), 'title' (字符串, 问题内容), 和 'difficulty' (数字, 1-5)。所有返回内容都必须是中文。不要返回任何非 JSON 内容。";
        const userPrompt = `岗位: ${position}。请开始面试。`;
        return this.callGLM(systemPrompt, userPrompt);
    },

    async generateNextQuestion({ interview }) {
        const questionCount = interview.answers.length + 1;
        const systemPrompt = `你是一位资深的面试官，正在进行一场面试。你的任务是根据用户的岗位以及之前的提问历史，提出下一个问题。
规则：
1. 当前是第 ${questionCount} 题。
2. 面试总共应该有大约15个问题。如果已经问了15个或更多问题，请优先考虑结束面试。
3. 当决定结束面试时，请只返回一个 JSON 对象：{"end": true}。
4. 面试初期（前3个问题）可以问一些通用性的主观题，之后请专注于与“${interview.position}”岗位相关的专业技术问题。
5. 如果用户上一个回答很出色，可以适当深入追问。如果用户回答得不好或很简短，可以换一个相关领域的问题。
6. 请严格以 JSON 格式返回，包含 'id' (字符串, 'q_${questionCount}'), 'title' (字符串, 问题内容), 和 'difficulty' (数字, 1-5)。
7. 所有返回内容都必须是中文。不要返回任何非 JSON 内容。`;
        const conversationHistory = interview.answers.map((item, index) => `Q${index+1}: ${item.question.title}\n\nA${index+1}: ${item.answer}`).join('\n\n');
        const userPrompt = `岗位: ${interview.position}。\n\n面试历史:\n${conversationHistory}\n\n请提出你的下一个问题。`;
        const response = await this.callGLM(systemPrompt, userPrompt);
        if (response && response.end) return null;
        if (response && response.title) return response;
        return null;
    },

    async generateReference({ position, question, answer }) {
        const systemPrompt = `你是一位资深的面试官。你的任务是针对下面这个问题和回答，提供专业的参考思路。严格输出JSON，且只输出一行。不要输出任何除JSON以外的符号、注释、前后缀。JSON 结构：{"reference": "..."}`;
        const userPrompt = `岗位: ${position}\n\n问题: ${question.title}\n\n回答: ${answer}\n\n请仅返回一行JSON，字段为reference。`;
        const response = await this.callGLM(systemPrompt, userPrompt);
        return response ? response.reference : null;
    },

    // 评分启发式：对空、极短、无关或敷衍回答进行惩罚，避免随便填也拿到高分
    applyScoreHeuristics(aiScore, answers) {
        const safeScore = typeof aiScore === 'number' && Number.isFinite(aiScore) ? aiScore : 0;
        const total = Array.isArray(answers) ? answers.length : 0;
        if (!total) return 0;

        const nonsenseRe = /(不知道|不会|随便|乱写|不清楚|随意|N\/?A|无|没|不知道怎么|不知道为啥|不会写|不会做|随便写)/i;
        let empty = 0, short = 0, nonsense = 0;
        let trivialAll = true;

        for (const item of answers) {
            const raw = item && typeof item.answer === 'string' ? item.answer : '';
            const s = raw.trim();
            if (s.length === 0) {
                empty++;
                continue;
            }
            if (s.length < 20) short++;
            if (nonsenseRe.test(s)) nonsense++;
            if (s.length >= 10) trivialAll = false;
        }

        if (empty === total || trivialAll) return 0; // 全空或全部非常简短则直接为0

        // 基于问题级别的线性惩罚，上限防止过度惩罚
        let penalty = 0;
        penalty += Math.min(empty * 12, 48);      // 空答每题-12，最多-48
        penalty += Math.min(short * 6, 24);       // 极短每题-6，最多-24
        penalty += Math.min(nonsense * 18, 54);   // 敷衍/无关每题-18，最多-54

        const coverage = (total - empty) / total;
        if (coverage < 0.5) penalty += 10;        // 有效作答少于一半再-10

        const finalScore = Math.max(0, Math.min(100, Math.round(safeScore - penalty)));
        return finalScore;
    },

    async generateSummary({ interview }) {
        // Step 1: Generate overall score and suggestions first for quick response.
        const summarySystemPrompt = `你是一位资深面试官，将依据岗位与完整问答为候选人打分并给出改进建议。严格输出JSON且只输出一行：{"score": 0-100, "suggestions": ["...", "..."]}。评分需遵循：\n1) 正确性与深度(40%)；2) 结构与条理(20%)；3) 术语与实践经验(20%)；4) 沟通表达(10%)；5) 岗位匹配度(10%)。\n严惩：若回答为空、与题无关、明显敷衍（如“不会/不知道/随便”等）或极短（少于20字）则记为不合格。\n分数分布应真实保守：薄弱<60，普通60-75，良好76-85，优秀≥86；无充分依据切勿给高分。只返回JSON，不要任何其它内容。`;
        const conversationHistory = interview.answers.map((item, index) => `Q${index+1}: ${item.question.title}\n\nA${index+1}: ${item.answer}`).join('\n\n');
        const summaryUserPrompt = `岗位: ${interview.position}。\n\n完整的面试记录:\n${conversationHistory}\n\n请仅返回一行JSON，字段为score和suggestions（3-4条，具体可执行）。`;
        
        try {
            const summaryResponse = await this.callGLM(summarySystemPrompt, summaryUserPrompt);
            const suggestions = Array.isArray(summaryResponse?.suggestions) ? summaryResponse.suggestions : [String(summaryResponse?.suggestions || '无法生成建议。')];
            const aiScore = typeof summaryResponse?.score === 'number' ? summaryResponse.score : 0;
            const adjustedScore = this.applyScoreHeuristics(aiScore, interview.answers);
            interview.summary = {
                score: adjustedScore,
                suggestions,
            };
            // removed non-essential console.log
        } catch (e) {
            console.error(`Failed to generate base summary for interview ${interview.id}:`, e);
            interview.summary = { score: 0, suggestions: ["AI 总结生成失败，请稍后重试。"] };
            return; // Stop if base summary fails.
        }

        // Step 2: Asynchronously generate references for each answer one by one.
        (async () => {
            for (let i = 0; i < interview.answers.length; i++) {
                try {
                    const reference = await this.generateReference({
                        position: interview.position,
                        question: interview.answers[i].question,
                        answer: interview.answers[i].answer
                    });
                    // 后端不输出失败或占位文案，保持为空字符串，前端用“生成中...”动画
                    interview.answers[i].reference = (reference && String(reference).trim()) || '';
                    // removed non-essential console.log
                } catch (e) {
                    console.error(`Error generating reference for Q${i+1} of interview ${interview.id}:`, e);
                    // 失败时也不要塞失败文案，保持为空，让前端继续轮询
                    interview.answers[i].reference = '';
                }
            }
            // removed non-essential console.log
        })();
    }
};

// API 路由 (保持不变, 错误处理简化)
const handleApiError = (error, req, res) => {
    const status = error.status || 500;
    const errorMessage = error.message || "An unexpected error occurred.";
    res.status(status).json({ message: "调用 AI 服务失败，请检查后端日志。", error: { message: errorMessage } });
};

app.post('/api/interview', async (req, res) => {
    try {
        const { resumeName, position } = req.body;
        if (!position) return res.status(400).json({ message: "岗位不能为空。" });
        const interviewId = `interview_${Date.now()}`;
        const firstQuestion = await aiService.generateFirstQuestion({ position });
        DB.interviews[interviewId] = { id: interviewId, resumeName, position, date: new Date().toISOString(), answers: [], isCompleted: false, summary: null };
        console.log(`New interview started with Zhipu AI: ${interviewId}`);
        res.json({ interviewId, question: firstQuestion });
    } catch (error) {
        handleApiError(error, req, res);
    }
});

app.post('/api/interview/:id/next', async (req, res) => {
    try {
        const { id } = req.params;
        const { question, answer } = req.body;
        const interview = DB.interviews[id];
        if (!interview) return res.status(404).json({ message: '面试未找到' });
        if (!question || !answer) return res.status(400).json({ message: '问题和回答不能为空' });
        
        interview.answers.push({ question, answer });
        const MAX_QUESTIONS = 15;
        const currentQuestionCount = interview.answers.length;

        // 如果已经达到最大题目数量，直接结束面试
        if (currentQuestionCount >= MAX_QUESTIONS) {
            interview.isCompleted = true;
            // 在后台开始生成总结
            aiService.generateSummary({ interview })
                .then(() => {
                    console.log(`Summary for interview ${id} has been generated successfully.`);
                })
                .catch(err => {
                    console.error(`Error generating summary for interview ${id}:`, err);
                    interview.summary = { score: 0, suggestions: ["抱歉，AI 总结生成失败，请稍后重试。"] };
                });
            console.log(`Interview ${id} completed after reaching ${MAX_QUESTIONS} questions.`);
            return res.json({ nextQuestion: null });
        }

        // 如果还没到最大题目数，继续请求下一题
        try {
            const nextQuestion = await aiService.generateNextQuestion({ interview });
            
            // 如果 AI 决定结束面试
            if (!nextQuestion) {
                interview.isCompleted = true;
                // 在后台开始生成总结
                aiService.generateSummary({ interview })
                    .then(() => {
                        console.log(`Summary for interview ${id} has been generated successfully.`);
                    })
                    .catch(err => {
                        console.error(`Error generating summary for interview ${id}:`, err);
                        interview.summary = { score: 0, suggestions: ["抱歉，AI 总结生成失败，请稍后重试。"] };
                    });
                console.log(`Interview ${id} completed by AI decision.`);
            }
            
            res.json({ nextQuestion });
        } catch (error) {
            console.error(`Error generating next question for interview ${id}:`, error);
            // 如果生成下一题失败，为了避免面试卡住，我们也结束面试
            interview.isCompleted = true;
            aiService.generateSummary({ interview })
                .then(() => {
                    console.log(`Summary for interview ${id} has been generated successfully.`);
                })
                .catch(err => {
                    console.error(`Error generating summary for interview ${id}:`, err);
                    interview.summary = { score: 0, suggestions: ["抱歉，AI 总结生成失败，请稍后重试。"] };
                });
            res.json({ nextQuestion: null });
        }
    } catch (error) {
        handleApiError(error, req, res);
    }
});

// 按需生成参考思路的新接口
app.post('/api/interview/:id/reference', async (req, res) => {
    try {
        const { id } = req.params;
        const { questionIndex } = req.body;
        const idx = Number(questionIndex);
        console.log('[DEBUG] /reference called:', { id, questionIndex, coercedIndex: idx, type: typeof questionIndex });
        const interview = DB.interviews[id];
        
        if (!interview) {
            console.warn('[DEBUG] Interview not found:', id);
            return res.status(404).json({ message: '面试未找到' });
        }
        if (!interview.isCompleted) {
            console.warn('[DEBUG] Interview not completed yet:', id);
            return res.status(400).json({ message: '面试未完成' });
        }
        if (!Number.isInteger(idx) || idx < 0 || idx >= interview.answers.length) {
            console.warn('[DEBUG] Invalid questionIndex after coercion:', idx, 'original:', questionIndex, 'answers length:', interview.answers.length);
            return res.status(400).json({ message: '题目索引无效' });
        }

        const answerItem = interview.answers[idx];
        console.log('[DEBUG] Found answerItem:', { questionTitle: answerItem?.question?.title, hasReference: !!(answerItem?.reference && answerItem.reference.trim()) });
        
        // 如果该题已有参考思路，直接返回
        if (answerItem.reference && answerItem.reference.trim()) {
            console.log('[DEBUG] Reference already exists, returning cached.');
            return res.json({ reference: answerItem.reference });
        }

        // 生成参考思路
        try {
            console.log('[DEBUG] Generating reference via aiService.generateReference');
            const reference = await aiService.generateReference({
                position: interview.position,
                question: answerItem.question,
                answer: answerItem.answer
            });
            console.log('[DEBUG] Raw reference from AI:', reference);
            
            const cleanReference = (reference && String(reference).trim()) || '';
            answerItem.reference = cleanReference;
            
            console.log(`[DEBUG] Generated on-demand reference for Q${idx+1} of interview ${id}`);
            res.json({ reference: cleanReference });
            
        } catch (e) {
            console.error(`[DEBUG] Error generating on-demand reference for Q${idx+1} of interview ${id}:`, e);
            res.status(500).json({ message: '参考思路生成失败，请稍后重试' });
        }
    } catch (error) {
        console.error('[DEBUG] Unexpected error in /reference:', error);
        handleApiError(error, req, res);
    }
});

// 其他 API 路由保持不变
app.get('/api/interview/:id/summary', (req, res) => {
    const { id } = req.params;
    const interview = DB.interviews[id];
    if (!interview) return res.status(404).json({ message: '面试未找到' });
    if (!interview.isCompleted) return res.status(400).json({ message: '面试未完成' });

    if (interview.summary) {
        res.json({
            status: 'ready',
            summary: {
                id: interview.id,
                date: interview.date,
                position: interview.position,
                resumeName: interview.resumeName,
                score: interview.summary.score,
                suggestions: interview.summary.suggestions,
                answers: interview.answers
            }
        });
    } else {
        res.json({ status: 'generating' });
    }
});
app.get('/api/history', (req, res) => {
    const history = Object.values(DB.interviews).filter(i => i.isCompleted).map(i => ({ id: i.id, position: i.position, date: new Date(i.date).toLocaleString(), score: i.summary.score })).sort((a, b) => new Date(b.date) - new Date(a.date));
    res.json(history);
});
app.delete('/api/history', (req, res) => {
    DB.interviews = {};
    console.log('All interview history cleared.');
    res.status(200).json({ success: true });
});

app.listen(port, () => {
    console.log(`✅ Backend server with Zhipu AI is running at http://localhost:${port}`);
});