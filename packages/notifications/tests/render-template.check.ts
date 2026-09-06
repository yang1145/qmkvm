/**
 * renderTemplate 快速自检：tsx tests/render-template.check.ts
 * 纯函数校验，不连数据库。
 */

import { renderTemplate } from "../src/send.js";

let failed = 0;

function expectEqual(actual: string, expected: string, label: string): void {
  if (actual === expected) {
    console.log(`PASS ${label} => "${actual}"`);
  } else {
    failed += 1;
    console.error(`FAIL ${label}: 期望 "${expected}"，实际 "${actual}"`);
  }
}

// 基本占位
expectEqual(
  renderTemplate("你好，{{user.name}}！", { user: { name: "张三" } }),
  "你好，张三！",
  "嵌套点路径",
);
// 平铺变量
expectEqual(renderTemplate("余额 {{amount}} 分", { amount: 3900 }), "余额 3900 分", "平铺变量");
// 缺失变量替换为空串
expectEqual(
  renderTemplate("欢迎 {{user.name}}，你的订单 {{order.no}} 已创建", { user: { name: "李四" } }),
  "欢迎 李四，你的订单  已创建",
  "缺失变量为空",
);
// 多变量与空格容忍
expectEqual(
  renderTemplate("{{ user.name }}-{{ event }}", { user: { name: "A" }, event: "invoice.paid" }),
  "A-invoice.paid",
  "空格容忍",
);
// 无占位符原样返回
expectEqual(renderTemplate("纯文本", {}), "纯文本", "无占位符");
// 顶层 key 含点的平铺写法
expectEqual(renderTemplate("{{user.name}}", { "user.name": "王五" }), "王五", "平铺点 key 优先");

if (failed > 0) {
  console.error(`\n${failed} 项失败`);
  process.exit(1);
}
console.log("\nrenderTemplate 自检全部通过");
