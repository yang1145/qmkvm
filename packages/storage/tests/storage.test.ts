/**
 * storage 包单测：本地盘 provider put/get/delete roundtrip（临时目录），
 * 覆盖历史绝对路径读兼容、路径穿越拒绝、删除不存在文件静默、key 规范化。
 */
import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  LocalStorageProvider,
  __resetStorageForTests,
  readLocalPath,
  toStorageKey,
  type StorageEnv,
} from "../src/index.js";

let baseTmp: string;
let env: StorageEnv;
let provider: LocalStorageProvider;

beforeAll(async () => {
  baseTmp = await mkdtemp(path.join(tmpdir(), "qmkvm-storage-test-"));
  env = { provider: "local", uploadDir: path.resolve(baseTmp) };
  provider = new LocalStorageProvider(env);
});

afterAll(async () => {
  __resetStorageForTests();
  await rm(baseTmp, { recursive: true, force: true });
});

describe("LocalStorageProvider put/get/delete roundtrip", () => {
  it("写入 → 读取 → 删除 roundtrip", async () => {
    const key = "identity/12/front-1690000000000.jpg";
    const data = Buffer.from("hello-qmkvm-storage");
    const { key: putKey } = await provider.put(key, data, "image/jpeg");
    expect(putKey).toBe(key);

    const got = await provider.get(key);
    expect(got).not.toBeNull();
    expect(got!.data).toEqual(data);
    expect(got!.contentType).toBe("image/jpeg");

    await provider.delete(key);
    const after = await provider.get(key);
    expect(after).toBeNull();
  });

  it("put 自动创建子目录（identity/<userId>/ 与 tickets/<ticketId>/ 结构）", async () => {
    const key = "tickets/88/1690000000000-截图.png";
    const data = Buffer.from("%PDF-fake");
    await provider.put(key, data, "application/pdf");
    const onDisk = await readFile(path.join(baseTmp, "tickets", "88", "1690000000000-截图.png"));
    expect(onDisk).toEqual(data);
  });

  it("历史绝对路径（uploadDir 开头）可直接 get/delete——读侧兼容", async () => {
    // 模拟历史数据：DB 存了绝对路径
    const legacyDir = path.join(baseTmp, "identity", "7");
    await mkdir(legacyDir, { recursive: true });
    const legacyFile = path.join(legacyDir, "front-legacy.jpg");
    await writeFile(legacyFile, "legacy-abs-path");
    await provider.get(legacyFile);
    const got = await provider.get(legacyFile);
    expect(got).not.toBeNull();
    expect(got!.data).toEqual(Buffer.from("legacy-abs-path"));

    // 历史绝对路径也能删除
    await provider.delete(legacyFile);
    expect(await provider.get(legacyFile)).toBeNull();
  });

  it("删除不存在的文件静默成功（与 removeFileQuiet 行为一致）", async () => {
    await expect(provider.delete("identity/999/not-exist.jpg")).resolves.toBeUndefined();
  });

  it("get 不存在的文件返回 null", async () => {
    expect(await provider.get("identity/999/nope.png")).toBeNull();
  });

  it("拒绝 uploadDir 之外的绝对路径（防路径穿越）", async () => {
    expect(await provider.get("C:\\Windows\\win.ini")).toBeNull();
    expect(await provider.get(path.resolve(baseTmp, "..", "outside.txt"))).toBeNull();
    await expect(provider.put(path.resolve(baseTmp, "..", "evil.txt"), Buffer.from("x"))).rejects.toThrow();
  });

  it("presign 本地盘返回 API 相对路径约定 /storage/<key>", async () => {
    const url = await provider.presign("identity/12/front.jpg", 300);
    expect(url).toBe("/storage/identity/12/front.jpg");
  });
});

describe("key 规范化与读路径兼容", () => {
  it("toStorageKey：绝对路径 → 相对 key（POSIX 风格）", () => {
    const abs = path.join(baseTmp, "identity", "12", "front.jpg");
    expect(toStorageKey(abs, env)).toBe("identity/12/front.jpg");
  });

  it("toStorageKey：uploadDir 之外的绝对路径 → null", () => {
    expect(toStorageKey("C:\\Windows\\win.ini", env)).toBeNull();
    expect(toStorageKey(baseTmp, env)).toBeNull();
  });

  it("toStorageKey：相对 key 原样（统一 POSIX 分隔符）", () => {
    expect(toStorageKey("identity/12/front.jpg", env)).toBe("identity/12/front.jpg");
  });

  it("readLocalPath：历史绝对路径原样解析；相对 key 拼到 uploadDir 下", () => {
    const abs = path.join(baseTmp, "identity", "12", "front.jpg");
    expect(readLocalPath(abs, env)).toBe(abs);
    expect(readLocalPath("identity/12/front.jpg", env)).toBe(abs);
    expect(readLocalPath("C:\\Windows\\win.ini", env)).toBeNull();
    expect(readLocalPath("../escape.txt", env)).toBeNull();
  });
});