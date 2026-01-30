import { useState, useRef, useCallback } from 'react';
import { FileSources, FileContext } from '@aipyq/data-provider';
import type { TFile } from '@aipyq/data-provider';
import { OGDialog, OGDialogContent, OGDialogHeader, OGDialogTitle, Button, Input, Spinner, useToastContext } from '@aipyq/client';
import { useGetKnowledgeListQuery, useAddKnowledgeMutation, useDeleteKnowledgeMutation, useRAGQuery, type KnowledgeEntry } from '~/data-provider/KnowledgeBase';
import { useUploadFileMutation, useFileContent } from '~/data-provider/Files';
import { useLocalize } from '~/hooks';
import { useRecoilValue } from 'recoil';
import store from '~/store';
import { cn } from '~/utils';
import { Upload, Trash2, Search, FileText, X, Eye, XCircle } from 'lucide-react';

const KnowledgeType = {
  FILE: 'file',
  BUSINESS_KNOWLEDGE: 'business_knowledge',
};

export default function KnowledgeBaseFilesView({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const localize = useLocalize();
  const { showToast } = useToastContext();
  const user = useRecoilValue(store.user);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [ragTestQuery, setRagTestQuery] = useState('');
  const [selectedFileId, setSelectedFileId] = useState<string | null>(null);
  const [viewingFileId, setViewingFileId] = useState<string | null>(null);

  // 查询知识库文件列表（只查询文件类型）
  const { data: knowledgeList, isLoading, refetch } = useGetKnowledgeListQuery({
    type: KnowledgeType.BUSINESS_KNOWLEDGE,
    limit: 100,
  });

  // 添加知识条目 mutation
  const addKnowledgeMutation = useAddKnowledgeMutation();

  // 文件上传 mutation
  const uploadFileMutation = useUploadFileMutation({
    onSuccess: async (fileData: TFile) => {
      try {
        // 文件上传成功后，添加到知识库
        await addKnowledgeMutation.mutateAsync({
          type: KnowledgeType.BUSINESS_KNOWLEDGE,
          data: {
            fileId: fileData.file_id,
            filename: fileData.filename,
            title: fileData.filename,
          },
        });
        showToast({
          message: '文件上传并向量化成功',
          status: 'success',
        });
        refetch();
      } catch (error: any) {
        showToast({
          message: `添加到知识库失败: ${error.message || '未知错误'}`,
          status: 'error',
        });
      }
    },
    onError: (error: any) => {
      showToast({
        message: `文件上传失败: ${error.message || '未知错误'}`,
        status: 'error',
      });
    },
  });

  // 删除知识条目 mutation
  const deleteKnowledgeMutation = useDeleteKnowledgeMutation({
    onSuccess: () => {
      showToast({
        message: '删除成功',
        status: 'success',
      });
      refetch();
    },
    onError: (error: any) => {
      showToast({
        message: `删除失败: ${error.message || '未知错误'}`,
        status: 'error',
      });
    },
  });

  // RAG 测试查询
  const { data: ragResults, isLoading: isRagLoading, refetch: refetchRAG } = useRAGQuery(
    ragTestQuery,
    selectedFileId ? { fileIds: [selectedFileId] } : undefined,
    {
      enabled: false, // 手动触发
    },
  );

  // 文件内容查询
  const { data: fileContent, isLoading: isContentLoading, refetch: refetchContent } = useFileContent(
    user?.id,
    viewingFileId || undefined,
  );

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const formData = new FormData();
    formData.append('file', file);
    formData.append('endpoint', 'agents');
    formData.append('tool_resource', 'file_search'); // 使用 file_search 工具资源，会自动向量化

    uploadFileMutation.mutate(formData);
  }, [uploadFileMutation]);

  const handleUploadClick = () => {
    fileInputRef.current?.click();
  };

  const handleDelete = (entry: KnowledgeEntry) => {
    if (confirm(`确定要删除文件 "${entry.title}" 吗？`)) {
      deleteKnowledgeMutation.mutate(entry._id);
    }
  };

  const handleRAGTest = () => {
    if (!ragTestQuery.trim()) {
      showToast({
        message: '请输入测试查询',
        status: 'warning',
      });
      return;
    }
    refetchRAG();
  };

  const handleViewFile = (fileId: string) => {
    setViewingFileId(fileId);
    refetchContent();
  };

  const handleCloseView = () => {
    setViewingFileId(null);
  };

  const files = knowledgeList?.data || [];

  return (
    <OGDialog open={open} onOpenChange={onOpenChange}>
      <OGDialogContent
        title="知识库文件管理"
        className="w-11/12 max-w-6xl bg-background text-text-primary shadow-2xl"
      >
        <OGDialogHeader>
          <OGDialogTitle>知识库文件管理</OGDialogTitle>
        </OGDialogHeader>

        <div className="flex flex-col gap-4">
          {/* 上传区域 */}
          <div className="flex items-center gap-2 border-b border-border-light pb-4">
            <input
              ref={fileInputRef}
              type="file"
              className="hidden"
              onChange={handleFileSelect}
              accept=".pdf,.doc,.docx,.txt,.md"
              aria-label="上传文件"
            />
            <Button
              onClick={handleUploadClick}
              disabled={uploadFileMutation.isLoading}
              className="flex items-center gap-2"
            >
              <Upload className="h-4 w-4" />
              {uploadFileMutation.isLoading ? '上传中...' : '上传文件'}
            </Button>
            {uploadFileMutation.isLoading && (
              <Spinner className="h-4 w-4" />
            )}
          </div>

          {/* RAG 测试区域 */}
          <div className="rounded-lg border border-border-light bg-surface-secondary p-4">
            <h3 className="mb-2 text-sm font-medium">RAG 测试</h3>
            <div className="flex gap-2">
              <Input
                value={ragTestQuery}
                onChange={(e) => setRagTestQuery(e.target.value)}
                placeholder="输入测试查询..."
                className="flex-1"
                onKeyPress={(e) => {
                  if (e.key === 'Enter') {
                    handleRAGTest();
                  }
                }}
              />
              <Button
                onClick={handleRAGTest}
                disabled={isRagLoading || !ragTestQuery.trim()}
                variant="outline"
                className="flex items-center gap-2"
              >
                <Search className="h-4 w-4" />
                测试
              </Button>
            </div>
            {selectedFileId && (
              <div className="mt-2 flex items-center gap-2 text-xs text-text-secondary">
                <span>仅测试文件:</span>
                <span className="font-medium">{files.find((f) => f.metadata?.file_id === selectedFileId)?.title}</span>
                <button
                  onClick={() => setSelectedFileId(null)}
                  className="text-red-500 hover:text-red-700"
                  aria-label="清除文件选择"
                  title="清除文件选择"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            )}
            {ragResults && (
              <div className="mt-4 rounded border border-border-light bg-surface-primary p-3">
                <div className="mb-2 text-sm font-medium">查询结果 ({ragResults.total} 条):</div>
                <div className="space-y-2 max-h-60 overflow-y-auto">
                  {ragResults.results.map((result, index) => (
                    <div
                      key={index}
                      className="rounded border border-border-light bg-background p-2 text-xs"
                    >
                      <div className="mb-1 flex items-center justify-between">
                        <span className="font-medium">结果 {index + 1}</span>
                        <span className="text-text-secondary">相似度: {(result.score * 100).toFixed(1)}%</span>
                      </div>
                      <div className="text-text-secondary line-clamp-3">{result.content}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* 文件内容查看对话框 */}
          {viewingFileId && (
            <OGDialog open={!!viewingFileId} onOpenChange={(open) => !open && handleCloseView()}>
              <OGDialogContent
                title="文件内容"
                className="w-11/12 max-w-4xl bg-background text-text-primary shadow-2xl"
              >
                <OGDialogHeader>
                  <div className="flex items-center justify-between">
                    <OGDialogTitle>
                      {fileContent?.filename || '文件内容'}
                    </OGDialogTitle>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={handleCloseView}
                      className="h-6 w-6 p-0"
                    >
                      <XCircle className="h-4 w-4" />
                    </Button>
                  </div>
                </OGDialogHeader>
                <div className="max-h-[70vh] overflow-auto">
                  {isContentLoading ? (
                    <div className="flex items-center justify-center py-8">
                      <Spinner className="h-6 w-6" />
                    </div>
                  ) : fileContent ? (
                    <pre className="whitespace-pre-wrap break-words rounded border border-border-light bg-surface-secondary p-4 text-sm">
                      {fileContent.content}
                    </pre>
                  ) : (
                    <div className="flex items-center justify-center py-8 text-text-secondary">
                      <p>无法加载文件内容</p>
                    </div>
                  )}
                </div>
              </OGDialogContent>
            </OGDialog>
          )}

          {/* 文件列表 */}
          <div className="flex-1 overflow-auto">
            {isLoading ? (
              <div className="flex items-center justify-center py-8">
                <Spinner className="h-6 w-6" />
              </div>
            ) : files.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-8 text-text-secondary">
                <FileText className="mb-2 h-12 w-12 opacity-50" />
                <p className="text-sm">暂无文件</p>
                <p className="mt-1 text-xs">上传文件后会自动向量化并存入知识库</p>
              </div>
            ) : (
              <div className="space-y-2">
                {files.map((entry) => (
                  <div
                    key={entry._id}
                    className="flex items-center justify-between rounded-lg border border-border-light bg-surface-secondary p-3 hover:bg-surface-hover"
                  >
                    <div className="flex flex-1 items-center gap-3">
                      <FileText className="h-5 w-5 text-text-secondary" />
                      <div className="flex-1">
                        <div className="font-medium">{entry.title}</div>
                        <div className="text-xs text-text-secondary">
                          {entry.metadata?.filename && (
                            <span>文件: {entry.metadata.filename}</span>
                          )}
                          {entry.metadata?.category && (
                            <span className="ml-2">分类: {entry.metadata.category}</span>
                          )}
                          <span className="ml-2">
                            创建时间: {new Date(entry.createdAt).toLocaleString('zh-CN')}
                          </span>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {entry.metadata?.file_id && (
                        <>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleViewFile(entry.metadata.file_id)}
                            className="text-xs"
                            title="查看文件内容"
                          >
                            <Eye className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              setSelectedFileId(entry.metadata?.file_id || null);
                              setRagTestQuery('');
                            }}
                            className="text-xs"
                          >
                            测试此文件
                          </Button>
                        </>
                      )}
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleDelete(entry)}
                        disabled={deleteKnowledgeMutation.isLoading}
                        className="text-red-500 hover:text-red-700"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </OGDialogContent>
    </OGDialog>
  );
}
