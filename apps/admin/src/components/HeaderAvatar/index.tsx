import { LogoutOutlined } from '@ant-design/icons';
import { history, useModel } from '@umijs/max';
import type { MenuProps } from 'antd';
import { Spin } from 'antd';
import React from 'react';
import { adminLogout } from '@/services/admin';
import HeaderDropdown from '../HeaderDropdown';

/** 头像下拉：退出登录 */
const HeaderAvatar: React.FC<{ children?: React.ReactNode }> = ({ children }) => {
  const { initialState, setInitialState } = useModel('@@initialState');

  const onMenuClick: MenuProps['onClick'] = (event) => {
    const { key } = event;
    if (key === 'logout') {
      setInitialState((s: any) => ({ ...s, currentUser: undefined }));
      adminLogout().catch(() => {
        // 会话可能已失效，仍然本地登出
      });
      history.replace('/user/login');
      return;
    }
    history.push(key);
  };

  if (!initialState?.currentUser) {
    return <Spin size="small" />;
  }

  const menuItems: MenuProps['items'] = [
    { key: 'logout', icon: <LogoutOutlined />, label: '退出登录' },
  ];

  return (
    <HeaderDropdown placement="bottomRight" menu={{ selectedKeys: [], onClick: onMenuClick, items: menuItems }} arrow>
      {children}
    </HeaderDropdown>
  );
};

export default HeaderAvatar;