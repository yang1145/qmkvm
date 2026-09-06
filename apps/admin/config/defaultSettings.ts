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
  title: '拼好机管理后台',
  logo: '/logo.png',
  iconfontUrl: '',
  token: {},
};

export default Settings;