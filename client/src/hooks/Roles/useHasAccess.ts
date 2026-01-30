import { useMemo, useCallback, useContext } from 'react';
import type { TUser, Permissions } from '@aipyq/data-provider';
import { SystemRoles, PermissionTypes, roleDefaults } from '@aipyq/data-provider';
import { AuthContext } from '~/hooks/AuthContext';

const useHasAccess = ({
  permissionType,
  permission,
}: {
  permissionType: PermissionTypes;
  permission: Permissions;
}) => {
  const authContext = useContext(AuthContext);
  const user = authContext?.user;
  const roles = authContext?.roles;
  const isAuthenticated = authContext?.isAuthenticated || false;

  const checkAccess = useCallback(
    ({
      user,
      permissionType,
      permission,
    }: {
      user?: TUser | null;
      permissionType: PermissionTypes;
      permission: Permissions;
    }) => {
      if (!authContext) {
        return false;
      }

      if (isAuthenticated && user?.role != null) {
        // 管理员对于记忆相关权限，总是返回 true（参考 Aipyq 的设计）
        if (user.role === SystemRoles.ADMIN && permissionType === PermissionTypes.MEMORIES) {
          return true;
        }

        // 首先检查数据库中的角色权限
        if (roles && roles[user.role]) {
          const rolePermission = roles[user.role]?.permissions?.[permissionType]?.[permission];
          // 如果权限明确设置为 true，返回 true
          if (rolePermission === true) {
            return true;
          }
          // 如果权限明确设置为 false，返回 false
          if (rolePermission === false) {
            return false;
          }
        }
        
        // 如果数据库中没有权限数据，回退到默认值
        const defaultRole = roleDefaults[user.role as SystemRoles];
        if (defaultRole) {
          const defaultPermission = defaultRole.permissions?.[permissionType]?.[permission];
          return defaultPermission === true;
        }
      }
      return false;
    },
    [authContext, isAuthenticated, roles],
  );

  const hasAccess = useMemo(
    () => checkAccess({ user, permissionType, permission }),
    [user, permissionType, permission, checkAccess],
  );

  return hasAccess;
};

export default useHasAccess;
