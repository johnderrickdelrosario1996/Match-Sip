import React from 'react';

export const Footer: React.FC = () => {
  return (
    <footer id="club-info" className="w-full bg-[#5E2CB2] text-[#B3A2DB] py-12 sm:py-16 border-t border-[#B3A2DB]/30">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 md:grid-cols-12 gap-8 items-start justify-between">
          
          {/* Left: Brand Description & Copyright */}
          <div className="md:col-span-12 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-2.5">
                <span className="h-2.5 w-2.5 rounded-full bg-[#00C6FF] shadow-sm shadow-[#00C6FF]/60" />
                <span className="font-heading text-xl sm:text-2xl font-black tracking-tight text-[#FFFFFF] uppercase">
                  MATCH&amp;SIP
                </span>
              </div>

              <p className="max-w-md text-xs sm:text-sm text-[#B3A2DB] leading-relaxed font-normal">
                A chill destination for pickleball, where you can have a MATCH while enjoying a SIP of coffee. See you!
              </p>
            </div>

            <span className="text-xs text-[#B3A2DB]/80 font-medium shrink-0 pt-2 sm:pt-0">
              © 2026 MATCH&amp;SIP. Play the lines.
            </span>
          </div>

        </div>
      </div>
    </footer>
  );
};
