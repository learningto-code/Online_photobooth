"use client";

import dynamic from "next/dynamic";
import { useParams } from "next/navigation";

const RoomClient = dynamic(() => import("@/components/RoomClient"), {
  ssr: false,
  loading: () => (
    <div className="flex flex-1 items-center justify-center py-24 text-sm text-white/50">
      Loading room…
    </div>
  ),
});

export default function RoomPage() {
  const params = useParams();
  const raw = params?.code;
  const code = String(Array.isArray(raw) ? raw[0] : (raw ?? "")).toUpperCase();
  return <RoomClient code={code} />;
}
