"use client";

import { useEffect } from "react";

export default function AdminError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-6 text-zinc-200">
      <div className="text-lg font-semibold text-white">Admin page error</div>
      <div className="mt-2 text-sm text-zinc-400">{error.message}</div>
      {error.digest && (
        <div className="mt-2 text-xs text-zinc-500">Digest: {error.digest}</div>
      )}
      {error.stack && (
        <pre className="mt-4 max-h-64 overflow-auto rounded-md border border-zinc-800 bg-black p-4 text-xs text-zinc-300">
          {error.stack}
        </pre>
      )}
      <button
        onClick={() => reset()}
        className="mt-4 rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500"
      >
        Retry
      </button>
    </div>
  );
}

