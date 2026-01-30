const fs = require('fs');
const { logger } = require('@aipyq/data-schemas');


class PDFParseService {
  constructor() {
    this.pdfParse = null;
    this.PDFLoader = null;
    this.useLangChain = false;
    this.initialized = false;
  }

  /**
   * 初始化PDF解析库
   * pdf-parse 优先（稳定、中文支持好），LangChain PDFLoader 作为回退方案
   */
  async initialize() {
    if (this.initialized) {
      return;
    }

    // 优先使用 pdf-parse（工业界共识：更稳定，中文支持更好）
    try {
      this.pdfParse = require('pdf-parse');
      this.useLangChain = false;
      this.initialized = true;
      logger.info('[PDFParseService] pdf-parse 作为主解析器（优先使用）');
      return;
    } catch (error) {
      if (error.code === 'MODULE_NOT_FOUND') {
        logger.debug('[PDFParseService] pdf-parse 不可用，尝试使用 LangChain PDFLoader');
      } else {
        logger.warn('[PDFParseService] pdf-parse 加载失败:', error.message);
      }
    }

    // 回退到 LangChain PDFLoader
    try {
      const { PDFLoader } = require('@langchain/community/document_loaders/fs/pdf');
      this.PDFLoader = PDFLoader;
      this.useLangChain = true;
      this.initialized = true;
      logger.warn('[PDFParseService] 回退到 LangChain PDFLoader（备选方案）');
    } catch (langchainError) {
      if (langchainError.code === 'MODULE_NOT_FOUND') {
        logger.error('[PDFParseService] LangChain PDFLoader 也不可用');
        throw new Error('PDF解析库未安装。请安装：npm install pdf-parse 或 npm install @langchain/community');
      }
      throw langchainError;
    }
  }

  /**
   * 清理文本：移除 NUL 字符和控制字符（PostgreSQL 杀手）
   * 🔥 必须在 detectPDFType 之前调用，否则会导致数据库写入失败
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
   * 检测PDF类型
   * 判断PDF属于：Text PDF / Hybrid PDF / Image PDF
   * ⚠️ 必须在 sanitizeText 之后调用，使用干净的文本
   * 
   * @param {string} text - 已清理的文本（必须经过 sanitizeText）
   * @returns {'text' | 'image' | 'hybrid'} PDF类型
   */
  detectPDFType(text) {
    if (!text) return 'image';

    const trimmed = text.trim();
    if (!trimmed) return 'image';

    // 二进制直出（pdf-parse 失败时可能返回）
    if (trimmed.startsWith('%PDF')) return 'image';

    // 使用 Unicode 属性匹配自然语言字符（支持中文、英文、数字等）
    // 计算有意义的字符比例
    const letters = (trimmed.match(/[\p{L}\p{N}]/gu) || []).length;
    const ratio = letters / trimmed.length;

    // 如果自然语言字符少于200，很可能是图片PDF
    if (letters < 200) return 'image';

    // 如果自然语言字符比例小于10%，可能是混合PDF（大量图形+少量文字）
    if (ratio < 0.1) return 'hybrid';

    return 'text';
  }

  /**
   * 解析文本PDF
   * 优先使用 LangChain PDFLoader，如果不可用则使用 pdf-parse
   * 
   * @param {string|Buffer} pdfPathOrBuffer - PDF文件路径或Buffer
   * @returns {Promise<{text: string, pages: number, metadata: Object}>} 解析结果
   */
  async parseTextPDF(pdfPathOrBuffer) {
    if (!this.initialized) {
      await this.initialize();
    }

    try {
      // 如果使用 LangChain PDFLoader
      if (this.useLangChain && this.PDFLoader) {
        return await this.parseWithLangChain(pdfPathOrBuffer);
      }

      // 否则使用 pdf-parse
      return await this.parseWithPdfParse(pdfPathOrBuffer);
    } catch (error) {
      logger.error('[PDFParseService] 文本PDF解析失败:', error);
      throw new Error(`PDF解析失败: ${error.message}`);
    }
  }

