import { useMemo } from 'react';
import type { TUser } from '@aipyq/data-provider';

const useAvatar = (user: TUser | undefined) => {
  return useMemo(() => {
    // 如果用户有配置的头像，直接返回
    if (user?.avatar && user?.avatar !== '') {
      return user.avatar;
    }

    // 如果用户没有配置头像，统一使用logo.png作为默认头像
    return '/assets/logo.png';
  }, [user]);
};

export default useAvatar;
