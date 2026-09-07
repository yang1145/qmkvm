"use client";

import * as React from "react";
import { ImagePlus, Loader2, ShieldCheck, X } from "lucide-react";

import { api } from "@/lib/api";
import { useApiData } from "@/hooks/use-api";
import { formatDateTime } from "@/lib/format";
import { identityOcrSchema, identitySchema } from "@/lib/schemas";
import { PageHeader } from "@/components/page-header";
import { Field } from "@/components/form";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/components/ui/toast";

const STATUS_MAP: Record<string, { label: string; className: string }> = {
  unverified: { label: "未认证", className: "bg-muted text-muted-foreground" },
  pending: { label: "审核中", className: "bg-blue-50 text-blue-700" },
  verified: { label: "已认证", className: "bg-emerald-50 text-emerald-700" },
  rejected: { label: "已驳回", className: "bg-red-50 text-red-700" },
};

/** 证件照约束（与后端一致）：仅 JPG/PNG/WebP，≤10MB */
const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];
const IMAGE_MAX_SIZE = 10 * 1024 * 1024;

interface IdImage {
  file: File;
  previewUrl: string;
}

function ImageUpload({
  label,
  hint,
  value,
  onChange,
  disabled,
}: {
  label: string;
  hint: string;
  value: IdImage | null;
  onChange: (v: IdImage | null) => void;
  disabled?: boolean;
}) {
  const { toast } = useToast();
  const inputRef = React.useRef<HTMLInputElement>(null);

  const pick = (file: File | undefined) => {
    if (!file) return;
    if (!IMAGE_TYPES.includes(file.type)) {
      toast({ title: `${label}仅支持 JPG/PNG/WebP 格式`, variant: "error" });
      return;
    }
    if (file.size > IMAGE_MAX_SIZE) {
      toast({ title: `${label}不能超过 10MB`, variant: "error" });
      return;
    }
    onChange({ file, previewUrl: URL.createObjectURL(file) });
  };

  const clear = () => {
    if (value) URL.revokeObjectURL(value.previewUrl);
    onChange(null);
    if (inputRef.current) inputRef.current.value = "";
  };

  return (
    <Field label={label} hint={hint}>
      {value ? (
        <div className="relative w-40 overflow-hidden rounded-lg border">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={value.previewUrl} alt={label} className="h-24 w-full object-cover" />
          <button
            type="button"
            aria-label={`移除${label}`}
            className="absolute right-1 top-1 rounded-full bg-black/60 p-1 text-white hover:bg-black/80"
            onClick={clear}
            disabled={disabled}
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      ) : (
        <button
          type="button"
          disabled={disabled}
          onClick={() => inputRef.current?.click()}
          className="flex h-24 w-40 flex-col items-center justify-center gap-1 rounded-lg border border-dashed text-xs text-muted-foreground hover:border-primary hover:text-primary"
        >
          <ImagePlus className="h-5 w-5" />
          点击上传
        </button>
      )}
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={(e) => pick(e.target.files?.[0])}
      />
    </Field>
  );
}

