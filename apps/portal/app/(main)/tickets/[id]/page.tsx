"use client";

import * as React from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { ticketReplySchema } from "@qmkvm/contracts";

import { api } from "@/lib/api";
import { useApiData } from "@/hooks/use-api";
import { formatDateTime } from "@/lib/format";
import { ticketDetailSchema, type TicketDetail } from "@/lib/schemas";
import { TicketPriorityBadge, TicketStatusBadge } from "@/components/status-badge";
import { ErrorState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";

/** 纯文本 → 简单 HTML（转义 + 换行） */
function textToHtml(text: string): string {
  const escaped = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return `<p>${escaped.replace(/\n/g, "<br>")}</p>`;
}

function ReplyBubble({ reply }: { reply: TicketDetail["replies"][number] }) {
  const isStaff = reply.authorType === "staff";
  const isSystem = reply.authorType === "system";
  return (
    <div className={cn("flex", isStaff ? "justify-start" : "justify-end")}>
      <div
        className={cn(
          "max-w-[85%] rounded-lg px-4 py-3 text-sm",
          isStaff
            ? "rounded-tl-sm bg-card"
            : isSystem
              ? "rounded-tr-sm border border-dashed bg-muted/60 text-muted-foreground"
              : "rounded-tr-sm bg-primary/10",
        )}
      >
        <div className="mb-1 flex items-center gap-2 text-xs text-muted-foreground">
          <span className="font-medium text-foreground">{reply.authorName || reply.authorType}</span>
          <span>{formatDateTime(reply.createdAt)}</span>
        </div>
        <div
          className="space-y-1.5 [&_br]:block"
          dangerouslySetInnerHTML={{ __html: reply.contentHtml }}
        />
      </div>
    </div>
  );
}

export default function TicketDetailPage() {
  const params = useParams<{ id: string }>();
  const id = typeof params.id === "string" ? params.id : "";
  const router = useRouter();
  const { toast, success } = useToast();

  const state = useApiData(
    () => api.get(`/tickets/${encodeURIComponent(id)}`, { parse: ticketDetailSchema }),
    [id],
  );
  const ticket = state.data;

  const [replyText, setReplyText] = React.useState("");
  const [replying, setReplying] = React.useState(false);
  const [closing, setClosing] = React.useState(false);

  const handleReply = async () => {
    if (!ticket || !replyText.trim()) return;
    const parsed = ticketReplySchema.safeParse({ contentHtml: textToHtml(replyText.trim()) });
    if (!parsed.success) return;
    setReplying(true);
    try {
      await api.post(`/tickets/${ticket.id}/reply`, parsed.data);
      setReplyText("");
      success("回复已发送");
      state.reload();
    } catch {
      // Toast 已由 api 层弹出
    } finally {
      setReplying(false);
    }
  };

  const handleClose = async () => {
    if (!ticket) return;
    setClosing(true);
    try {
      await api.post(`/tickets/${ticket.id}/close`);
      success("工单已关闭");
      state.reload();
    } catch {
      // Toast 已由 api 层弹出
    } finally {
      setClosing(false);
    }
  };

  if (state.loading) {
    return (
      <div className="mx-auto max-w-3xl space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-24" />
        <Skeleton className="h-24" />
      </div>
    );
  }

  if (state.error || !ticket) {
    return (
      <div className="mx-auto max-w-3xl py-8">
        <ErrorState message={state.error ?? "工单不存在"} onRetry={state.reload} />
      </div>
    );
  }

  const closed = ticket.status === "closed" || ticket.status === "resolved";
  const visibleReplies = ticket.replies.filter((r) => !r.internalNote);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="text-sm text-muted-foreground">
        <Link href="/tickets" className="hover:text-foreground">
          工单支持
        </Link>
        <span className="mx-1.5">/</span>
        <span className="text-foreground">#{ticket.id}</span>
      </div>

      <div>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-xl font-semibold">{ticket.subject}</h1>
          <TicketStatusBadge status={ticket.status} />
          <TicketPriorityBadge priority={ticket.priority} />
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          {ticket.departmentName ? `${ticket.departmentName} · ` : ""}
          创建于 {formatDateTime(ticket.createdAt)}
        </p>
      </div>

      {/* 会话记录 */}
      <div className="space-y-3">
        {visibleReplies.length === 0 ? (
          <Card>
            <CardContent className="py-8 text-center text-sm text-muted-foreground">
              暂无回复，请耐心等待客服处理
            </CardContent>
          </Card>
        ) : (
          visibleReplies.map((reply) => <ReplyBubble key={reply.id} reply={reply} />)
        )}
      </div>

      {/* 回复框 */}
      {closed ? (
        <div className="rounded-lg border border-dashed bg-muted/40 px-4 py-5 text-center text-sm text-muted-foreground">
          工单已{ticket.status === "resolved" ? "解决" : "关闭"}
          ，如仍有问题请
          <Link href="/tickets/new" className="mx-1 text-primary hover:underline">
            提交新工单
          </Link>
        </div>
      ) : (
        <Card>
          <CardContent className="space-y-3 p-5">
            <Textarea
              placeholder="输入回复内容…"
              className="min-h-28"
              maxLength={20000}
              value={replyText}
              onChange={(e) => setReplyText(e.target.value)}
            />
            <div className="flex justify-between">
              <Button
                variant="outline"
                className="text-destructive hover:bg-red-50"
                disabled={closing}
                onClick={() => void handleClose()}
              >
                {closing ? "关闭中…" : "关闭工单"}
              </Button>
              <Button disabled={!replyText.trim() || replying} onClick={() => void handleReply()}>
                {replying ? "发送中…" : "发送回复"}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
