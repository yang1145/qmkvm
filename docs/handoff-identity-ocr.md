# 交接：实名认证引入 node-tesseract-ocr + 身份证三照上传（仅正面 OCR）

> 本文档由上一会话编写，供下一个 agent 继续工作。日期：2026-09-07。

## 需求回顾

- 实名认证引入 `node-tesseract-ocr`。
- 个人实名提交时上传：身份证正面、反面、手持身份证（手持选填）。
- **只对身份证正面做 OCR**，提取证件号与用户填写值核对；OCR 不可用时不阻断提交。

## 已完成（代码已落盘，未 commit）

1. **依赖**：`apps/api` 已通过 `pnpm add node-tesseract-ocr` 安装（^2.2.1，根 lockfile 已更新）。
2. **DB**（`packages/db`）：
   - `src/schema/users.ts` 的 `user_profiles` 新增列：`id_front_path` / `id_back_path` / `id_handheld_path`(varchar 500)、`ocr_id_number`(varchar 30)、`ocr_status` enum('matched','unavailable')。
   - 迁移文件 `drizzle/0005_clean_lilith.sql` 已生成，`meta/_journal.json` 与 `0005_snapshot.json` 一致（生成过程有过反复，最终状态已验证干净）。
   - **迁移尚未对真实数据库执行**：需要时在 `packages/db` 跑 `pnpm migrate`。
3. **OCR 工具**（新文件 `apps/api/src/utils/ocr.ts`）：
   - `ocrIdCardFront(input, opts)`：调 node-tesseract-ocr，默认 `lang=chi_sim+eng`（可用环境变量 `TESSERACT_LANG` 覆盖）、`TESSERACT_BIN` 指定二进制、15s 超时；tesseract 缺失/超时返回 `{available:false}`（不阻断）。
   - `extractIdNumber` / `isValidIdNumber`（GB11643 校验码验证，只有校验通过的 OCR 结果才用于阻断式比对）。
4. **Portal API**（`apps/api/src/routes/portal/account.ts`）：
   - `POST /account/identity` 支持 `multipart/form-data`：字段 `type/realName/idNumber/companyName/creditCode` + 文件 `idFront`（必填）、`idBack`（必填）、`idHandheld`（选填）；个人走 JSON 提交会被拒（`IDENTITY_IMAGE_REQUIRED`）。企业仍走 JSON。
   - 图片校验：JPG/PNG/WebP、≤10MB；存至 `UPLOAD_DIR/identity/<userId>/{front|back|handheld}-<ts>.<ext>`；重新提交时删除旧图。
   - **仅正面 OCR**：OCR 结果校验码合法且与填写证件号不一致 → 抛 `IDENTITY_OCR_MISMATCH`(422)；一致 → `ocr_status='matched'`，否则 `'unavailable'`（没有 mismatched 枚举值，schema 与迁移已对齐）。
   - `GET /account/identity` 响应新增 `images:{front,back,handheld}`（布尔）与 `ocrStatus`。
   - 新端点 `POST /account/identity/ocr`：只接收正面照做识别预填，**不保存图片**，返回 `{available,idNumber,verified}`。
5. **错误码**：`packages/contracts/src/errors.ts` 新增 `IDENTITY_IMAGE_REQUIRED` / `IDENTITY_IMAGE_INVALID`（400）、`IDENTITY_OCR_MISMATCH`（422，映射在 `packages/core/src/errors.ts`）。
6. **Admin API**（`apps/api/src/routes/admin/identities.ts`）：
   - 新端点 `GET /identities/:id/images/:kind`（kind=front|back|handheld，权限 customers.manage）：读文件返回图片，带 uploadDir 路径穿越防护、`no-store`。
   - 详情响应新增 `images:{front,back,handheld}`（URL）与 `ocr:{idNumber,valid,status}`。
7. **Portal 前端**：
   - `lib/api.ts`：`request()` 支持 FormData（不设 JSON Content-Type）。
   - `lib/schemas.ts`：`identitySchema` 扩展 `images`/`ocrStatus`；新增 `identityOcrSchema`。
   - `app/(main)/account/identity/page.tsx`：重写个人表单——三个上传位（正/反/手持选填）、前端类型/大小校验、缩略图预览/删除、正面上传后调 `/account/identity/ocr` 自动预填证件号（可关闭提示）、FormData 提交。

## 待办（按优先级）

1. **Portal 有 1 个已知 typecheck 错误**（我修完 toast variant 后剩下的那个）：
   - `app/(main)/account/identity/page.tsx` 身份证号 `Field` 的 `hint` 传了 JSX（Loader2 转圈），但 `components/form.tsx` 的 `hint?: string`。
   - 两种修法任选：把 hint 改回纯字符串；或把 `components/form.tsx` 的 `hint` 类型放宽为 `ReactNode`。
2. **Admin 详情抽屉展示证件照**（`apps/admin/src/pages/identities/index.tsx`）：
   - `services/types.ts` 的 `IdentityDetail` 需补 `images:{front,back,handheld:string|null}` 与 `ocr:{...}` 字段。
   - 抽屉里用 `<img src={detail.images.front}>` 直显即可（admin dev proxy `/api → localhost:4000`，cookie 同源自带，API 返回 `no-store`）；建议加 Image 预览与 OCR 识别号展示。
3. **全量 typecheck**：`apps/api` 已通过；跑 `packages/*`、`apps/portal`、`apps/admin` 的 `pnpm typecheck`，清理残留。
4. **迁移执行**：`packages/db && pnpm migrate`。
5. **运行时依赖提示**：部署机需安装 tesseract 二进制 + `chi_sim` 语言包（否则 OCR 走 `available:false` 分支，功能不阻断但无预填/比对）。
6. **顺手核对**：仓库里出现 `@pinhaoji/*` → `@qmkvm/*` 的包名迁移痕迹（我接手时部分文件已是 `@qmkvm/*`，`packages/db/package.json` 里名字仍是 `@pinhaoji/db`；我新写的 import 跟随了所在文件的现有写法）。如迁移未完成，注意对齐。
7. 可选打磨：admin 审核页列表显示 OCR 状态标签；portal 提交成功后 revoke 预览 objectURL；`identity/ocr` 端点加节流。

## 关键文件清单

- `apps/api/src/utils/ocr.ts`（新建）
- `apps/api/src/routes/portal/account.ts`
- `apps/api/src/routes/admin/identities.ts`
- `packages/contracts/src/errors.ts`、`packages/core/src/errors.ts`
- `packages/db/src/schema/users.ts`、`packages/db/drizzle/0005_clean_lilith.sql`
- `apps/portal/lib/api.ts`、`apps/portal/lib/schemas.ts`
- `apps/portal/app/(main)/account/identity/page.tsx`
- `apps/admin/src/pages/identities/index.tsx`（未改，待办 2）

## 注意

- git 里 `PRD.md` 的删除是会话开始前就有的状态，与本次改动无关。
- 以上改动均未 commit。