/**
 * P0 全链路冒烟：pnpm dlx tsx scripts/smoke.ts
 * 前置：API(4000) 与 Worker 已启动；.env 已配置远程库与 Redis。
 */
const BASE = process.env.SMOKE_BASE ?? "http://localhost:4000";

let cookie = "";
let passed = 0;
const failures: string[] = [];

async function call(method: string, path: string, body?: unknown): Promise<{ status: number; json: any }> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      ...(cookie ? { cookie } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: "manual",
  });
  const setCookie = res.headers.get("set-cookie");
  if (setCookie) cookie = setCookie.split(";")[0]!;
  let json: any = null;
  try {
    json = await res.json();
  } catch {
    json = null;
  }
  return { status: res.status, json };
}

function check(name: string, cond: boolean, detail?: unknown) {
  if (cond) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failures.push(name);
    console.log(`  ✗ ${name}`, detail !== undefined ? JSON.stringify(detail).slice(0, 300) : "");
  }
}

async function waitUntil(fn: () => Promise<boolean>, ms: number, step = 2000): Promise<boolean> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (await fn()) return true;
    await new Promise((r) => setTimeout(r, step));
  }
  return false;
}

async function main() {
  console.log("== P0 全链路冒烟 ==");

  // 0) 健康检查
  const health = await call("GET", "/healthz");
  check("healthz", health.status === 200 && health.json?.ok === true, health.json);

  // 1) 公开目录
  const catalog = await call("GET", "/api/v1/public/catalog");
  check("public catalog", catalog.status === 200 && Array.isArray(catalog.json) && catalog.json.length > 0);
  const group = catalog.json?.[0];
  const demo = group?.products?.find((p: any) => p.slug === "demo-server");
  check("demo-server 商品存在", !!demo, group?.products?.map((p: any) => p.slug));
  const monthly = demo?.pricing?.find((p: any) => p.cycle === "monthly");
  check("monthly 定价存在", !!monthly);

  // 2) 邮箱注册
  const email = `smoke_${Date.now()}@test.local`;
  const reg = await call("POST", "/api/v1/portal/auth/register", {
    email,
    password: "Passw0rd123",
    name: "冒烟用户",
  });
  check("邮箱注册", reg.status === 200 && reg.json?.user?.id > 0, reg.json);
  const userId = reg.json?.user?.id;

  // 3) 购物车
  const add = await call("POST", "/api/v1/portal/cart/items", {
    productId: demo.id,
    cycle: "monthly",
    options: [],
    qty: 1,
  });
  check("加入购物车", add.status === 200, add.json);
  const quote = await call("GET", "/api/v1/portal/cart/quote");
  check("报价 = monthly 首购价", quote.json?.total === monthly.firstPrice, quote.json);

  // 4) 结算
  const checkout = await call("POST", "/api/v1/portal/checkout", { useBalance: false });
  check("结算生成订单+账单", checkout.status === 200 && checkout.json?.invoiceId > 0, checkout.json);
  const invoiceId = checkout.json?.invoiceId;
  const invoiceNo = checkout.json?.invoiceNo;

  // 5) 支付（mock 网关 + dev 即时支付端点）
  const pay = await call("POST", `/api/v1/portal/invoices/${invoiceId}/pay`, { gateway: "mock" });
  check("创建支付单", pay.status === 200 && pay.json?.intentId > 0, pay.json);
  const mockPay = await call("POST", `/api/v1/portal/dev/mock-pay/${invoiceNo}`);
  check("mock 支付成功", mockPay.json?.paid === true, mockPay.json);

  // 6) 自动开通（Worker 消费队列 → demo 模块）
  const svcActive = await waitUntil(async () => {
    const list = await call("GET", "/api/v1/portal/services");
    return list.json?.items?.some((s: any) => s.status === "active" && s.deliverInfo?.ip);
  }, 30000);
  check("服务自动开通（active + 交付 IP）", svcActive);
  const svcList = await call("GET", "/api/v1/portal/services");
  const svc = svcList.json?.items?.[0];
  check("到期时间已设置", !!svc?.nextDueDate, svc);

  // 7) 续费
  const renew = await call("POST", `/api/v1/portal/services/${svc.id}/renew`, { cycle: "monthly" });
  check("生成续费账单", renew.status === 200 && renew.json?.invoiceId > 0, renew.json);
  const renewPay = await call("POST", `/api/v1/portal/dev/mock-pay/${renew.json?.invoiceNo}`);
  check("续费支付", renewPay.json?.paid === true, renewPay.json);
  const svcAfter = await call("GET", `/api/v1/portal/services/${svc.id}`);
  check("到期日顺延一个月", svcAfter.json?.nextDueDate === renew.json?.nextDueDateAfter, {
    now: svcAfter.json?.nextDueDate,
    expect: renew.json?.nextDueDateAfter,
  });

  // 8) 充值
  const recharge = await call("POST", "/api/v1/portal/credits/recharge?gateway=mock", { amount: 1000 });
  check("充值账单+支付单", recharge.status === 200 && recharge.json?.invoiceId > 0, recharge.json);
  const rechargePay = await call("POST", `/api/v1/portal/dev/mock-pay/${recharge.json?.invoiceNo}`);
  check("充值支付", rechargePay.json?.paid === true, rechargePay.json);
  await new Promise((r) => setTimeout(r, 1500));
  const credits = await call("GET", "/api/v1/portal/credits");
  check("余额入账 ¥10", credits.json?.balance === 1000, credits.json);

  // 9) 工单
  const depts = await call("GET", "/api/v1/portal/departments");
  check("部门列表", depts.status === 200 && depts.json?.items?.length > 0);
  const ticket = await call("POST", "/api/v1/portal/tickets", {
    departmentId: depts.json.items[0].id,
    subject: "冒烟测试工单",
    priority: "low",
    contentHtml: "<p>测试内容</p>",
  });
  check("创建工单", ticket.status === 200, ticket.json);
  const reply = await call("POST", `/api/v1/portal/tickets/${ticket.json?.id}/reply`, {
    contentHtml: "<p>补充说明</p>",
  });
  check("回复工单", reply.status === 200);
  const tClose = await call("POST", `/api/v1/portal/tickets/${ticket.json?.id}/close`);
  check("关闭工单", tClose.status === 200);

  // 10) 余额支付订单（用充值余额买通用型）
  const standard = group?.products?.find((p: any) => p.slug === "standard");
  if (standard) {
    const add2 = await call("POST", "/api/v1/portal/cart/items", {
      productId: standard.id,
      cycle: "monthly",
      options: [],
      qty: 1,
    });
    check("第二件加入购物车", add2.status === 200);
    // 余额不足（¥10 < ¥99），先充值
    const rc2 = await call("POST", "/api/v1/portal/credits/recharge?gateway=mock", { amount: 10000 });
    await call("POST", `/api/v1/portal/dev/mock-pay/${rc2.json?.invoiceNo}`);
    await new Promise((r) => setTimeout(r, 1500));
    const co2 = await call("POST", "/api/v1/portal/checkout", { useBalance: true });
    check("余额支付下单（paid=true）", co2.json?.paid === true, co2.json);
  }

  // 11) 站内通知与审计痕迹
  const notifs = await call("GET", "/api/v1/portal/notifications");
  check("站内通知已生成", (notifs.json?.items?.length ?? 0) > 0, notifs.json?.items?.length);

  console.log(`\n== 结果：${passed} 通过，${failures.length} 失败 ==`);
  if (failures.length) {
    console.log("失败项:", failures.join(" | "));
    console.log("用户:", email, "id:", userId);
    process.exit(1);
  }
  process.exit(0);
}

main().catch((err) => {
  console.error("冒烟脚本异常:", err);
  process.exit(1);
});
