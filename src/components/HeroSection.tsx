import React from 'react';
import courtHeroImg from '../assets/images/pickleball court.jpg';

interface HeroSectionProps {
  onQuickBookSubmit: () => void;
}

export const HeroSection: React.FC<HeroSectionProps> = ({ onQuickBookSubmit }) => {
  return (
    <section className="relative overflow-hidden bg-[#5E2CB2] pt-8 pb-12 sm:pt-12 sm:pb-16 lg:pt-16 lg:pb-20 text-[#FFFFFF]">
      {/* Subtle neutral depth without competing neon cyan orbs */}
      <div className="pointer-events-none absolute top-1/3 right-0 h-[400px] w-[500px] rounded-full bg-white/[0.04] blur-[120px]" />

      {/* Main Container - Aligns with max-w-7xl header */}
      <div className="relative mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        {/* 
          Two-Column Responsive Grid Layout:
          - Mobile / Tablet (< lg): Single column stacked layout (text on top, image below)
          - Desktop (lg:): Side-by-side two-column grid aligned at the same vertical level
        */}
        <div className="grid grid-cols-1 items-center gap-8 lg:grid-cols-12 lg:gap-12">
          
          {/* ============================================================
              LEFT COLUMN (lg:col-span-5): Subtitle, Headline, and Copy
              ============================================================ */}
          <div className="flex flex-col items-start gap-4 sm:gap-6 lg:col-span-5">
            {/* Sub-heading / Eyebrow */}
            <div className="font-bold tracking-widest uppercase text-[#B3A2DB]">
              <span className="text-[16px]">THE COURT AWAITS</span>
            </div>

            {/* Large Bold Stacked Headline */}
            <h1 className="font-heading text-6xl sm:text-7xl md:text-8xl lg:text-[108px] font-black uppercase tracking-tight text-[#FFFFFF] leading-[0.95]">
              PLAY<br />
              <span className="text-[#00C6FF]">TODAY.</span>
            </h1>

            {/* Description Paragraph */}
            <p className="max-w-xl text-[16px] font-[Arial,sans-serif] font-normal leading-relaxed text-[#B3A2DB]">
              Reserve your court in 30 seconds. Chill experience, night-game lighting, open play sessions all day, every day, and coffee breaks!
            </p>
          </div>

          {/* ============================================================
              RIGHT COLUMN (lg:col-span-7): Court Image & Frosted Glass Card
              Placed directly beside the text at the same vertical level on desktop
              ============================================================ */}
          <div className="lg:col-span-7">
            {/* Relative Image Container to anchor the absolute Quick Book card */}
            <div className="group relative w-full overflow-hidden rounded-2xl sm:rounded-3xl border border-white/20 bg-white/5 shadow-2xl">
              
              {/* Court Image (LCP Prioritized) */}
              <img
                src={courtHeroImg}
                alt="MATCH&SIP Pickleball Court"
                width={800}
                height={480}
                fetchPriority="high"
                decoding="async"
                className="h-[300px] sm:h-[400px] lg:h-[480px] w-full object-cover object-center transition-transform duration-700 ease-out group-hover:scale-105"
                referrerPolicy="no-referrer"
              />

              {/* Bottom gradient overlay to guarantee readable contrast */}
              <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent" />

              {/* 
                Translucent Overlay Card:
                Clean solid/translucent card with high readability
              */}
              <div className="absolute bottom-3 sm:bottom-6 left-3 sm:left-6 right-3 sm:right-6">
                <div className="flex items-center justify-between gap-4 rounded-xl sm:rounded-2xl border border-white/20 bg-black/50 px-4 py-3 sm:px-6 sm:py-4 backdrop-blur-md shadow-2xl">
                  
                  {/* Left info inside glass card */}
                  <div className="flex flex-col">
                    <span className="text-[10px] sm:text-xs font-bold uppercase tracking-widest text-[#B3A2DB]">
                      QUICK BOOK
                    </span>
                    <span className="text-[11px] sm:text-xs text-white/70">
                      Next available
                    </span>
                    <span className="font-heading text-sm sm:text-base lg:text-xl font-extrabold text-[#FFFFFF]">
                      Court 1 and 2
                    </span>
                  </div>

                  {/* Action CTA Button */}
                  <button
                    type="button"
                    id="hero-book-now-btn"
                    onClick={onQuickBookSubmit}
                    className="cursor-pointer shrink-0 rounded-full bg-[#00C6FF] px-5 sm:px-7 py-2.5 sm:py-3 text-xs sm:text-sm font-black uppercase tracking-wider text-black shadow-lg shadow-[#00C6FF]/30 transition-all hover:bg-[#00C6FF]/90 hover:scale-105 active:scale-95"
                  >
                    BOOK NOW
                  </button>
                </div>
              </div>

            </div>
          </div>

        </div>
      </div>
    </section>
  );
};
