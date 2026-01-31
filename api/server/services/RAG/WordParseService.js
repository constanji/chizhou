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

    while (startIndex < text.length) {
      let endIndex = Math.min(startIndex + chunkSize, text.length);
      // 使用 substring 而不是 slice，减少内存占用（对于大文本）
      let chunkText = text.substring(startIndex, endIndex);

      // 如果不是最后一块，尝试在合适的分隔符位置断开
      if (endIndex < text.length) {
        let bestSeparatorIndex = -1;
        let bestSeparatorLength = 0;

        // 按优先级查找分隔符
        for (const separator of separators) {
          if (separator === '') {
            bestSeparatorIndex = endIndex;
            bestSeparatorLength = 0;
            break;
          }

          const index = chunkText.lastIndexOf(separator);
          if (index !== -1 && index > chunkText.length * 0.3) {
            // 只在块的后 70% 部分查找，避免块太小
            const separatorEnd = index + separator.length;
            if (separatorEnd > bestSeparatorIndex) {
              bestSeparatorIndex = separatorEnd;
              bestSeparatorLength = separator.length;
            }
          }
        }

        if (bestSeparatorIndex !== -1) {
          endIndex = startIndex + bestSeparatorIndex;
          chunkText = text.substring(startIndex, endIndex);
        }
      }

      chunkText = chunkText.trim();
      if (chunkText.length > 0) {
        // 🔥 防御式：再次 sanitize（确保没有 NUL 字符）
        chunkText = this.sanitizeText(chunkText);
        
        if (chunkText.length > 0) {
          chunks.push({
            text: chunkText,
            metadata: {
              ...fileMetadata,
              chunk_index: chunks.length,
              source: 'word',
              parse_method: fileMetadata.parse_method || 'word-extractor',
            },
          });
        }
      }

      // 移动到下一个块的起始位置（考虑重叠）
      if (chunks.length > 0) {
        const overlapStart = Math.max(0, endIndex - chunkOverlap);
        startIndex = overlapStart;
      } else {
        startIndex = endIndex;
      }

      // 防止无限循环
      if (startIndex >= text.length) break;
      if (startIndex === endIndex && endIndex < text.length) {
        startIndex = endIndex;
      }
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
      
      // 2. 🔥 先做 UTF-8 / NUL 清洗（必须在处理之前）
      logger.info('[WordParseService] 开始 sanitize 文本（清理 NUL 字符）');
      const sanitizedText = this.sanitizeText(parseResult.text);
      
      // 3. 语义级清理文本（页眉页脚、页码等）
      logger.info('[WordParseService] 开始清理文本（语义级）');
      const cleanedText = this.cleanText(sanitizedText);

      // 4. 分块（chunkText 内部会再次 sanitize 防御）
      const {
        chunkSize = 1000,
        chunkOverlap = 150,
        fileMetadata = {},
      } = options;

      logger.info(`[WordParseService] 开始分块: chunkSize=${chunkSize}, chunkOverlap=${chunkOverlap}`);
      const chunks = this.chunkText(cleanedText, {
        chunkSize,
        chunkOverlap,
        fileMetadata: {
          ...fileMetadata,
          ...parseResult.metadata,
        },
      });

      logger.info(`[WordParseService] Word解析完成: ${chunks.length} 个块`);
      return chunks;
    } catch (error) {
      logger.error('[WordParseService] Word解析失败:', error);
      throw error;
    }
  }
}

module.exports = WordParseService;
