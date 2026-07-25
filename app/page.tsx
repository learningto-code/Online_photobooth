import RoomEntry from "@/components/RoomEntry";

export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col items-center justify-center px-6 py-16 text-center">
      <span className="mb-4 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-white/60">
        📸 take photos together, anywhere
      </span>

      <h1 className="bg-gradient-to-r from-pink-300 via-fuchsia-300 to-violet-300 bg-clip-text text-5xl font-black leading-tight tracking-tight text-transparent sm:text-6xl">
        Booth Together
      </h1>

      <p className="mt-5 max-w-xl text-balance text-lg text-white/70">
        A photobooth for you and your people - even when you&apos;re apart. Make a room, share
        the link, and a synced countdown snaps everyone at once into one photo strip. No app,
        no login.
      </p>

      <div className="mt-9">
        <RoomEntry />
      </div>

      <div className="mt-16 grid w-full max-w-2xl gap-4 text-left sm:grid-cols-3">
        <Feature emoji="🫂" title="Together, in sync">
          Share a room link; a shared 3-2-1 fires everyone&apos;s camera at the same moment.
        </Feature>
        <Feature emoji="🎞️" title="Classic strips">
          The real 4-cut layout - four photos in one strip, everyone side-by-side.
        </Feature>
        <Feature emoji="✨" title="Filters & frames">
          Warm film, B&amp;W, soft glow, and colour frames to match the mood.
        </Feature>
      </div>
    </main>
  );
}

function Feature({
  emoji,
  title,
  children,
}: {
  emoji: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
      <div className="text-2xl">{emoji}</div>
      <h3 className="mt-2 text-sm font-semibold">{title}</h3>
      <p className="mt-1 text-xs text-white/55">{children}</p>
    </div>
  );
}
