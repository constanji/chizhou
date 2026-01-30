import { PermissionBits } from '@aipyq/data-provider';

/**
 * Hook to determine the appropriate permission level for agent queries
 * 
 * 注意：侧边栏智能体列表应该始终使用 VIEW 权限，这样所有用户都能看到公开的智能体
 * 编辑/管理权限由后端 ACL 控制，不影响列表显示
 */
const useAgentDefaultPermissionLevel = () => {
  // 始终返回 VIEW 权限，确保所有有 VIEW 权限的用户都能看到公开的智能体
  // 这样可以避免因为异步权限检查导致的初始状态不一致问题
  return PermissionBits.VIEW;
};

export default useAgentDefaultPermissionLevel;