  /**
   * 使用 LangChain PDFLoader 解析PDF
   * 
   * @param {string|Buffer} pdfPathOrBuffer - PDF文件路径或Buffer
   * @returns {Promise<{text: string, pages: number, metadata: Object}>} 解析结果
   */
  async parseWithLangChain(pdfPathOrBuffer) {
    let pdfPath;
    
    // 如果是Buffer，需要先写入临时文件
    if (Buffer.isBuffer(pdfPathOrBuffer)) {
      const path = require('path');
      const os = require('os');
      pdfPath = path.join(os.tmpdir(), `pdf_${Date.now()}_${Math.random().toString(36).substr(2, 9)}.pdf`);
      fs.writeFileSync(pdfPath, pdfPathOrBuffer);
    } else if (typeof pdfPathOrBuffer === 'string') {
      pdfPath = pdfPathOrBuffer;
    } else {
      throw new Error('无效的PDF输入：必须是文件路径或Buffer');
    }

    try {
      const loader = new this.PDFLoader(pdfPath);
      const documents = await loader.load();

      if (!documents || documents.length === 0) {
        throw new Error('LangChain PDFLoader 返回空文档');
      }

      // 合并所有文档的文本
      const texts = documents.map(doc => doc.pageContent || '');
      const fullText = texts.join('\n\n');

      if (!fullText || fullText.trim().length < 200) {
        throw new Error('Text PDF解析失败：提取的文本过少');
      }

      // 提取页码信息（LangChain 通常会在 metadata 中包含页码）
      const pages = documents.length;
      const metadata = documents[0]?.metadata || {};

      // 清理临时文件
      if (Buffer.isBuffer(pdfPathOrBuffer) && fs.existsSync(pdfPath)) {
        try {
          fs.unlinkSync(pdfPath);
        } catch (e) {
          logger.warn('[PDFParseService] 清理临时文件失败:', e.message);
        }
      }

      return {
        text: fullText,
        pages: pages,
        metadata: {
          ...metadata,
          parse_method: 'langchain-pdfloader',
          pdf_type: 'text',
          langchain_version: '1.1.8',
        },
      };
    } catch (error) {
      // 清理临时文件
      if (Buffer.isBuffer(pdfPathOrBuffer) && fs.existsSync(pdfPath)) {
        try {
          fs.unlinkSync(pdfPath);
        } catch (e) {
          // 忽略清理错误
        }
      }
      throw error;
    }
  }

  /**
   * 使用 pdf-parse 解析PDF
   * 
   * @param {string|Buffer} pdfPathOrBuffer - PDF文件路径或Buffer
   * @returns {Promise<{text: string, pages: number, metadata: Object}>} 解析结果
   */
  async parseWithPdfParse(pdfPathOrBuffer) {
    // 读取PDF文件
    let buffer;
    if (Buffer.isBuffer(pdfPathOrBuffer)) {
      buffer = pdfPathOrBuffer;
    } else if (typeof pdfPathOrBuffer === 'string') {
      buffer = fs.readFileSync(pdfPathOrBuffer);
    } else {
      throw new Error('无效的PDF输入：必须是文件路径或Buffer');
    }

    // 使用 pdf-parse 解析
    const data = await this.pdfParse(buffer);

    if (!data.text || data.text.trim().length < 200) {
      throw new Error('Text PDF解析失败：提取的文本过少');
    }

    return {
      text: data.text,
      pages: data.numpages || 1,
      metadata: {
        info: data.info || {},
        parse_method: 'pdf-parse',
        pdf_type: 'text',
      },
    };
  }

