// https://umijs.org/config/
import { defineConfig } from '@umijs/max';
import defaultSettings from './defaultSettings';
import proxy from './proxy';
import routes from './routes';

const { UMI_ENV = 'dev' } = process.env;

const PUBLIC_PATH: string = '/';

export default defineConfig({
  esbuildMinifyIIFE: true,
  hash: true,
  publicPath: PUBLIC_PATH,
  routes,
  ignoreMomentLocale: true,
  proxy: proxy[UMI_ENV as keyof typeof proxy] || proxy.dev,
  fastRefresh: true,
  // 构建期注入 API 地址：独立域名部署时设为 API 绝对地址（如 https://api.example.com，
  // 跨域直连，需 CORS_ORIGINS 收录 admin 域名）；不设置走同源相对路径（/api 反代模式）
  define: {
    'process.env.ADMIN_API_URL': JSON.stringify(process.env.ADMIN_API_URL ?? ''),
  },
  //============== max 插件配置 ===============
  model: {},
  initialState: {},
  title: '启明智联业务管理系统',
  layout: {
    locale: false,
    ...defaultSettings,
  },
  moment2dayjs: {
    preset: 'antd',
    plugins: ['duration', 'relativeTime'],
  },
  locale: {
    default: 'zh-CN',
    antd: true,
    baseNavigator: false,
    title: false,
  },
  antd: {
    appConfig: {},
    configProvider: {
      variant: 'filled',
    },
  },
  request: {},
  access: {},
  headScripts: [
    // 解决首次加载白屏
    { src: `${PUBLIC_PATH}scripts/loading.js`, async: true },
  ],
  tailwindcss: {},
  mock: {
    include: [],
  },
});