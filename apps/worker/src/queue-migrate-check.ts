import { getRedis } from "@qmkvm/db";

const r = getRedis();
if (!r) {
  console.log("no redis");
  process.exit(0);
}
const keys = await r.keys("bull:phj:*");
console.log("旧 phj 队列残留 key:", keys.length);
if (keys.length > 0) {
  await r.del(...keys);
  console.log("已清理:", keys.length);
}
const kvmKeys = await r.keys("bull:kvm:*");
console.log("新 kvm 队列 key:", kvmKeys.length);
r.disconnect();