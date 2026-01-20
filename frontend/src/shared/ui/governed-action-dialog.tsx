import { useEffect, useMemo, useState } from "react";

export type GovernedConfirmation = {
  intentId: string;
  token: string;
  tokenExpiresAt: string;
  confirmation: {
    module: string;
    action: string;
    targetKind: string;
    targetKey: string;
    impactedSubsystems: string[];
    reversibility: "reversible" | "requires_restore" | "irreversible";
    risk: "Low" | "Medium" | "High";
  };
};

export type GovernedStep = {
  name: string;
  status: "SUCCESS" | "FAILED" | "SKIPPED";
  details?: Record<string, unknown>;
  errorMessage?: string | null;
};

export type GovernedResult<T = unknown> = {
  status: "SUCCESS" | "PARTIAL_SUCCESS" | "FAILED";
  steps: GovernedStep[];
  auditLogId: string;
  result?: T;
};

export function GovernedActionDialog(props: {
  open: boolean;
  title: string;
  confirmation: GovernedConfirmation | null;
  onClose: () => void;
  onConfirm: (intentId: string, token: string) => Promise<GovernedResult<any>>;
}) {
  const { open, title, confirmation, onClose, onConfirm } = props;
  const [isConfirming, setIsConfirming] = useState(false);
  const [result, setResult] = useState<GovernedResult<any> | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setResult(null);
    setError(null);
    setIsConfirming(false);
  }, [open, confirmation?.intentId]);

  const riskClass = useMemo(() => {
    const r = confirmation?.confirmation.risk;
    if (r === "High") return "bg-danger/10 border-danger/20 text-danger";
    if (r === "Medium") return "bg-warning/10 border-warning/20 text-warning";
    return "bg-success/10 border-success/20 text-success";
  }, [confirmation?.confirmation.risk]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
      <div className="bg-surface border border-border rounded-lg shadow-xl w-full max-w-lg overflow-hidden">
        <div className="px-6 py-4 border-b border-border flex justify-between items-center">
          <h3 className="font-semibold text-text-main">{title}</h3>
          <button onClick={onClose} className="text-text-muted hover:text-text-main">
            ✕
          </button>
        </div>

        <div className="p-6 space-y-4">
          {error && (
            <div className="bg-danger/10 border border-danger/20 text-danger px-4 py-2 rounded-[var(--radius-card)] text-sm">
              {error}
            </div>
          )}

          {!confirmation && (
            <div className="text-sm text-text-muted">No confirmation payload available.</div>
          )}

          {confirmation && !result && (
            <>
              <div className={`text-sm border rounded p-3 ${riskClass}`}>
                <div className="font-medium">Risk: {confirmation.confirmation.risk}</div>
                <div className="text-xs mt-1">
                  Reversibility: {confirmation.confirmation.reversibility}
                </div>
              </div>

              <div className="text-sm text-text-muted">
                <div>
                  Action:{" "}
                  <span className="text-text-main">
                    {confirmation.confirmation.module}:{confirmation.confirmation.action}
                  </span>
                </div>
                <div>
                  Target:{" "}
                  <span className="text-text-main">
                    {confirmation.confirmation.targetKind}:{confirmation.confirmation.targetKey}
                  </span>
                </div>
                <div className="mt-2">
                  Impacted subsystems:
                  <div className="mt-1 flex flex-wrap gap-2">
                    {confirmation.confirmation.impactedSubsystems.map((s) => (
                      <span
                        key={s}
                        className="text-xs px-2 py-0.5 rounded bg-surface-hover border border-border text-text-main"
                      >
                        {s}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            </>
          )}

          {result && (
            <div className="space-y-3">
              <div
                className={`text-sm border rounded p-3 ${
                  result.status === "SUCCESS"
                    ? "bg-success/10 border-success/20 text-success"
                    : result.status === "PARTIAL_SUCCESS"
                      ? "bg-warning/10 border-warning/20 text-warning"
                      : "bg-danger/10 border-danger/20 text-danger"
                }`}
              >
                <div className="font-medium">Result: {result.status}</div>
                <div className="text-xs mt-1">Audit log: {result.auditLogId}</div>
              </div>
              <div className="border border-border rounded overflow-hidden">
                <div className="px-3 py-2 text-xs font-medium bg-surface-hover text-text-muted border-b border-border">
                  Executed steps
                </div>
                <div className="p-3 space-y-2">
                  {result.steps.map((s, idx) => (
                    <div key={`${s.name}-${idx}`} className="text-xs">
                      <span className="text-text-main">{s.name}</span>{" "}
                      <span
                        className={`ml-2 ${
                          s.status === "SUCCESS"
                            ? "text-success"
                            : s.status === "SKIPPED"
                              ? "text-text-muted"
                              : "text-danger"
                        }`}
                      >
                        {s.status}
                      </span>
                      {s.errorMessage ? (
                        <div className="text-danger mt-1">{s.errorMessage}</div>
                      ) : null}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          <div className="flex gap-3 justify-end pt-2">
            <button
              type="button"
              onClick={onClose}
              className="btn-secondary"
              disabled={isConfirming}
            >
              {result ? "Close" : "Cancel"}
            </button>
            {!result && (
              <button
                type="button"
                disabled={!confirmation || isConfirming}
                onClick={async () => {
                  if (!confirmation) return;
                  setError(null);
                  setIsConfirming(true);
                  try {
                    const res = await onConfirm(confirmation.intentId, confirmation.token);
                    setResult(res);
                  } catch (e) {
                    setError(e instanceof Error ? e.message : "Action failed");
                  } finally {
                    setIsConfirming(false);
                  }
                }}
                className="btn-primary disabled:opacity-50"
              >
                {isConfirming ? "Executing..." : "Confirm"}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
