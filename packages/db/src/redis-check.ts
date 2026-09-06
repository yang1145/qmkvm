import { getRedis } from "./redis.js";

const r = getRedis();
if (!r) {
  console.log("REDIS_URL 未配置");
  process.exit(1);
}
const pong = await r.ping();
await r.set("phj:healthcheck", String(Date.now()), "EX", 60);
const v = await r.get("phj:healthcheck");
console.log("Redis PING:", pong, "| set/get:", v ? "OK" : "FAIL");
r.disconnect();
