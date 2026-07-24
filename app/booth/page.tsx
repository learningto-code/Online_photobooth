"use client";

import dynamic from "next/dynamic";

// The booth touches getUserMedia / canvas / AudioContext, so it must only run
// in the browser — never server-rendered.
const Booth = dynamic(() => import("@/components/Booth"), {
  ssr: false,
  loading: () => (
    <div className="flex flex-1 items-center justify-center py-24 text-sm text-white/50">
      Loading the booth…
    </div>
  ),
});

export default function BoothPage() {
  return <Booth />;
}
