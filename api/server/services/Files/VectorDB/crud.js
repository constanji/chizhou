const fs = require('fs');
const path = require('path');
const { logger } = require('@aipyq/data-schemas');
const { FileSources } = require('@aipyq/data-provider');
const VectorDBService = require('~/server/services/RAG/VectorDBService');
const EmbeddingService = require('~/server/services/RAG/EmbeddingService');
const PDFParseService = require('~/server/services/RAG/PDFParseService');
const WordParseService = require('~/server/services/RAG/WordParseService');
const { readFileAsString } = require('@aipyq/api');
const { fixFilenameEncoding } = require('~/server/utils/files');

// 初始化服务实例
const vectorDBService = new VectorDBService();
const embeddingService = new EmbeddingService();
const pdfParseService = new PDFParseService();
const wordParseService = new WordParseService();

/**
 * 简单的文本分块函数
 * @param {string} text - 要分块的文本
 * @param {number} chunkSize - 块大小（默认1000）
 * @param {number} chunkOverlap - 重叠大小（默认150）
 * @returns {Array<string>} 文本块数组
 */
function chunkText(text, chunkSize = 1000, chunkOverlap = 150) {
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
    let chunk = text.substring(startIndex, endIndex);

    // 尝试在分隔符处分割
    if (endIndex < text.length) {
      for (const separator of separators) {
        const lastIndex = chunk.lastIndexOf(separator);
        if (lastIndex > chunkSize * 0.5) {
          chunk = chunk.substring(0, lastIndex + separator.length);
          endIndex = startIndex + chunk.length;
          break;
        }
      }
    }

    if (chunk.trim().length > 0) {
      chunks.push(chunk.trim());
    }

    startIndex = endIndex - chunkOverlap;
    if (startIndex >= text.length) break;
  }

  return chunks;
}

/**
 * Deletes a file from the vector database
 * 使用本地向量数据库服务删除文件向量
 *
 * @param {ServerRequest} req - The request object from Express.
 * @param {MongoFile} file - The file object to be deleted.
 *
 * @returns {Promise<void>}
 */
const deleteVectors = async (req, file) => {
  if (!file.embedded) {
    return;
  }

  try {
    // 使用本地向量数据库服务删除
    await vectorDBService.deleteFileVectors(file.file_id);
    logger.info(`[deleteVectors] 成功删除文件向量: fileId=${file.file_id}`);
  } catch (error) {
    logger.warn('[deleteVectors] 删除文件向量失败:', error.message);
    // 不抛出错误，允许文件删除继续
  }
};

/**
 * Uploads a file to the configured Vector database
 * 使用本地 RAG 服务：文件解析 → 文本分块 → 向量化 → 存储到向量数据库
 *
 * @param {Object} params - The params object.
 * @param {Object} params.req - The request object from Express. It should have a `user` property with an `id` representing the user
 * @param {Express.Multer.File} params.file - The file object, which is part of the request. The file object should
 *                                     have a `path` property that points to the location of the uploaded file.
 * @param {string} params.file_id - The file ID.
 * @param {string} [params.entity_id] - The entity ID for shared resources.
 * @param {Object} [params.storageMetadata] - Storage metadata for dual storage pattern.
 *
 * @returns {Promise<{ filepath: string, bytes: number, embedded: boolean }>}
 *          A promise that resolves to an object containing:
 *            - filepath: The path where the file is saved.
 *            - bytes: The size of the file in bytes.
 *            - embedded: Whether the file was successfully embedded.
 */
