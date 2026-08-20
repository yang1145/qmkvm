"use client";

import { useState } from "react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslations } from "next-intl";
import { CheckCircle2, Loader2, XCircle } from "lucide-react";
import { z } from "zod";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type Status = "idle" | "loading" | "success" | "error";

/** 联系销售表单（PRD 9.1）：RHF + Zod 双重校验，服务端 API 处理 */
export function ContactForm() {
  const t = useTranslations("form");
  const needTypes = t.raw("needTypes") as string[];
  const [status, setStatus] = useState<Status>("idle");

  const formSchema = z.object({
    name: z.string().min(1, t("required")),
    email: z.email(t("emailInvalid")),
    company: z.string().optional(),
    needType: z.string().optional(),
    scale: z.string().optional(),
    message: z.string().optional(),
    privacy: z.boolean().refine((v) => v === true, t("privacyRequired")),
  });

  type FormValues = z.infer<typeof formSchema>;

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: "",
      email: "",
      company: "",
      needType: "",
      scale: "",
      message: "",
      privacy: false,
    },
  });

  const onSubmit = async (values: FormValues) => {
    setStatus("loading");
    try {
      const res = await fetch("/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      });
      if (!res.ok) throw new Error("request failed");
      setStatus("success");
      form.reset();
    } catch {
      setStatus("error");
    }
  };

  const { errors } = form.formState;

  return (
    <form
      onSubmit={form.handleSubmit(onSubmit)}
      className="rounded-lg border border-border bg-card p-6 sm:p-8"
      noValidate
    >
      <h3 className="text-xl font-semibold">{t("title")}</h3>
      <p className="mt-1.5 text-sm text-muted-foreground">{t("subtitle")}</p>

      <div className="mt-7 grid gap-5 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="contact-name">
            {t("name")}
            <span className="text-destructive"> *</span>
          </Label>
          <Input
            id="contact-name"
            placeholder={t("namePlaceholder")}
            autoComplete="name"
            aria-invalid={!!errors.name}
            {...form.register("name")}
          />
          {errors.name ? (
            <p role="alert" className="text-xs text-destructive">
              {errors.name.message}
            </p>
          ) : null}
        </div>

        <div className="space-y-2">
          <Label htmlFor="contact-email">
            {t("email")}
            <span className="text-destructive"> *</span>
          </Label>
          <Input
            id="contact-email"
            type="email"
            placeholder={t("emailPlaceholder")}
            autoComplete="email"
            aria-invalid={!!errors.email}
            {...form.register("email")}
          />
          {errors.email ? (
            <p role="alert" className="text-xs text-destructive">
              {errors.email.message}
            </p>
          ) : null}
        </div>

        <div className="space-y-2">
          <Label htmlFor="contact-company">{t("company")}</Label>
          <Input
            id="contact-company"
            placeholder={t("companyPlaceholder")}
            autoComplete="organization"
            {...form.register("company")}
          />
        </div>

        <div className="space-y-2">
          <Label>{t("needType")}</Label>
          <Controller
            control={form.control}
            name="needType"
            render={({ field }) => (
              <Select value={field.value} onValueChange={field.onChange}>
                <SelectTrigger>
                  <SelectValue placeholder={t("needTypePlaceholder")} />
                </SelectTrigger>
                <SelectContent>
                  {needTypes.map((type) => (
                    <SelectItem key={type} value={type}>
                      {type}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          />
        </div>

        <div className="space-y-2 sm:col-span-2">
          <Label htmlFor="contact-scale">{t("scale")}</Label>
          <Input
            id="contact-scale"
            placeholder={t("scalePlaceholder")}
            {...form.register("scale")}
          />
        </div>

        <div className="space-y-2 sm:col-span-2">
          <Label htmlFor="contact-message">{t("message")}</Label>
          <Textarea
            id="contact-message"
            placeholder={t("messagePlaceholder")}
            {...form.register("message")}
          />
        </div>
      </div>

      <div className="mt-6 space-y-2">
        <label className="flex items-start gap-2.5 text-sm text-muted-foreground">
          <input
            type="checkbox"
            className="mt-0.5 h-4 w-4 shrink-0 rounded border-border accent-primary"
            aria-invalid={!!errors.privacy}
            {...form.register("privacy")}
          />
          <span>
            {t("privacy")}
            <span className="text-destructive"> *</span>
          </span>
        </label>
        {errors.privacy ? (
          <p role="alert" className="text-xs text-destructive">
            {errors.privacy.message}
          </p>
        ) : null}
      </div>

      <div className="mt-7">
        <Button
          type="submit"
          size="lg"
          disabled={status === "loading"}
          className={cn("w-full sm:w-auto", status === "success" && "bg-emerald-600")}
        >
          {status === "loading" ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              {t("submitting")}
            </>
          ) : status === "success" ? (
            <>
              <CheckCircle2 className="h-4 w-4" />
              {t("success")}
            </>
          ) : (
            t("submit")
          )}
        </Button>

        {status === "success" ? (
          <p
            role="status"
            className="mt-3 flex items-center gap-1.5 text-sm font-medium text-emerald-600"
          >
            <CheckCircle2 className="h-4 w-4" />
            {t("success")}
          </p>
        ) : null}
        {status === "error" ? (
          <p
            role="alert"
            className="mt-3 flex items-center gap-1.5 text-sm font-medium text-destructive"
          >
            <XCircle className="h-4 w-4" />
            {t("error")}
          </p>
        ) : null}
      </div>
    </form>
  );
}
