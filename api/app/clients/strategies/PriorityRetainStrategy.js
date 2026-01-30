const { logger } = require('@aipyq/data-schemas');

/**
 * 优先级保留策略
 * 策略：根据关键词优先级和消息位置，智能选择要保留的消息
 * 
 * @example
 * const strategy = new PriorityRetainStrategy({ 
 *   priorityKeywords: ['重要', '关键'],
 *   recencyWeight: 0.2 
 * });
 * const result = await strategy.processMessages({ messages, maxContextTokens, instructions });
 */
class PriorityRetainStrategy {
  constructor(options = {}) {
    this.priorityKeywords = options.priorityKeywords || [];
    this.recencyWeight = options.recencyWeight || 0.1; // 新消息权重
    this.keywordWeight = options.keywordWeight || 10;  // 关键词权重
  }

  /**
   * 计算消息的优先级分数
   * @param {Object} message - 消息对象
   * @param {number} index - 消息在列表中的索引
   * @param {number} totalMessages - 总消息数
   * @returns {number} 优先级分数
   */
  calculatePriority(message, index, totalMessages) {
    let priority = 0;
    
    // 提取消息内容
    let content = '';
    if (typeof message.content === 'string') {
      content = message.content;
    } else if (Array.isArray(message.content)) {
      content = message.content
        .filter(item => item.type === 'text')
        .map(item => item.text || '')
        .join(' ');
    } else if (message.text) {
      content = message.text;
    }
    
    const lowerContent = content.toLowerCase();
    
    // 检查优先级关键词
    for (const keyword of this.priorityKeywords) {
      if (lowerContent.includes(keyword.toLowerCase())) {
        priority += this.keywordWeight;
      }
    }
    
    // 新消息优先级更高（越靠后权重越高）
    const recencyScore = (totalMessages - index) * this.recencyWeight;
    priority += recencyScore;
    
    // 第一条消息总是很重要
    if (index === 0) {
      priority += 5;
    }
    
    return priority;
  }

  /**
   * 处理消息，应用优先级保留策略
   * @param {Object} params
   * @param {Array} params.messages - 消息列表
   * @param {number} params.maxContextTokens - 最大上下文token数
   * @param {Object} [params.instructions] - 指令对象
   * @returns {Promise<{context: Array, remainingContextTokens: number}>}
   */
  async processMessages({ messages, maxContextTokens, instructions }) {
    const instructionsTokenCount = instructions?.tokenCount ?? 0;
    let remainingContextTokens = maxContextTokens - instructionsTokenCount - 3;
    
    if (messages.length === 0) {
      return { context: [], remainingContextTokens };
    }
    
    // 计算每条消息的优先级
    const messagesWithPriority = messages.map((msg, index) => ({
      ...msg,
      priority: this.calculatePriority(msg, index, messages.length),
      originalIndex: index,
    }));
    
    // 按优先级排序（高优先级在前）
    messagesWithPriority.sort((a, b) => b.priority - a.priority);
    
    // 选择消息直到达到token限制
    const context = [];
    let currentTokenCount = 3;
    
    for (const message of messagesWithPriority) {
      const tokenCount = message.tokenCount || 0;
      if (currentTokenCount + tokenCount <= remainingContextTokens) {
        context.push(message);
        currentTokenCount += tokenCount;
      } else {
        break;
      }
    }
    
    // 按原始顺序重新排序
    context.sort((a, b) => {
      const indexA = a.originalIndex !== undefined ? a.originalIndex : messages.indexOf(a);
      const indexB = b.originalIndex !== undefined ? b.originalIndex : messages.indexOf(b);
      return indexA - indexB;
    });
    
    // 清理临时属性
    context.forEach(msg => {
      delete msg.priority;
      delete msg.originalIndex;
    });
    
    remainingContextTokens -= currentTokenCount;
    
    logger.debug('[PriorityRetainStrategy] Applied strategy', {
      originalCount: messages.length,
      retainedCount: context.length,
      priorityKeywords: this.priorityKeywords,
      currentTokenCount,
      remainingContextTokens,
    });
    
    return { context, remainingContextTokens };
  }
}

module.exports = PriorityRetainStrategy;