export default function IdentityPage() {
  const { toast, success } = useToast();
  const state = useApiData(
    () => api.get("/account/identity", { parse: identitySchema, silent: true }),
    [],
  );
  const identity = state.data;

  // 个人实名
  const [personalName, setPersonalName] = React.useState("");
  const [personalId, setPersonalId] = React.useState("");
  const [frontImage, setFrontImage] = React.useState<IdImage | null>(null);
  const [backImage, setBackImage] = React.useState<IdImage | null>(null);
  const [handheldImage, setHandheldImage] = React.useState<IdImage | null>(null);
  const [ocrChecking, setOcrChecking] = React.useState(false);
  // 企业实名
  const [companyName, setCompanyName] = React.useState("");
  const [creditCode, setCreditCode] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);

  const canSubmit =
    !identity || identity.status === "unverified" || identity.status === "rejected";

  /** 正面照 OCR：识别证件号并预填（可选能力，失败不阻断） */
  const checkFrontOcr = async (img: IdImage | null) => {
    if (!img) return;
    setOcrChecking(true);
    try {
      const fd = new FormData();
      fd.append("file", img.file);
      const res = await api.post("/account/identity/ocr", fd, {
        parse: identityOcrSchema,
        silent: true,
      });
      if (res.idNumber && !personalId.trim()) setPersonalId(res.idNumber);
      if (res.available && !res.idNumber) {
        toast({ title: "未能从照片中识别出身份证号，请手动填写核对" });
      }
    } catch {
      // OCR 服务不可用时静默跳过
    } finally {
      setOcrChecking(false);
    }
  };

  const submit = async (payload: FormData | Record<string, unknown>, okMsg: string) => {
    setSubmitting(true);
    try {
      await api.post("/account/identity", payload);
      success(okMsg, "审核通常在 1-3 个工作日内完成");
      state.reload();
    } catch {
      // Toast 已由 api 层弹出
    } finally {
      setSubmitting(false);
    }
  };

  const handlePersonal = (e: React.FormEvent) => {
    e.preventDefault();
    if (!personalName.trim() || !personalId.trim()) {
      toast({ title: "请填写姓名与身份证号", variant: "error" });
      return;
    }
    if (!frontImage || !backImage) {
      toast({ title: "请上传身份证正反面照片", variant: "error" });
      return;
    }
    const fd = new FormData();
    fd.append("type", "personal");
    fd.append("realName", personalName.trim());
    fd.append("idNumber", personalId.trim());
    fd.append("idFront", frontImage.file);
    fd.append("idBack", backImage.file);
    if (handheldImage) fd.append("idHandheld", handheldImage.file);
    void submit(fd, "实名信息已提交");
  };

  const handleEnterprise = (e: React.FormEvent) => {
    e.preventDefault();
    if (!companyName.trim() || !creditCode.trim()) {
      toast({ title: "请填写企业名称与统一社会信用代码", variant: "error" });
      return;
    }
    void submit({ type: "enterprise", companyName: companyName.trim(), creditCode: creditCode.trim() }, "企业认证已提交");
  };

  if (state.loading) {
    return (
      <div className="mx-auto max-w-2xl space-y-6">
        <PageHeader title="实名认证" />
        <Skeleton className="h-64" />
      </div>
    );
  }

  const status =
    STATUS_MAP[identity?.status ?? "unverified"] ?? {
      label: "未认证",
      className: "bg-muted text-muted-foreground",
    };
  const showForm = canSubmit && identity?.status !== "pending";

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <PageHeader title="实名认证" description="购买部分商品前需完成实名认证" />

      {/* 当前状态 */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center justify-between">
            <span className="flex items-center gap-2 text-sm">
              <ShieldCheck className="h-4 w-4 text-primary" />
              认证状态
            </span>
            <span className={`rounded-md px-2 py-0.5 text-xs font-medium ${status.className}`}>
              {status.label}
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-1.5 text-sm">
          {identity && identity.status !== "unverified" ? (
            <>
              <div className="flex justify-between">
                <span className="text-muted-foreground">类型</span>
                <span>{identity.type === "enterprise" ? "企业认证" : "个人认证"}</span>
              </div>
              {identity.realName ? (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">姓名</span>
                  <span>{identity.realName}</span>
                </div>
              ) : null}
              {identity.companyName ? (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">企业名称</span>
                  <span>{identity.companyName}</span>
                </div>
              ) : null}
              {identity.images?.front ? (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">证件照</span>
                  <span>已上传（人工审核可见）</span>
                </div>
              ) : null}
              {identity.status === "rejected" && identity.rejectReason ? (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">驳回原因</span>
                  <span className="text-destructive">{identity.rejectReason}</span>
                </div>
              ) : null}
              {identity.updatedAt ? (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">更新时间</span>
                  <span>{formatDateTime(identity.updatedAt)}</span>
                </div>
              ) : null}
            </>
          ) : (
            <p className="text-muted-foreground">您还未提交实名信息，请选择下方类型进行认证。</p>
          )}
        </CardContent>
      </Card>

      {showForm ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">提交认证</CardTitle>
          </CardHeader>
          <CardContent>
            {identity?.status === "rejected" ? (
              <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">
                驳回原因：{identity.rejectReason || "未说明"}。请核实信息后重新提交。
              </div>
            ) : null}
            <Tabs defaultValue="personal">
              <TabsList className="w-full">
                <TabsTrigger value="personal" className="flex-1">
                  个人认证
                </TabsTrigger>
                <TabsTrigger value="enterprise" className="flex-1">
                  企业认证
                </TabsTrigger>
              </TabsList>

              <TabsContent value="personal">
                <form className="space-y-4" onSubmit={handlePersonal} noValidate>
                  <Field label="真实姓名" htmlFor="id-name">
                    <Input
                      id="id-name"
                      placeholder="与身份证一致"
                      value={personalName}
                      onChange={(e) => setPersonalName(e.target.value)}
                    />
                  </Field>
                  <Field
                    label="身份证号"
                    htmlFor="id-number"
                    hint={
                      ocrChecking ? (
                        <span className="inline-flex items-center gap-1">
                          <Loader2 className="h-3 w-3 animate-spin" /> 正在识别照片中的身份证号…
                        </span>
                      ) : (
                        "仅用于实名审核，系统加密存储、脱敏展示"
                      )
                    }
                  >
                    <Input
                      id="id-number"
                      placeholder="18 位身份证号码"
                      value={personalId}
                      onChange={(e) => setPersonalId(e.target.value)}
                    />
                  </Field>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                    <ImageUpload
                      label="身份证正面照"
                      hint="人像面，JPG/PNG/WebP，≤10MB；上传后自动识别证件号预填"
                      value={frontImage}
                      onChange={(v) => {
                        setFrontImage(v);
                        void checkFrontOcr(v);
                      }}
                      disabled={submitting}
                    />
                    <ImageUpload
                      label="身份证反面照"
                      hint="国徽面，JPG/PNG/WebP，≤10MB"
                      value={backImage}
                      onChange={setBackImage}
                      disabled={submitting}
                    />
                    <ImageUpload
                      label="手持身份证照（选填）"
                      hint="单手持证、免遮挡，JPG/PNG/WebP，≤10MB"
                      value={handheldImage}
                      onChange={setHandheldImage}
                      disabled={submitting}
                    />
                  </div>
                  <div className="flex justify-end">
                    <Button type="submit" disabled={submitting}>
                      {submitting ? "提交中…" : "提交个人认证"}
                    </Button>
                  </div>
                </form>
              </TabsContent>

              <TabsContent value="enterprise">
                <form className="space-y-4" onSubmit={handleEnterprise} noValidate>
                  <Field label="企业名称" htmlFor="ep-name">
                    <Input
                      id="ep-name"
                      placeholder="营业执照上的企业全称"
                      value={companyName}
                      onChange={(e) => setCompanyName(e.target.value)}
                    />
                  </Field>
                  <Field label="统一社会信用代码" htmlFor="ep-code">
                    <Input
                      id="ep-code"
                      placeholder="18 位统一社会信用代码"
                      value={creditCode}
                      onChange={(e) => setCreditCode(e.target.value)}
                    />
                  </Field>
                  <div className="flex justify-end">
                    <Button type="submit" disabled={submitting}>
                      {submitting ? "提交中…" : "提交企业认证"}
                    </Button>
                  </div>
                </form>
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>
      ) : identity?.status === "pending" ? (
        <div className="rounded-lg border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
          实名信息审核中，请耐心等待；审核结果将通过站内通知发送。
        </div>
      ) : null}
    </div>
  );
}