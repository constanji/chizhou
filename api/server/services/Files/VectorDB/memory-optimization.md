# 文件向量化内存优化说明

## 修复的内存泄漏问题

### 1. 文本文件一次性加载问题
**问题**：`readFileAsString` 虽然对大文件使用流式读取，但最终 `chunks.join('')` 会将所有内容合并成一个字符串，对于大文件会占用大量内存。

**修复**：
- 在 `chunkText` 完成后，通过立即执行函数限制 `text` 变量的作用域
- 优化 `chunkText` 函数，减少字符串副本的创建
- 只保存 trim 后的内容，减少内存占用

### 2. Promise 并发导致的内存峰值
**问题**：`storeFileVectors` 中使用 `chunks.map()` 创建所有 Promise 同时执行，对于大量 chunks（如1000+）会导致内存峰值。

**修复**：
- 改为分批执行 Promise，每批最多 20 个
- 每批完成后清理 Promise 数组
- 每处理 5 批后触发 GC（如果可用）

### 3. 中间变量未及时释放
**问题**：
- `batchEmbeddings` 数组累积向量数据
- `validBatchChunks` 数组保留 chunk 对象
- `text` 变量在整个函数执行期间都保留

**修复**：
- 每批处理后显式清理数组
- 在向量化循环中显式清理 embedding 引用
- 优化批次大小，根据文件大小动态调整

### 4. ONNX Embedding 中间结果未释放
**问题**：ONNX pipeline 的输出 Tensor 对象可能保留在内存中。

**修复**：
- 立即将 Tensor 转换为数组
- 如果 Tensor 有 `dispose()` 方法，调用它释放内存
- 在 finally 块中确保清理

## 优化措施

### 动态批次大小
```javascript
const BATCH_SIZE = chunks.length > 200 
  ? 20   // 大文件：小批次
  : chunks.length > 100 
    ? 30  // 中等文件：中等批次
    : 50; // 小文件：正常批次
```

### 分批执行 Promise
```javascript
const INSERT_BATCH_SIZE = 20; // 每批最多20个 Promise
for (let i = 0; i < chunks.length; i += INSERT_BATCH_SIZE) {
  // 处理当前批次
  await Promise.all(batchPromises);
  // 清理
  batchPromises.length = 0;
}
```

### 定期触发 GC
```javascript
if (global.gc && (i / INSERT_BATCH_SIZE) % 5 === 0) {
  global.gc();
}
```

## 预期效果

1. **内存占用降低**：大文件处理时内存占用应该显著降低
2. **GC 效率提升**：定期触发 GC 有助于及时回收内存
3. **避免内存泄漏**：显式清理引用有助于 GC 识别可回收对象

## 注意事项

1. **GC 需要启用**：如果容器未启用 GC，需要添加 `--expose-gc` 标志
2. **批次大小平衡**：批次太小会增加处理时间，批次太大会增加内存占用
3. **监控内存**：建议监控实际内存使用情况，根据实际情况调整批次大小
