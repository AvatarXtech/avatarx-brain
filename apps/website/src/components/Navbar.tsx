export default function Navbar() {
  return (
    <header className="sticky top-0 z-50 border-b border-zinc-200 bg-[#F6F5F2]/95 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-8">
        <div className="font-semibold tracking-wide">
          AvatarNeuron
        </div>

        <nav className="hidden gap-8 text-sm text-zinc-500 md:flex">
          <a href="#">Capabilities</a>
          <a href="#">Intelligence</a>
          <a href="#">Analytics</a>
          <a href="#">Applications</a>
        </nav>

        <button className="rounded-md border border-zinc-300 px-4 py-2 text-sm">
          Contact
        </button>
      </div>
    </header>
  );
}
