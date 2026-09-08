/** zjmf 供应商配置解析与密钥加密单测（AES-256-GCM 格式与 payments/settings-crypto 一致） */
import { beforeAll, describe, expect, it } from "vitest";
import {
  encryptSettingValue,
  decryptSettingValue,
  isEncryptedSettingValue,
} from "../src/modules/zjmf/crypto.js";
import { parseInlineSupplier, supplierSettingToConfig } from "../src/modules/zjmf/config.js";
import { redactZjmf } from "../src/modules/zjmf/client.js";

beforeAll(() => {
  // crypto 层按调用时读取 APP_KEY（base64 32 字节），测试注入随机密钥
  const key = Buffer.from(new Uint8Array(32).map((_, i) => (i * 7 + 3) % 256));
  process.env.APP_KEY = key.toString("base64");
});

describe("crypto", () => {
  it("加密解密往返", () => {
    const enc = encryptSettingValue("s3cret-密码");
    expect(isEncryptedSettingValue(enc)).toBe(true);
    expect(JSON.stringify(enc)).not.toContain("s3cret");
    expect(decryptSettingValue(enc.v)).toBe("s3cret-密码");
  });

  it("密文格式为 iv:tag:ct 三段", () => {
    const enc = encryptSettingValue("x");
    expect(enc.v.split(":")).toHaveLength(3);
  });

  it("篡改密文解密失败", () => {
    const enc = encryptSettingValue("x");
    // 篡改首字符（IV 段）：IV 变化后 GCM 校验必然失败。
    // 不能改末位——base64 末字符编码的是末字节被丢弃的填充位，可能不影响解密。
    const tampered = enc.v.replace(/^./, (c) => (c === "A" ? "B" : "A"));
    expect(tampered).not.toBe(enc.v);
    expect(() => decryptSettingValue(tampered)).toThrow();
  });
});

describe("parseInlineSupplier", () => {
  const valid = { baseUrl: "https://up.example.com/", username: "agent", password: "pw" };

  it("合法配置通过并规范化 baseUrl", () => {
    const cfg = parseInlineSupplier(valid);
    expect(cfg.baseUrl).toBe("https://up.example.com");
    expect(cfg.allowSelfSigned).toBe(false);
  });

  it("http 明文地址仅在有显式开关时可用（解析层不拦截，由设置表路径拦截）", () => {
    expect(parseInlineSupplier({ ...valid, baseUrl: "http://10.0.0.5" }).baseUrl).toBe("http://10.0.0.5");
  });

  it("缺字段抛错", () => {
    expect(() => parseInlineSupplier({ baseUrl: "https://x.com" })).toThrow();
    expect(() => parseInlineSupplier({ ...valid, username: "" })).toThrow();
    expect(() => parseInlineSupplier(null)).toThrow();
  });
});

describe("supplierSettingToConfig", () => {
  it("密文密码自动解密", () => {
    const enc = encryptSettingValue("raw-password");
    const cfg = supplierSettingToConfig({
      code: "main",
      name: "主供应商",
      baseUrl: "https://up.example.com",
      username: "agent",
      password: enc,
    });
    expect(cfg.password).toBe("raw-password");
  });

  it("明文密码直接使用", () => {
    const cfg = supplierSettingToConfig({
      code: "main",
      name: "主",
      baseUrl: "https://up.example.com",
      username: "agent",
      password: "plain",
    });
    expect(cfg.password).toBe("plain");
  });

  it("缺密码抛错", () => {
    expect(() =>
      supplierSettingToConfig({
        code: "main",
        name: "主",
        baseUrl: "https://up.example.com",
        username: "agent",
        // @ts-expect-error 故意缺 password
        password: undefined,
      }),
    ).toThrow();
  });
});

describe("redactZjmf", () => {
  it("嵌套敏感字段被掩码", () => {
    const redacted = redactZjmf({
      status: 200,
      jwt: "eyJhbGciOiJIUzI1NiJ9.secret",
      data: { host: [{ username: "user1", password: "plain-pw" }] },
      authorization: "Bearer x",
    }) as Record<string, unknown>;
    expect(redacted.jwt).toBe("***");
    expect(redacted.authorization).toBe("***");
    const host = ((redacted.data as Record<string, unknown>).host ?? []) as Array<Record<string, unknown>>;
    expect(host[0]?.password).toBe("***");
    expect(host[0]?.username).toBe("user1");
    expect(redacted.status).toBe(200);
  });

  it("非敏感字段原样保留", () => {
    expect(redactZjmf({ msg: "成功", pass: 123 })).toEqual({ msg: "成功", pass: 123 });
  });
});
