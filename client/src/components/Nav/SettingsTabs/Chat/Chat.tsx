import { memo } from 'react';
import { SystemRoles } from '@aipyq/data-provider';
import { showThinkingAtom } from '~/store/showThinking';
import FontSizeSelector from './FontSizeSelector';
import { ForkSettings } from './ForkSettings';
import ChatDirection from './ChatDirection';
import ToggleSwitch from '../ToggleSwitch';
import { useAuthContext } from '~/hooks/AuthContext';
import store from '~/store';

// 管理员专用设置项
const adminOnlyConfigs = [
  {
    stateAtom: showThinkingAtom,
    localizationKey: 'com_nav_show_thinking',
    switchId: 'showThinking',
    hoverCardText: undefined,
    key: 'showThinking',
  },
  {
    stateAtom: store.showCode,
    localizationKey: 'com_nav_show_code',
    switchId: 'showCode',
    hoverCardText: undefined,
    key: 'showCode',
  },
  {
    stateAtom: store.LaTeXParsing,
    localizationKey: 'com_nav_latex_parsing',
    switchId: 'latexParsing',
    hoverCardText: 'com_nav_info_latex_parsing',
    key: 'latexParsing',
  },
];

const toggleSwitchConfigs = [
  {
    stateAtom: store.enterToSend,
    localizationKey: 'com_nav_enter_to_send',
    switchId: 'enterToSend',
    hoverCardText: 'com_nav_info_enter_to_send',
    key: 'enterToSend',
  },
  {
    stateAtom: store.maximizeChatSpace,
    localizationKey: 'com_nav_maximize_chat_space',
    switchId: 'maximizeChatSpace',
    hoverCardText: undefined,
    key: 'maximizeChatSpace',
  },
  {
    stateAtom: store.centerFormOnLanding,
    localizationKey: 'com_nav_center_chat_input',
    switchId: 'centerFormOnLanding',
    hoverCardText: undefined,
    key: 'centerFormOnLanding',
  },
  {
    stateAtom: store.saveDrafts,
    localizationKey: 'com_nav_save_drafts',
    switchId: 'saveDrafts',
    hoverCardText: 'com_nav_info_save_draft',
    key: 'saveDrafts',
  },
  {
    stateAtom: store.showScrollButton,
    localizationKey: 'com_nav_scroll_button',
    switchId: 'showScrollButton',
    hoverCardText: undefined,
    key: 'showScrollButton',
  },
  {
    stateAtom: store.saveBadgesState,
    localizationKey: 'com_nav_save_badges_state',
    switchId: 'showBadges',
    hoverCardText: 'com_nav_info_save_badges_state',
    key: 'showBadges',
  },
  {
    stateAtom: store.modularChat,
    localizationKey: 'com_nav_modular_chat',
    switchId: 'modularChat',
    hoverCardText: undefined,
    key: 'modularChat',
  },
];

function Chat() {
  const { user } = useAuthContext();
  const isAdmin = user?.role === SystemRoles.ADMIN;

  return (
    <div className="flex flex-col gap-3 p-1 text-sm text-text-primary">
      <div className="pb-3">
        <FontSizeSelector />
      </div>
      <div className="pb-3">
        <ChatDirection />
      </div>
      {toggleSwitchConfigs.map((config) => (
        <div key={config.key} className="pb-3">
          <ToggleSwitch
            stateAtom={config.stateAtom}
            localizationKey={config.localizationKey}
            hoverCardText={config.hoverCardText}
            switchId={config.switchId}
          />
        </div>
      ))}
      {/* 管理员专用设置项 */}
      {isAdmin &&
        adminOnlyConfigs.map((config) => (
        <div key={config.key} className="pb-3">
          <ToggleSwitch
            stateAtom={config.stateAtom}
            localizationKey={config.localizationKey}
            hoverCardText={config.hoverCardText}
            switchId={config.switchId}
          />
        </div>
      ))}
      <ForkSettings />
    </div>
  );
}

export default memo(Chat);
