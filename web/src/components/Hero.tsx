// Home-screen content. App owns the motion: these sit inside motion elements
// that AnimatePresence pops out of the layout while they fade.

export const Hero = () => (
  <div className="flex flex-col items-center text-center font-serif">
    <h1 className="mb-3.5 text-[44px] leading-tight tracking-[1px] md:text-[60px]">Delphi</h1>
    <p className="text-[19px] tracking-[0.3px] text-muted-foreground md:text-[27px]">
      Think Deeper, Clearer, Better
    </p>
  </div>
)

export const HeroCredit = () => (
  <p className="mt-6 text-center text-xs tracking-[0.3px] text-muted-foreground">
    crafted and used by{' '}
    <a
      href="https://jimmyzhang.org"
      target="_blank"
      rel="noopener noreferrer"
      className="transition-colors hover:text-foreground"
    >
      Jimmy Zhang
    </a>
  </p>
)
