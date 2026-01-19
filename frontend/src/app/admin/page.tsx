"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function AdminPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace("/admin/server");
  }, [router]);

  return (
    <div className="flex h-full items-center justify-center text-zinc-500">
      Redirecting to server dashboard...
    </div>
  );
}
