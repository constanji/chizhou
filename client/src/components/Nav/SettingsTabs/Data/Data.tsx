import React, { useState, useRef } from 'react';
import { useOnClickOutside } from '@aipyq/client';
import { SystemRoles } from '@aipyq/data-provider';
import ImportConversations from './ImportConversations';
// import { RevokeKeys } from './RevokeKeys'; // 已隐藏撤销凭据功能
import { DeleteCache } from './DeleteCache';
import { ClearChats } from './ClearChats';
import SharedLinks from './SharedLinks';
import { useAuthContext } from '~/hooks/AuthContext';

function Data() {
  const dataTabRef = useRef(null);
  const [confirmClearConvos, setConfirmClearConvos] = useState(false);
  const { user } = useAuthContext();
  const isAdmin = user?.role === SystemRoles.ADMIN;
  useOnClickOutside(dataTabRef, () => confirmClearConvos && setConfirmClearConvos(false), []);

  return (
    <div className="flex flex-col gap-3 p-1 text-sm text-text-primary">
      <div className="pb-3">
        <ImportConversations />
      </div>
      {/* 共享链接仅对管理员显示 */}
      {isAdmin && (
      <div className="pb-3">
        <SharedLinks />
      </div>
      )}
      {/* 隐藏"撤销所有用户提供的凭据"功能 */}
      {/* <div className="pb-3">
        <RevokeKeys />
      </div> */}
      {/* 隐藏删除 TTS 缓存存储 */}
      {/* <div className="pb-3">
        <DeleteCache />
      </div> */}
      <div className="pb-3">
        <ClearChats />
      </div>
    </div>
  );
}

export default React.memo(Data);
