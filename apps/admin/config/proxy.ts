/**
 * @name 代理的配置
 * 开发环境将 /api 代理到本地 Hono API，Cookie 会话同源自动携带。
 */
export default {
  dev: {
    '/api': {
      target: 'http://localhost:4000',
      changeOrigin: true,
    },
  },
};