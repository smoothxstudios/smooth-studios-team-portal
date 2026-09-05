"use client";

import { useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  GitBranch,
  LoaderCircle,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { DashboardPayload } from "@/lib/dashboard-types";

const GITHUB_API = "https://api.github.com";
const GITHUB_API_VERSION = "2022-11-28";

type WorkflowAccess = NonNullable<DashboardPayload["workflowAccess"]>;
type RunnerStage = "confirm" | "validating" | "dispatching" | "queued" | "running" | "success" | "failure";

type GithubUser = { login?: string };
type GithubWorkflowRun = {
  id: number;
  status: "queued" | "in_progress" | "completed" | "waiting" | "requested" | "pending";
  conclusion: string | null;
  created_at: string;
  html_url: string;
  url: string;
  actor?: { login?: string };
};

export type OwnerWorkflowRequest = {
  workflowId: "calendar-sync.yml" | "mark-paid.yml" | "override-payment.yml";
  title: string;
  description: string;
  actionLabel: string;
  inputs?: Record<string, string>;
  details: Array<{ label: string; value: string }>;
};

class GithubRequestError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function responseError(response: Response) {
  let message = "GitHub could not complete this request.";
  try {
    const body = await response.json() as { message?: string };
    if (body.message) message = body.message;
  } catch {
    // GitHub can return an empty body for some errors.
  }
  throw new GithubRequestError(response.status, message);
}

function friendlyError(error: unknown) {
  if (error instanceof DOMException && error.name === "AbortError") return "";
  if (error instanceof GithubRequestError) {
    if (error.status === 401) return "The owner workflow token has expired or was revoked. Replace the GitHub secret, then run one Calendar sync.";
    if (error.status === 403) return "GitHub denied this action. Confirm that the token has Actions: read and write permission for this repository.";
    if (error.status === 404) return "GitHub could not access this workflow. Confirm that the token is limited to this repository and has Actions: read and write permission.";
    if (error.status === 422) return "GitHub rejected one of the workflow values. Close this window, check the selected information, and try again.";
    return `GitHub returned an error (${error.status}): ${error.message}`;
  }
  if (error instanceof Error) return error.message;
  return "The workflow could not be started. Please try again.";
}

function wait(milliseconds: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const onAbort = () => {
      window.clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    };
    const timer = window.setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, milliseconds);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

async function githubFetch(access: WorkflowAccess, path: string, init: RequestInit = {}) {
  const response = await fetch(`${GITHUB_API}${path}`, {
    ...init,
    cache: "no-store",
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${access.accessToken}`,
      "X-GitHub-Api-Version": GITHUB_API_VERSION,
      ...init.headers,
    },
  });
  if (!response.ok) await responseError(response);
  return response;
}

async function validateOwner(access: WorkflowAccess, signal: AbortSignal) {
  const response = await githubFetch(access, "/user", { signal });
  const user = await response.json() as GithubUser;
  if (user.login?.toLowerCase() !== access.allowedLogin.toLowerCase()) {
    throw new Error(`This workflow token belongs to ${user.login ?? "another account"}, not ${access.allowedLogin}.`);
  }
}

async function findDispatchedRun(access: WorkflowAccess, request: OwnerWorkflowRequest, dispatchedAt: number, signal: AbortSignal) {
  const [owner, repository] = access.repository.split("/");
  const path = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}/actions/workflows/${encodeURIComponent(request.workflowId)}/runs?event=workflow_dispatch&branch=main&per_page=10`;

  for (let attempt = 0; attempt < 15; attempt += 1) {
    const response = await githubFetch(access, path, { signal });
    const body = await response.json() as { workflow_runs?: GithubWorkflowRun[] };
    const run = (body.workflow_runs ?? []).find((candidate) =>
      candidate.actor?.login?.toLowerCase() === access.allowedLogin.toLowerCase()
      && new Date(candidate.created_at).getTime() >= dispatchedAt - 15_000,
    );
    if (run) return run;
    await wait(2_000, signal);
  }

  throw new Error("The workflow was accepted, but its live status was not available yet. Check again in a moment.");
}

async function fetchRun(access: WorkflowAccess, apiUrl: string, signal: AbortSignal) {
  const response = await fetch(apiUrl, {
    cache: "no-store",
    signal,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${access.accessToken}`,
      "X-GitHub-Api-Version": GITHUB_API_VERSION,
    },
  });
  if (!response.ok) await responseError(response);
  return response.json() as Promise<GithubWorkflowRun>;
}

export function GithubWorkflowDialog({
  access,
  open,
  onOpenChange,
  request,
}: {
  access?: WorkflowAccess;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  request: OwnerWorkflowRequest | null;
}) {
  const [stage, setStage] = useState<RunnerStage>("confirm");
  const [error, setError] = useState("");
  const [run, setRun] = useState<GithubWorkflowRun | null>(null);
  const controllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!open) return;
    controllerRef.current?.abort();
    setStage("confirm");
    setError("");
    setRun(null);
  }, [open, request]);

  useEffect(() => () => controllerRef.current?.abort(), []);

  const close = (nextOpen: boolean) => {
    if (!nextOpen) controllerRef.current?.abort();
    onOpenChange(nextOpen);
  };

  const start = async () => {
    if (!access || !request) return;
    const controller = new AbortController();
    controllerRef.current?.abort();
    controllerRef.current = controller;
    setError("");
    setRun(null);

    try {
      setStage("validating");
      await validateOwner(access, controller.signal);

      const [owner, repository] = access.repository.split("/");
      const dispatchedAt = Date.now();
      setStage("dispatching");
      const response = await githubFetch(
        access,
        `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}/actions/workflows/${encodeURIComponent(request.workflowId)}/dispatches`,
        {
          method: "POST",
          signal: controller.signal,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ref: "main", inputs: request.inputs ?? {} }),
        },
      );

      let currentRun: GithubWorkflowRun | null = null;
      if (response.status !== 204 && response.headers.get("content-type")?.includes("application/json")) {
        const dispatched = await response.json() as { workflow_run_id?: number; run_url?: string };
        if (dispatched.run_url) currentRun = await fetchRun(access, dispatched.run_url, controller.signal);
      }

      setStage("queued");
      currentRun ??= await findDispatchedRun(access, request, dispatchedAt, controller.signal);
      setRun(currentRun);

      for (let attempt = 0; attempt < 180; attempt += 1) {
        if (currentRun.status === "completed") {
          if (currentRun.conclusion === "success") {
            setStage("success");
            return;
          }
          throw new Error(`The workflow finished with status: ${currentRun.conclusion ?? "unsuccessful"}.`);
        }
        setStage(currentRun.status === "in_progress" ? "running" : "queued");
        await wait(3_000, controller.signal);
        currentRun = await fetchRun(access, currentRun.url, controller.signal);
        setRun(currentRun);
      }

      throw new Error("The workflow is still running. You can close this window and check again later.");
    } catch (caught) {
      const message = friendlyError(caught);
      if (!message) return;
      setError(message);
      setStage("failure");
    }
  };

  const busy = ["validating", "dispatching", "queued", "running"].includes(stage);
  const statusTitle = stage === "validating" ? "Verifying owner access"
    : stage === "dispatching" ? "Sending the workflow"
      : stage === "queued" ? "Workflow queued"
        : "Workflow running";
  const statusCopy = stage === "validating" ? `Confirming this token belongs to ${access?.allowedLogin ?? "Smooth"}.`
    : stage === "dispatching" ? "GitHub is accepting the dashboard request."
      : stage === "queued" ? "GitHub has the request and is preparing the runner."
        : "The update and dashboard deployment are in progress.";

  return (
    <Dialog onOpenChange={close} open={open}>
      <DialogContent className="workflow-dialog" showCloseButton={!busy}>
        {!access ? (
          <>
            <DialogHeader>
              <span className="workflow-dialog-icon warning"><AlertTriangle /></span>
              <DialogTitle>Owner workflow access needs setup</DialogTitle>
              <DialogDescription>Add the repository-only workflow token to GitHub, then run one Calendar sync. No token is included in employee dashboards.</DialogDescription>
            </DialogHeader>
            <DialogFooter><Button onClick={() => close(false)} variant="outline">Close</Button></DialogFooter>
          </>
        ) : stage === "confirm" && request ? (
          <>
            <DialogHeader>
              <span className="workflow-dialog-icon"><GitBranch /></span>
              <p className="eyebrow">Smooth action</p>
              <DialogTitle>{request.title}</DialogTitle>
              <DialogDescription>{request.description}</DialogDescription>
            </DialogHeader>
            <div className="workflow-details">
              {request.details.map((detail) => <div key={detail.label}><span>{detail.label}</span><strong>{detail.value}</strong></div>)}
            </div>
            <div className="workflow-security"><ShieldCheck /><span>Authorized only for <strong>{access.repository}</strong>. The token stays inside this unlocked owner session.</span></div>
            <DialogFooter>
              <Button onClick={() => close(false)} variant="outline">Cancel</Button>
              <Button className="workflow-run-button" onClick={start}>{request.actionLabel}</Button>
            </DialogFooter>
          </>
        ) : busy ? (
          <div aria-live="polite" className="workflow-progress" role="status">
            <span className="workflow-dialog-icon running"><LoaderCircle /></span>
            <p className="eyebrow">GitHub workflow</p>
            <DialogTitle>{statusTitle}</DialogTitle>
            <DialogDescription>{statusCopy}</DialogDescription>
            <div className="workflow-progress-track"><span className={stage} /></div>
            {run && <small>Run #{run.id}</small>}
          </div>
        ) : stage === "success" ? (
          <>
            <div aria-live="polite" className="workflow-progress success" role="status">
              <span className="workflow-dialog-icon success"><CheckCircle2 /></span>
              <p className="eyebrow">Complete</p>
              <DialogTitle>{request?.title} finished</DialogTitle>
              <DialogDescription>The encrypted dashboard data and published portal have been updated. Reload and sign in again to view the latest information.</DialogDescription>
            </div>
            <DialogFooter>
              {run?.html_url && <Button asChild variant="outline"><a href={run.html_url} rel="noreferrer" target="_blank">View details <ExternalLink /></a></Button>}
              <Button className="workflow-run-button" onClick={() => window.location.reload()}><RefreshCw /> Reload dashboard</Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <div aria-live="assertive" className="workflow-progress failure" role="alert">
              <span className="workflow-dialog-icon warning"><AlertTriangle /></span>
              <p className="eyebrow">Action needed</p>
              <DialogTitle>Workflow did not complete</DialogTitle>
              <DialogDescription>{error}</DialogDescription>
            </div>
            <DialogFooter>
              {run?.html_url && <Button asChild variant="outline"><a href={run.html_url} rel="noreferrer" target="_blank">View details <ExternalLink /></a></Button>}
              <Button onClick={() => close(false)} variant="outline">Close</Button>
              <Button className="workflow-run-button" onClick={start}>Try again</Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
