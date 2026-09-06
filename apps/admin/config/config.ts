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
  //============== max 插件配置 ===============
  model: {},
  initialState: {},
  title: '拼好机管理后台',
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