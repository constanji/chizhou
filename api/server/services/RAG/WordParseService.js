const fs = require('fs');
const { logger } = require('@aipyq/data-schemas');


class WordParseService {
  constructor() {
    this.WordExtractor = null;
    this.initialized = false;
  }

  /**
   * 初始化Word解析库
   * 使用 word-extractor 解析 .doc 和 .docx 文件
   */
  async initialize() {
    if (this.initialized) {
      return;
    }

    try {
      this.WordExtractor = require('word-extractor');
      this.initialized = true;
      logger.info('[WordParseService] word-extractor 加载成功');
    } catch (error) {
      if (error.code === 'MODULE_NOT_FOUND') {
        logger.error('[WordParseService] word-extractor 未安装');
        throw new Error('Word解析库未安装。请安装：npm install word-extractor');
      }
      throw error;
    }
  }

  /**
   * 清理文本：移除 NUL 字符和控制字符（PostgreSQL 杀手）
   * 🔥 必须在处理文本之前调用，否则会导致数据库写入失败
   * 
   * @param {string} text - 原始文本
   * @returns {string} 清理后的文本
   */
  sanitizeText(text) {
    if (!text) return '';

    return text
      // 🚨 核心：Postgres 杀手 - NUL 字符
      .replace(/\u0000/g, '')
      // 其他不可见控制字符（保留 \n \t \r）
      .replace(/[\u0001-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
      // 移除无效 UTF-8 字符
      .replace(/\uFFFD/g, '');
  }

  /**
   * 解析Word文档
   * 支持 .doc 和 .docx 格式
   * 
   * @param {string|Buffer} wordPathOrBuffer - Word文件路径或Buffer
   * @returns {Promise<{text: string, metadata: Object}>} 解析结果
   */
  async parseWord(wordPathOrBuffer) {
    if (!this.initialized) {
      await this.initialize();
    }

    try {
      let buffer;
      let filePath;

      // 处理输入：路径或Buffer
      if (Buffer.isBuffer(wordPathOrBuffer)) {
        buffer = wordPathOrBuffer;
      } else if (typeof wordPathOrBuffer === 'string') {
        filePath = wordPathOrBuffer;
        buffer = fs.readFileSync(filePath);
      } else {
        throw new Error('无效的Word输入：必须是文件路径或Buffer');
      }

      // 使用 word-extractor 解析
      const extractor = new this.WordExtractor();
      const extracted = await extractor.extract(buffer);

      if (!extracted) {
        throw new Error('Word解析失败：无法提取文档对象');
      }

      // 获取正文内容
      const text = extracted.getBody();
      
      if (!text || text.trim().length === 0) {
        throw new Error('Word解析失败：提取的文本为空');
      }

      // 提取可用的元数据（word-extractor 只支持文本提取，不支持文档属性元数据）
      // 可以尝试获取页眉、页脚、脚注等（可选）
      let headers = '';
      let footers = '';
      let footnotes = '';
      let endnotes = '';
      
      try {
        headers = extracted.getHeaders({ includeFooters: false }) || '';
      } catch (e) {
        // 忽略错误
      }
      
      try {
        footers = extracted.getFooters() || '';
      } catch (e) {
        // 忽略错误
      }
      
      try {
        footnotes = extracted.getFootnotes() || '';
      } catch (e) {
        // 忽略错误
      }
      
      try {
        endnotes = extracted.getEndnotes() || '';
      } catch (e) {
        // 忽略错误
      }

      // 合并所有文本内容（正文 + 页眉 + 页脚 + 脚注 + 尾注）
      const fullText = [
        headers,
        text,
        footers,
        footnotes,
        endnotes,
      ]
        .filter(t => t && t.trim().length > 0)
        .join('\n\n');

      // 元数据（word-extractor 不支持文档属性，所以只记录解析方法）
      const metadata = {
        parse_method: 'word-extractor',
        word_type: 'document',
        has_headers: headers.length > 0,
        has_footers: footers.length > 0,
        has_footnotes: footnotes.length > 0,
        has_endnotes: endnotes.length > 0,
      };

      return {
        text: fullText,
        metadata: metadata,
      };
    } catch (error) {
      logger.error('[WordParseService] Word解析失败:', error);
      throw new Error(`Word解析失败: ${error.message}`);
    }
  }

  /**
   * 清理文本
   * 移除页眉页脚、重复换行、多余空白等
   * 
   * @param {string} text - 原始文本
   * @returns {string} 清理后的文本
   */
  cleanText(text) {
    if (!text) return '';

    return text
      // 移除连字符换行（断词）
      .replace(/-\n/g, '')
      // 移除多个连续换行（保留最多2个）
      .replace(/\n{3,}/g, '\n\n')
      // 移除常见的页眉页脚模式
      .replace(/^\d+\s*$/gm, '') // 单独一行的数字（可能是页码）
      .replace(/^\s*-\s*\d+\s*-\s*$/gm, '') // 格式化的页码
      .replace(/Page\s+\d+/gi, '') // Page X
      .replace(/第\s*\d+\s*页/gi, '') // 第X页
      // 规范化空白字符
      .replace(/[ \t]+/g, ' ')
      // 移除行首行尾空白
      .trim();
  }

  /**
   * 将文本分块（带metadata）
   * 
   * @param {string} text - 要分块的文本
   * @param {Object} options - 分块选项
   * @param {number} options.chunkSize - 块大小（默认1000）
   * @param {number} options.chunkOverlap - 重叠大小（默认150）
   * @param {Object} options.fileMetadata - 文件元数据（file_id, filename等）
   * @returns {Array<{text: string, metadata: Object}>} 文本块数组
   */
  chunkText(text, options = {}) {
    const {
      chunkSize = 1000,
      chunkOverlap = 150,
      fileMetadata = {},
    } = options;

    if (!text || text.trim().length === 0) {
      return [];
    }

    const chunks = [];
    let startIndex = 0;

    // 分隔符优先级：从大到小
    const separators = [
      '\n\n',      // 段落分隔
      '\n',        // 行分隔
      '。',        // 中文句号
      '. ',        // 英文句号+空格
      '！',        // 中文感叹号
      '! ',        // 英文感叹号+空格
      '？',        // 中文问号
      '? ',        // 英文问号+空格
      '；',        // 中文分号
      '; ',        // 英文分号+空格
      '，',        // 中文逗号
      ', ',        // 英文逗号+空格
      ' ',         // 空格
      '',          // 字符边界（最后手段）
    ];

    // 对于超大文本，使用更高效的内存管理
    const textLength = text.length;
    const MAX_TEXT_LENGTH = 50 * 1024 * 1024; // 50MB 文本阈值
    
    if (textLength > MAX_TEXT_LENGTH) {
      logger.warn(`[WordParseService] 检测到超大文本 (${(textLength / 1024 / 1024).toFixed(2)}MB)，将使用优化的分块策略`);
    }

    // 缓存 text.length，避免重复访问
    const textLen = text.length;
    let processedChunks = 0;
    let lastStartIndex = -1; // 用于检测无限循环
    let consecutiveEmptyChunks = 0; // 连续空 chunks 计数
    let iterationCount = 0; // 迭代计数器
    const MAX_ITERATIONS = Math.max(100000, textLen / chunkSize * 2); // 最大迭代次数（安全上限）

    logger.info(`[WordParseService] 开始分块: 文本长度=${textLen}, chunkSize=${chunkSize}, 最大迭代次数=${MAX_ITERATIONS}`);

    while (startIndex < textLen) {
      iterationCount++;
      
      // 防止无限循环：检查迭代次数
      if (iterationCount > MAX_ITERATIONS) {
        logger.error(`[WordParseService] 达到最大迭代次数 ${MAX_ITERATIONS}，停止分块！startIndex=${startIndex}, textLen=${textLen}, chunks.length=${chunks.length}`);
        break;
      }
      
      // 防止无限循环：检查 startIndex 是否卡住
      if (startIndex === lastStartIndex) {
        logger.error(`[WordParseService] 检测到无限循环！startIndex=${startIndex}, textLen=${textLen}, chunks.length=${chunks.length}, iteration=${iterationCount}`);
        // 强制推进至少 chunkSize 个字符
        startIndex = Math.min(startIndex + chunkSize, textLen);
        if (startIndex >= textLen) break;
        lastStartIndex = startIndex;
        continue;
      }
      lastStartIndex = startIndex;

      let endIndex = Math.min(startIndex + chunkSize, textLen);
      
      // 防止 endIndex 等于 startIndex（会导致无限循环）
      if (endIndex <= startIndex) {
        logger.warn(`[WordParseService] endIndex <= startIndex, 强制推进: startIndex=${startIndex}, endIndex=${endIndex}`);
        endIndex = startIndex + 1;
        if (endIndex > textLen) break;
      }
      
      // 使用 substring 而不是 slice，减少内存占用（对于大文本）
      let chunkText = text.substring(startIndex, endIndex);
      let finalChunk = null;
      let foundSeparator = false;

      // 如果不是最后一块，尝试在合适的分隔符位置断开
      if (endIndex < textLen && chunkText.length > 0) {
        // 优化：只在 chunkText 中查找，避免对整个 text 操作
        for (const separator of separators) {
          if (separator === '') {
            // 空分隔符是最后手段，直接使用当前 chunk
            break;
          }

          const index = chunkText.lastIndexOf(separator);
          if (index !== -1 && index > chunkText.length * 0.3) {
            // 只在块的后 70% 部分查找，避免块太小
            finalChunk = chunkText.substring(0, index + separator.length).trim();
            endIndex = startIndex + index + separator.length;
            foundSeparator = true;
            break;
          }
        }
      }

      // 如果没有找到合适的分隔符，使用原始 chunk
      if (!foundSeparator) {
        finalChunk = chunkText.trim();
      }

      // 立即清理 chunkText（不再需要）
      chunkText = '';

      if (finalChunk && finalChunk.length > 0) {
        // 🔥 防御式：再次 sanitize（确保没有 NUL 字符）
        const sanitizedChunk = this.sanitizeText(finalChunk);
        
        if (sanitizedChunk.length > 0) {
          chunks.push({
            text: sanitizedChunk,
            metadata: {
              ...fileMetadata,
              chunk_index: chunks.length,
              source: 'word',
              parse_method: fileMetadata.parse_method || 'word-extractor',
            },
          });
          
          processedChunks++;
          consecutiveEmptyChunks = 0; // 重置计数器
          
          // 每处理一定数量的 chunks 就触发 GC（降低阈值，对所有文件都触发）
          if (global.gc && processedChunks % 50 === 0) {
            global.gc();
          }
        }
        
        // 清理
        finalChunk = '';
        sanitizedChunk = '';
      } else {
        // 空 chunk，增加计数器
        consecutiveEmptyChunks++;
        finalChunk = '';
        
        // 如果连续多个空 chunks，可能有问题，强制推进
        if (consecutiveEmptyChunks > 10) {
          logger.warn(`[WordParseService] 连续 ${consecutiveEmptyChunks} 个空 chunks，强制推进 startIndex`);
          startIndex = endIndex;
          consecutiveEmptyChunks = 0;
          continue;
        }
      }

      // 移动到下一个块的起始位置（考虑重叠）
      // 关键：无论是否有 chunks，都要确保 startIndex 前进
      const nextStartIndex = chunks.length > 0 
        ? Math.max(0, endIndex - chunkOverlap)
        : endIndex;
      
      // 强制确保 startIndex 至少前进 1 个字符（防止无限循环）
      startIndex = Math.max(nextStartIndex, startIndex + 1);
      
      // 防止无限循环：如果 startIndex 没有变化，强制推进
      if (startIndex === lastStartIndex) {
        logger.warn(`[WordParseService] startIndex 未变化，强制推进: ${startIndex} -> ${Math.min(startIndex + chunkSize, textLen)}`);
        startIndex = Math.min(startIndex + chunkSize, textLen);
      }

      // 检查是否完成
      if (startIndex >= textLen) break;
    }

    logger.info(`[WordParseService] 分块完成: 迭代次数=${iterationCount}, 生成chunks=${chunks.length}, 最终startIndex=${startIndex}, textLen=${textLen}`);
    
    // 最终 GC
    if (global.gc) {
      global.gc();
    }

    return chunks;
  }

  /**
   * 解析Word文件（主入口）
   * 完整的Word → 文本 → 清理 → 分块流程
   * 
   * @param {string|Buffer} wordPathOrBuffer - Word文件路径或Buffer
   * @param {Object} options - 解析选项
   * @param {number} options.chunkSize - 分块大小
   * @param {number} options.chunkOverlap - 重叠大小
   * @param {Object} options.fileMetadata - 文件元数据
   * @returns {Promise<Array<{text: string, metadata: Object}>>} 文本块数组
   */
  async parseWordDocument(wordPathOrBuffer, options = {}) {
    if (!this.initialized) {
      await this.initialize();
    }

    try {
      // 1. 解析Word文本
      logger.info('[WordParseService] 开始解析Word文件');
      const parseResult = await this.parseWord(wordPathOrBuffer);
      
      // 检查文本大小，提前发现问题
      const originalText = parseResult.text;
      const originalTextLength = originalText ? originalText.length : 0;
      logger.info(`[WordParseService] 解析后文本长度: ${originalTextLength} 字符 (${(originalTextLength * 2 / 1024 / 1024).toFixed(2)}MB)`);
      
      // 2. 🔥 先做 UTF-8 / NUL 清洗（必须在处理之前）
      logger.info('[WordParseService] 开始 sanitize 文本（清理 NUL 字符）');
      let sanitizedText = this.sanitizeText(originalText);
      
      // 立即触发 GC（如果可用），释放原始文本内存
      if (global.gc && originalTextLength > 10 * 1024 * 1024) { // 10MB 文本
        global.gc();
        logger.info('[WordParseService] 已触发 GC 释放解析后的文本内存');
      }
      
      // 3. 语义级清理文本（页眉页脚、页码等）
      logger.info('[WordParseService] 开始清理文本（语义级）');
      let cleanedText = this.cleanText(sanitizedText);
      
      // 清理 sanitizedText 引用（通过重新赋值）
      const cleanedTextLength = cleanedText.length;
      logger.info(`[WordParseService] 清理后文本长度: ${cleanedTextLength} 字符 (${(cleanedTextLength * 2 / 1024 / 1024).toFixed(2)}MB)`);
      
      // 清理 sanitizedText（设置为空字符串，帮助 GC）
      sanitizedText = '';
      
      // 对于超大文本，提前触发 GC
      if (global.gc && cleanedTextLength > 10 * 1024 * 1024) {
        global.gc();
      }

      // 4. 分块（chunkText 内部会再次 sanitize 防御）
      const {
        chunkSize = 1000,
        chunkOverlap = 150,
        fileMetadata = {},
      } = options;

      logger.info(`[WordParseService] 开始分块: chunkSize=${chunkSize}, chunkOverlap=${chunkOverlap}, 文本长度=${cleanedTextLength}`);
      const chunks = this.chunkText(cleanedText, {
        chunkSize,
        chunkOverlap,
        fileMetadata: {
          ...fileMetadata,
          ...parseResult.metadata,
        },
      });

      logger.info(`[WordParseService] Word解析完成: ${chunks.length} 个块`);
      
      // 清理 cleanedText 引用（设置为空字符串）
      cleanedText = '';
      
      // 最终 GC
      if (global.gc) {
        global.gc();
      }
      
      return chunks;
    } catch (error) {
      logger.error('[WordParseService] Word解析失败:', error);
      throw error;
    }
  }
}

module.exports = WordParseService;