  /**
   * 清理文本
   * 移除页眉页脚、重复页码、连字符换行等
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
      // 移除页码（Page X 或 第X页）
      .replace(/Page\s+\d+/gi, '')
      .replace(/第\s*\d+\s*页/gi, '')
      // 移除常见的页眉页脚模式
      .replace(/^\d+\s*$/gm, '') // 单独一行的数字（可能是页码）
      .replace(/^\s*-\s*\d+\s*-\s*$/gm, '') // 格式化的页码
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
   * @param {number} options.chunkSize - 块大小（默认800-1200）
   * @param {number} options.chunkOverlap - 重叠大小（默认100-200）
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

    while (startIndex < text.length) {
      let endIndex = Math.min(startIndex + chunkSize, text.length);
      let chunkText = text.slice(startIndex, endIndex);

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
          chunkText = text.slice(startIndex, endIndex);
        }
      }

      chunkText = chunkText.trim();
      if (chunkText.length > 0) {
        // 🔥 防御式：再次 sanitize（确保没有 NUL 字符）
        chunkText = this.sanitizeText(chunkText);
        
        if (chunkText.length > 0) {
          // 估算页码（简单方法：基于字符位置）
          const estimatedPage = Math.floor(startIndex / (text.length / (fileMetadata.pages || 1))) + 1;
          
          chunks.push({
            text: chunkText,
            metadata: {
              ...fileMetadata,
              chunk_index: chunks.length,
              page_start: estimatedPage,
              page_end: estimatedPage,
              source: 'pdf',
              parse_method: fileMetadata.parse_method || (this.useLangChain ? 'langchain-pdfloader' : 'pdf-parse'),
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
   * 解析PDF文件（主入口）
   * 完整的PDF → 文本 → 清理 → 分块流程
   * 
   * @param {string|Buffer} pdfPathOrBuffer - PDF文件路径或Buffer
   * @param {Object} options - 解析选项
   * @param {number} options.chunkSize - 分块大小
   * @param {number} options.chunkOverlap - 重叠大小
   * @param {Object} options.fileMetadata - 文件元数据
   * @returns {Promise<Array<{text: string, metadata: Object}>>} 文本块数组
   */
  async parsePDF(pdfPathOrBuffer, options = {}) {
    if (!this.initialized) {
      await this.initialize();
    }

    try {
      // 1. 解析PDF文本
      logger.info('[PDFParseService] 开始解析PDF文件');
      const parseResult = await this.parseTextPDF(pdfPathOrBuffer);
      
      // 2. 🔥 先做 UTF-8 / NUL 清洗（必须在 detect 之前）
      logger.info('[PDFParseService] 开始 sanitize 文本（清理 NUL 字符）');
      const sanitizedText = this.sanitizeText(parseResult.text);
      
      // 3. 检测PDF类型（使用干净的文本）
      const pdfType = this.detectPDFType(sanitizedText);
      logger.info(`[PDFParseService] PDF类型: ${pdfType}`);

      // 如果是图片PDF，记录警告（当前不支持OCR）
      if (pdfType === 'image') {
        logger.warn('[PDFParseService] 检测到图片PDF，当前仅支持文本PDF解析');
        // 可以在这里添加OCR支持
      }

      // 4. 语义级清理文本（页眉页脚、页码等）
      logger.info('[PDFParseService] 开始清理文本（语义级）');
      const cleanedText = this.cleanText(sanitizedText);

      // 5. 分块（chunkText 内部会再次 sanitize 防御）
      const {
        chunkSize = 1000,
        chunkOverlap = 150,
        fileMetadata = {},
      } = options;

      logger.info(`[PDFParseService] 开始分块: chunkSize=${chunkSize}, chunkOverlap=${chunkOverlap}`);
      const chunks = this.chunkText(cleanedText, {
        chunkSize,
        chunkOverlap,
        fileMetadata: {
          ...fileMetadata,
          pages: parseResult.pages,
          pdf_type: pdfType,
          parse_method: parseResult.metadata.parse_method,
        },
      });

      logger.info(`[PDFParseService] PDF解析完成: ${chunks.length} 个块`);
      return chunks;
    } catch (error) {
      logger.error('[PDFParseService] PDF解析失败:', error);
      throw error;
    }
  }
}

module.exports = PDFParseService;
