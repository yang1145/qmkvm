/**
 * @qmkvm/payments —— 支付网关抽象 + 支付宝/微信/mock 网关 + 回调处理管线。
 *
 * 快速上手见 packages/payments/README.md（网关接入、配置字段、ack 与幂等约定）。
 */

export * from "./types.js";
export * from "./settings-crypto.js";
export * from "./registry.js";
export * from "./mock.js";
export * from "./alipay.js";
export * from "./wechat.js";
export * from "./callback-service.js";
