const { logger } = require('@aipyq/data-schemas');

/**
 * 智能保留策略
 * 策略：保留前N条消息 + 最后M条消息，中间的消息按token限制填充
 * 
 * @example
 * const strategy = new SmartRetainStrategy({ keepFirstN: 2, keepLastM: 5 });
 * const result = await strategy.processMessages({ messages, maxContextTokens, instructions });
 */
class SmartRetainStrategy {
  constructor(options = {}) {
    this.keepFirstN = options.keepFirstN || 2;  // 默认保留前2条
    this.keepLastM = options.keepLastM || 5;     // 默认保留最后5条
  }

  /**
   * 处理消息，应用智能保留策略
   * @param {Object} params
   * @param {Array} params.messages - 消息列表
   * @param {number} params.maxContextTokens - 最大上下文token数
   * @param {Object} [params.instructions] - 指令对象
   * @returns {Promise<{context: Array, remainingContextTokens: number}>}
   */
  async processMessages({ messages, maxContextTokens, instructions }) {
    const instructionsTokenCount = instructions?.tokenCount ?? 0;
    let remainingContextTokens = maxContextTokens - instructionsTokenCount - 3; // 预留3个token
    
    const context = [];
    let currentTokenCount = 3;
    
    if (messages.length === 0) {
      return { context, remainingContextTokens };
    }
    
    // 分离前N条和剩余消息
    const firstMessages = messages.slice(0, this.keepFirstN);
    const remainingMessages = messages.slice(this.keepFirstN);
    
    // 1. 先添加前N条消息（如果token允许）
    for (const message of firstMessages) {
      const tokenCount = message.tokenCount || 0;
      if (currentTokenCount + tokenCount <= remainingContextTokens) {
        context.push(message);
        currentTokenCount += tokenCount;
      } else {
        logger.debug('[SmartRetainStrategy] Cannot fit first message, token limit reached');
        break;
      }
    }
    
    // 2. 从后往前添加最后M条消息
    const lastMessages = remainingMessages.slice(-this.keepLastM).reverse();
    const middleMessages = remainingMessages.slice(0, -this.keepLastM);
    
    for (const message of lastMessages) {
      const tokenCount = message.tokenCount || 0;
      if (currentTokenCount + tokenCount <= remainingContextTokens) {
        context.push(message);
        currentTokenCount += tokenCount;
      } else {
        break;
      }
    }
    
    // 3. 如果还有空间，尝试填充中间的消息（从后往前）
    for (const message of middleMessages.reverse()) {
      const tokenCount = message.tokenCount || 0;
      if (currentTokenCount + tokenCount <= remainingContextTokens) {
        context.push(message);
        currentTokenCount += tokenCount;
      } else {
        break;
      }
    }
    
    // 按原始顺序排序
    context.sort((a, b) => {
      const indexA = messages.findIndex(msg => msg === a || msg.messageId === a.messageId);
      const indexB = messages.findIndex(msg => msg === b || msg.messageId === b.messageId);
      return indexA - indexB;
    });
    
    remainingContextTokens -= currentTokenCount;
    
    logger.debug('[SmartRetainStrategy] Applied strategy', {
      originalCount: messages.length,
      retainedCount: context.length,
      keepFirstN: this.keepFirstN,
      keepLastM: this.keepLastM,
      currentTokenCount,
      remainingContextTokens,
    });
    
    return { context, remainingContextTokens };
  }
}

module.exports = SmartRetainStrategy;

