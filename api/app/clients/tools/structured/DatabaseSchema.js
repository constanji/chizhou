const { Tool } = require('@langchain/core/tools');
const { z } = require('zod');
const axios = require('axios');
const { logger } = require('@aipyq/data-schemas');

/**
 * Database Schema Tool - 获取数据库表结构信息
 *
 * 从 SQL API 服务器获取数据库的完整表结构信息，包括表名、列名、数据类型、索引等。
 * 用于在生成 SQL 查询前了解数据库结构。
 */
class DatabaseSchema extends Tool {
  name = 'database_schema';
  description =
    '获取数据库的实际表结构信息（语义模型）。这是获取数据库Schema的主要工具，用于SQL生成。可以获取所有表的Schema，或指定单个表的详细结构。返回的信息包括表名、列名、数据类型、是否可空、主键、索引等。使用 format="semantic" 获取语义模型格式，直接用于 text-to-sql 工具的 semantic_models 参数。这是生成SQL查询前必须调用的工具。';

  schema = z.object({
    table: z.string().optional().describe('可选：指定表名，只获取该表的结构。如果不提供，则获取所有表的结构'),
    format: z
      .enum(['detailed', 'semantic'])
      .optional()
      .describe('输出格式：detailed（详细结构）或 semantic（语义模型格式，用于SQL生成）'),
  });

  constructor(fields = {}) {
    super();
    this.apiUrl = fields.apiUrl || process.env.SQL_API_URL || 'http://localhost:3001';
  }

  /**
   * 获取数据库Schema
   */
  async getSchema(table = null) {
    try {
      const url = table ? `${this.apiUrl}/schema?table=${encodeURIComponent(table)}` : `${this.apiUrl}/schema`;
      const response = await axios.get(url, {
        timeout: 10000,
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (response.data.success) {
        return response.data;
      } else {
        throw new Error(response.data.error || '获取Schema失败');
      }
    } catch (error) {
      if (error.response) {
        const errorData = error.response.data;
        throw new Error(errorData.message || errorData.error || `HTTP ${error.response.status}`);
      } else if (error.request) {
        throw new Error(`无法连接到 SQL API 服务器: ${this.apiUrl}`);
      } else {
        throw new Error(error.message || '获取Schema失败');
      }
    }
  }

  /**
   * 转换为语义模型格式
   */
  convertToSemanticModel(schemaData) {
    if (!schemaData.schema && !schemaData.columns) {
      return [];
    }

    // 单个表的情况
    if (schemaData.columns) {
      return [
        {
          name: schemaData.table,
          description: `数据库表: ${schemaData.table}`,
          model: schemaData.table,
          columns: schemaData.columns.map((col) => ({
            name: col.column_name,
            type: col.data_type,
            nullable: col.is_nullable === 'YES',
            key: col.column_key,
            comment: col.column_comment || '',
            default: col.column_default,
          })),
          indexes: schemaData.indexes || [],
        },
      ];
    }

    // 多个表的情况
    const semanticModels = [];
    for (const [tableName, tableInfo] of Object.entries(schemaData.schema)) {
      semanticModels.push({
        name: tableName,
        description: `数据库表: ${tableName}`,
        model: tableName,
        columns: tableInfo.columns.map((col) => ({
          name: col.column_name,
          type: col.data_type,
          nullable: col.is_nullable === 'YES',
          key: col.column_key,
          comment: col.column_comment || '',
          default: col.column_default,
        })),
        indexes: tableInfo.indexes || [],
      });
    }

    return semanticModels;
  }

  /**
   * 格式化输出为可读文本
   */
  formatAsText(schemaData) {
    if (!schemaData.schema && !schemaData.columns) {
      return '未找到表结构信息';
    }

    let output = `数据库: ${schemaData.database}\n\n`;

    // 单个表的情况
    if (schemaData.columns) {
      output += `表名: ${schemaData.table}\n`;
      output += '列信息:\n';
      schemaData.columns.forEach((col) => {
        output += `  - ${col.column_name} (${col.data_type})`;
        if (col.column_key === 'PRI') output += ' [主键]';
        if (col.column_key === 'UNI') output += ' [唯一]';
        if (col.is_nullable === 'NO') output += ' [非空]';
        if (col.column_comment) output += ` - ${col.column_comment}`;
        output += '\n';
      });
      return output;
    }

    // 多个表的情况
    for (const [tableName, tableInfo] of Object.entries(schemaData.schema)) {
      output += `表名: ${tableName}\n`;
      output += '列信息:\n';
      tableInfo.columns.forEach((col) => {
        output += `  - ${col.column_name} (${col.data_type})`;
        if (col.column_key === 'PRI') output += ' [主键]';
        if (col.column_key === 'UNI') output += ' [唯一]';
        if (col.is_nullable === 'NO') output += ' [非空]';
        if (col.column_comment) output += ` - ${col.column_comment}`;
        output += '\n';
      });
      output += '\n';
    }

    return output;
  }

  /**
   * @override
   */
  async _call(input) {
    const { table, format = 'detailed' } = input;

    try {
      // 获取Schema
      const schemaData = await this.getSchema(table);

      // 根据格式返回
      if (format === 'semantic') {
        const semanticModels = this.convertToSemanticModel(schemaData);
        // 返回清晰的格式，方便主代理提取 semantic_models
        return JSON.stringify(
          {
            success: true,
            database: schemaData.database,
            semantic_models: semanticModels,
            format: 'semantic',
            instruction: 'Extract the "semantic_models" array from this response and use it as the semantic_models parameter when calling text-to-sql tool.',
          },
          null,
          2,
        );
      } else {
        // detailed 格式
        return JSON.stringify(
          {
            success: true,
            database: schemaData.database,
            schema: schemaData.schema || { [schemaData.table]: { columns: schemaData.columns, indexes: schemaData.indexes } },
            text_format: this.formatAsText(schemaData),
            format: 'detailed',
          },
          null,
          2,
        );
      }
    } catch (error) {
      logger.error('[DatabaseSchema] 获取Schema失败', {
        table,
        error: error.message,
      });

      return JSON.stringify({
        success: false,
        error: error.message,
        table: table || 'all',
      });
    }
  }
}

module.exports = DatabaseSchema;