async function uploadVectors({ req, file, file_id, entity_id, storageMetadata }) {
  try {
    // 确保向量数据库已初始化（带错误处理）
    if (!vectorDBService.initialized) {
      logger.info('[uploadVectors] 初始化向量数据库连接...');
      try {
        await vectorDBService.initialize();
      } catch (initError) {
        logger.error('[uploadVectors] 向量数据库初始化失败:', initError);
        // 如果初始化失败，返回未向量化的结果，但不阻止文件上传
        return {
          bytes: file.size,
          filename: file.originalname,
          filepath: FileSources.vectordb,
          embedded: false,
        };
      }
    }

    const userId = req.user.id;
    const filePath = file.path;
    const mimeType = file.mimetype;
    // 修复文件名编码问题（multer 可能将 UTF-8 文件名错误地按 Latin1 解码）
    const filename = fixFilenameEncoding(file.originalname);
    const fileExt = path.extname(filename).toLowerCase();

    logger.info(`[uploadVectors] 开始处理文件向量化: fileId=${file_id}, filename=${filename}, mimeType=${mimeType}`);

    let text = '';
    let chunks = [];

    // 1. 根据文件类型解析文件
    if (mimeType === 'application/pdf' || fileExt === '.pdf') {
      logger.info('[uploadVectors] 解析PDF文件');
      await pdfParseService.initialize();
      // parsePDF 已经返回分块后的结果
      chunks = await pdfParseService.parsePDF(filePath, {
        chunkSize: 1000,
        chunkOverlap: 150,
        fileMetadata: {
          file_id,
          filename,
          source: filePath,
        },
      });
    } else if (
      mimeType === 'application/msword' ||
      mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
      fileExt === '.doc' ||
      fileExt === '.docx'
    ) {
      logger.info('[uploadVectors] 解析Word文件');
      await wordParseService.initialize();
      chunks = await wordParseService.parseWordDocument(filePath, {
        chunkSize: 1000,
        chunkOverlap: 150,
        fileMetadata: {
          file_id,
          filename,
          source: filePath,
        },
      });
    } else if (
      mimeType === 'text/plain' ||
      mimeType === 'text/markdown' ||
      fileExt === '.txt' ||
      fileExt === '.md'
    ) {
      logger.info('[uploadVectors] 解析文本文件');
      const { content: text } = await readFileAsString(filePath, {
        fileSize: file.size,
      });
      const textChunks = chunkText(text, 1000, 150);
      chunks = textChunks.map((chunkText, index) => ({
        text: chunkText,
        metadata: {
          file_id,
          filename,
          source: filePath,
          chunk_index: index,
        },
      }));
    } else {
      throw new Error(`不支持的文件类型: ${mimeType}`);
    }

    if (chunks.length === 0) {
      logger.warn('[uploadVectors] 文件解析后没有文本内容');
      return {
        bytes: file.size,
        filename: filename,
        filepath: FileSources.vectordb,
        embedded: false,
      };
    }

    logger.info(`[uploadVectors] 文件解析完成，共 ${chunks.length} 个文本块`);

    // 2. 向量化每个文本块
    logger.info('[uploadVectors] 开始向量化文本块');
    const embeddings = [];
    for (let i = 0; i < chunks.length; i++) {
      try {
        const embedding = await embeddingService.embedText(chunks[i].text, userId);
        if (embedding && Array.isArray(embedding)) {
          embeddings.push(embedding);
        } else {
          logger.warn(`[uploadVectors] 文本块 ${i} 向量化失败，跳过`);
          // 移除无效的chunk
          chunks.splice(i, 1);
          i--;
        }
      } catch (embedError) {
        logger.warn(`[uploadVectors] 文本块 ${i} 向量化失败:`, embedError.message);
        // 移除失败的chunk
        chunks.splice(i, 1);
        i--;
      }
    }

    if (embeddings.length === 0) {
      logger.warn('[uploadVectors] 所有文本块向量化失败');
      return {
        bytes: file.size,
        filename: filename,
        filepath: FileSources.vectordb,
        embedded: false,
      };
    }

    logger.info(`[uploadVectors] 向量化完成，共 ${embeddings.length} 个向量`);

    // 3. 存储到向量数据库
    logger.info('[uploadVectors] 开始存储向量到数据库');
    await vectorDBService.storeFileVectors({
      fileId: file_id,
      userId: userId.toString(),
      entityId: entity_id || null,
      chunks: chunks.map((chunk, index) => ({
        text: chunk.text || chunk,
        metadata: {
          ...(chunk.metadata || {}),
          file_id,
          filename,
          entity_id: entity_id || null,
        },
      })),
      embeddings,
    });

    logger.info(`[uploadVectors] 文件向量化完成: fileId=${file_id}, chunks=${embeddings.length}`);

    return {
      bytes: file.size,
      filename: filename, // 使用解码后的文件名
      filepath: FileSources.vectordb,
      embedded: true,
    };
  } catch (error) {
    logger.error('[uploadVectors] 文件向量化失败:', error);
    // 不抛出错误，允许文件上传继续（文件已存储，只是向量化失败）
    // 确保返回的文件名也是修复后的
    const errorFilename = fixFilenameEncoding(file.originalname);
    return {
      bytes: file.size,
      filename: errorFilename,
      filepath: FileSources.vectordb,
      embedded: false,
    };
  }
}

module.exports = {
  deleteVectors,
  uploadVectors,
};
