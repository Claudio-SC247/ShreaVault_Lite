import { ShareViewer } from "@/components/share-viewer";

type SharePageProps = {
  params: Promise<{ token: string }>;
};

export default async function SharePage({ params }: SharePageProps) {
  const { token } = await params;

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-5xl flex-col gap-6 px-4 py-8 sm:px-6">
      <header>
        <p className="text-sm font-semibold uppercase text-pine">ShareVault Lite</p>
        <h2 className="mt-1 text-2xl font-semibold text-ink">Archivo compartido</h2>
      </header>
      <ShareViewer token={token} />
    </main>
  );
}
