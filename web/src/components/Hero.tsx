// Home-screen title. App owns the motion: it sits inside a motion element that
// AnimatePresence pops out of the layout while it fades.

export const Hero = () => (
  <div className="flex flex-col items-center text-center font-serif">
    <h1 className="mb-3.5 text-[44px] leading-tight tracking-[1px] md:text-[60px]">Delphi</h1>
    <p className="text-[19px] tracking-[0.3px] text-muted-foreground md:text-[27px]">
      Think Deeper, Clearer, Better
    </p>
  </div>
)
