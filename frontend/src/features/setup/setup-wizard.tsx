"use client";

import { useState, useEffect } from "react";
import { Check, AlertCircle, Loader2, ChevronRight } from "lucide-react";
import { requestJson } from "@/shared/api/api-client";
import { Button } from "@/shared/ui/button";

type SetupStep = "health" | "admin" | "email" | "backup" | "dns" | "complete";

type SystemHealth = {
  ok: boolean;
  checks: Array<{
    name: string;
    status: "pass" | "fail" | "warn";
    message?: string;
  }>;
  nameservers?: string[];
  dnsBackend?: string;
  rootDomain?: string;
  rootDomainNameservers?: string[];
};

export function SetupWizard({ onComplete }: { onComplete: () => void }) {
  const [currentStep, setCurrentStep] = useState<SetupStep>("health");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [health, setHealth] = useState<SystemHealth | null>(null);
  const [skipped, setSkipped] = useState<Set<SetupStep>>(new Set());

  useEffect(() => {
    const checkHealth = async () => {
      setLoading(true);
      try {
        const data = await requestJson<SystemHealth>("/system/tools/status");
        setHealth(data);
      } catch (err) {
        setError("Failed to check system health");
      } finally {
        setLoading(false);
      }
    };
    checkHealth();
  }, []);

  const steps: Array<{
    id: SetupStep;
    title: string;
    description: string;
    canSkip: boolean;
  }> = [
    {
      id: "health",
      title: "System Health",
      description: "Verify all services are running",
      canSkip: false,
    },
    {
      id: "admin",
      title: "Admin Account",
      description: "Verify root admin access",
      canSkip: false,
    },
    {
      id: "email",
      title: "Email Configuration",
      description: "Configure mail service settings",
      canSkip: true,
    },
    {
      id: "backup",
      title: "Backup Settings",
      description: "Configure backup retention",
      canSkip: true,
    },
    {
      id: "dns",
      title: "DNS Provider",
      description: "Configure DNS backend",
      canSkip: true,
    },
    {
      id: "complete",
      title: "Setup Complete",
      description: "Ready to manage accounts",
      canSkip: false,
    },
  ];

  const handleSkip = () => {
    if (steps.find((s) => s.id === currentStep)?.canSkip) {
      setSkipped((prev) => new Set([...prev, currentStep]));
      const nextStepId = steps[steps.findIndex((s) => s.id === currentStep) + 1]
        ?.id as SetupStep;
      setCurrentStep(nextStepId || "complete");
    }
  };

  const handleComplete = async () => {
    try {
      await requestJson("/system/setup/mark-complete", { method: "POST" });
      onComplete();
    } catch (err) {
      setError("Failed to mark setup as complete");
    }
  };

  const currentStepData = steps.find((s) => s.id === currentStep);
  const currentIndex = steps.findIndex((s) => s.id === currentStep);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="w-full max-w-2xl rounded-xl border border-zinc-800 bg-zinc-950 shadow-2xl">
        {/* Header */}
        <div className="border-b border-zinc-800 bg-gradient-to-r from-zinc-900 to-zinc-900/50 px-8 py-6">
          <h2 className="text-2xl font-bold text-zinc-50">
            Welcome to Npanel
          </h2>
          <p className="mt-2 text-sm text-zinc-400">
            Let's set up your control plane
          </p>
        </div>

        {/* Progress Bar */}
        <div className="px-8 py-6">
          <div className="mb-6">
            <div className="flex items-center gap-2">
              {steps.map((step, idx) => (
                <div key={step.id} className="flex items-center">
                  <div
                    className={`flex h-8 w-8 items-center justify-center rounded-full text-xs font-semibold ${
                      idx < currentIndex
                        ? "bg-emerald-600/20 text-emerald-400"
                        : idx === currentIndex
                          ? "bg-blue-600/20 text-blue-400"
                          : "bg-zinc-800 text-zinc-500"
                    }`}
                  >
                    {idx < currentIndex ? (
                      <Check className="h-4 w-4" />
                    ) : (
                      idx + 1
                    )}
                  </div>
                  {idx < steps.length - 1 && (
                    <div
                      className={`mx-2 h-1 w-12 ${
                        idx < currentIndex ? "bg-emerald-600/20" : "bg-zinc-800"
                      }`}
                    />
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Step Content */}
          <div className="mb-8 min-h-[300px] rounded-lg border border-zinc-800 bg-zinc-900/50 p-6">
            {currentStep === "health" && (
              <HealthCheckStep health={health} loading={loading} />
            )}
            {currentStep === "admin" && <AdminVerifyStep />}
            {currentStep === "email" && <EmailConfigStep />}
            {currentStep === "backup" && <BackupConfigStep />}
            {currentStep === "dns" && <DNSConfigStep />}
            {currentStep === "complete" && <CompleteStep />}
          </div>

          {error && (
            <div className="mb-6 rounded-lg border border-red-500/20 bg-red-500/10 p-4 text-sm text-red-400">
              <div className="flex items-start gap-3">
                <AlertCircle className="h-5 w-5 flex-shrink-0 mt-0.5" />
                <span>{error}</span>
              </div>
            </div>
          )}

          {/* Buttons */}
          <div className="flex items-center justify-between">
            <div className="text-xs text-zinc-500">
              Step {currentIndex + 1} of {steps.length}
            </div>
            <div className="flex gap-3">
              {currentStepData?.canSkip && currentStep !== "complete" && (
                <Button variant="ghost" onClick={handleSkip}>
                  Skip
                </Button>
              )}
              {currentStep === "complete" ? (
                <Button
                  variant="default"
                  onClick={handleComplete}
                  className="gap-2"
                >
                  Start Using Npanel
                  <ChevronRight className="h-4 w-4" />
                </Button>
              ) : (
                <Button
                  variant="default"
                  onClick={() => {
                    const nextIdx = currentIndex + 1;
                    if (nextIdx < steps.length) {
                      setCurrentStep(steps[nextIdx].id);
                    }
                  }}
                  className="gap-2"
                >
                  Next <ChevronRight className="h-4 w-4" />
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function HealthCheckStep({
  health,
  loading,
}: {
  health: SystemHealth | null;
  loading: boolean;
}) {
  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-blue-400" />
      </div>
    );
  }

  if (!health) {
    return (
      <div className="text-sm text-red-400">Failed to check system health</div>
    );
  }

  return (
    <div className="space-y-4">
      <h3 className="font-semibold text-zinc-50">System Health Check</h3>
      <div className="space-y-3">
        {health.checks.map((check) => (
          <div key={check.name} className="flex items-start gap-3">
            <div
              className={`mt-0.5 h-2 w-2 rounded-full ${
                check.status === "pass"
                  ? "bg-emerald-500"
                  : check.status === "warn"
                    ? "bg-yellow-500"
                    : "bg-red-500"
              }`}
            />
            <div>
              <div className="text-sm font-medium text-zinc-200">
                {check.name}
              </div>
              {check.message && (
                <div className="text-xs text-zinc-400">{check.message}</div>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* DNS/Nameserver Configuration */}
      <div className="mt-6 rounded-lg border border-zinc-700 bg-zinc-900/50 p-4">
        <div className="mb-3 text-sm font-semibold text-zinc-50">
          Nameserver Configuration
        </div>
        <div className="space-y-4 text-xs text-zinc-400">
          {/* DNS Backend */}
          {health.dnsBackend && (
            <div>
              <span className="font-medium text-zinc-300">DNS Backend:</span>{" "}
              {health.dnsBackend}
            </div>
          )}

          {/* System Nameservers */}
          <div className="border-t border-zinc-700 pt-3">
            <div className="font-medium text-zinc-300 mb-2">
              System Nameservers
            </div>
            {health.nameservers && health.nameservers.length > 0 ? (
              <div className="space-y-1 ml-2">
                {health.nameservers.map((ns, idx) => (
                  <div key={idx} className="text-zinc-300 flex items-center gap-2">
                    <span className="text-emerald-400">✓</span> {ns}
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-yellow-400 font-medium">
                ⚠ No system nameservers configured
              </div>
            )}
          </div>

          {/* Root Domain Nameservers */}
          <div className="border-t border-zinc-700 pt-3">
            <div className="font-medium text-zinc-300 mb-2">
              Root Domain Configuration
            </div>
            {health.rootDomain ? (
              <div className="space-y-2 ml-2">
                <div className="text-zinc-300">
                  <span className="text-emerald-400">✓</span> Domain:{" "}
                  <span className="font-mono text-blue-400">{health.rootDomain}</span>
                </div>
                {health.rootDomainNameservers &&
                health.rootDomainNameservers.length > 0 ? (
                  <div>
                    <div className="text-zinc-300 mb-1">
                      <span className="text-emerald-400">✓</span> Nameservers:
                    </div>
                    <div className="space-y-1 ml-4">
                      {health.rootDomainNameservers.map((ns, idx) => (
                        <div key={idx} className="text-zinc-300 font-mono text-sm">
                          {ns}
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="text-yellow-400">
                    ⚠ Root domain has no nameservers configured
                  </div>
                )}
              </div>
            ) : (
              <div className="text-yellow-400 font-medium">
                ⚠ No root domain configured
              </div>
            )}
          </div>
        </div>
      </div>

      {health.ok && (
        <div className="mt-4 rounded-lg bg-emerald-500/10 p-3 text-xs text-emerald-400">
          ✓ All systems operational
        </div>
      )}
    </div>
  );
}

function AdminVerifyStep() {
  return (
    <div className="space-y-4">
      <h3 className="font-semibold text-zinc-50">Admin Account Verified</h3>
      <p className="text-sm text-zinc-400">
        You're logged in as the root administrator. You have full access to all
        system functions.
      </p>
      <div className="rounded-lg bg-blue-500/10 p-4 text-sm text-blue-300">
        <div className="font-medium mb-2">Next Steps:</div>
        <ul className="space-y-1 text-xs">
          <li>• Create your first customer account</li>
          <li>• Set up hosting services</li>
          <li>• Configure email and DNS</li>
        </ul>
      </div>
    </div>
  );
}

function EmailConfigStep() {
  return (
    <div className="space-y-4">
      <h3 className="font-semibold text-zinc-50">Email Configuration</h3>
      <p className="text-sm text-zinc-400">
        Configure your mail service settings for sending notifications and
        managing mailboxes.
      </p>
      <div className="space-y-3">
        <div className="text-xs text-zinc-400">
          You can configure this later in Settings → Mail Services
        </div>
      </div>
    </div>
  );
}

function BackupConfigStep() {
  return (
    <div className="space-y-4">
      <h3 className="font-semibold text-zinc-50">Backup Configuration</h3>
      <p className="text-sm text-zinc-400">
        Set up backup retention policies and schedules for customer accounts.
      </p>
      <div className="space-y-3">
        <div className="text-xs text-zinc-400">
          You can configure this later in Settings → Backup Management
        </div>
      </div>
    </div>
  );
}

function DNSConfigStep() {
  return (
    <div className="space-y-4">
      <h3 className="font-semibold text-zinc-50">DNS Provider Setup</h3>
      <p className="text-sm text-zinc-400">
        Configure your DNS backend (BIND, PowerDNS, or external API).
      </p>
      <div className="space-y-3">
        <div className="text-xs text-zinc-400">
          You can configure this later in Settings → DNS Backend
        </div>
      </div>
    </div>
  );
}

function CompleteStep() {
  return (
    <div className="space-y-6 py-8 text-center">
      <div className="flex justify-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-emerald-500/20 text-emerald-400">
          <Check className="h-8 w-8" />
        </div>
      </div>
      <div>
        <h3 className="text-xl font-semibold text-zinc-50">Setup Complete!</h3>
        <p className="mt-2 text-sm text-zinc-400">
          Your Npanel control plane is ready to use. You can now start creating
          accounts and managing hosting services.
        </p>
      </div>
      <div className="space-y-2 text-xs text-zinc-400">
        <p>Next Steps:</p>
        <ul className="space-y-1">
          <li>→ Create your first customer</li>
          <li>→ Set up hosting packages</li>
          <li>→ Configure system settings</li>
        </ul>
      </div>
    </div>
  );
}
