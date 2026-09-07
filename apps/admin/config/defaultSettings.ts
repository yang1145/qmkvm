import type { ProLayoutProps } from '@ant-design/pro-components';

/**
 * @name 布局默认设置
 */
const Settings: ProLayoutProps & {
  logo?: string;
} = {
  navTheme: 'light',
  colorPrimary: '#1677ff',
  layout: 'mix',
  contentWidth: 'Fluid',
  fixedHeader: true,
  fixSiderbar: true,
  colorWeak: false,
  title: '启明智联业务管理系统',
  logo: '/logo.png',
  iconfontUrl: '',
  token: {},
};

export default Settings;