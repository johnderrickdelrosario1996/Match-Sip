import React, { useState } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { Menu, X, CalendarCheck, MapPin } from 'lucide-react';

interface HeaderProps {
  onPlayTodayClick?: () => void;
  selectedSlotsCount: number;
  onOpenReservationsClick?: () => void;
  savedBookingsCount?: number;
}

export const Header: React.FC<HeaderProps> = ({ 
  onPlayTodayClick, 
  selectedSlotsCount,
  savedBookingsCount,
}) => {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();

  const handlePlayToday = () => {
    setMobileMenuOpen(false);
    if (onPlayTodayClick) {
      onPlayTodayClick();
    } else {
      if (location.pathname !== '/') {
        navigate('/');
        setTimeout(() => {
          const el = document.getElementById('court-matrix-section');
          if (el) el.scrollIntoView({ behavior: 'smooth' });
        }, 100);
      } else {
        const el = document.getElementById('court-matrix-section');
        if (el) el.scrollIntoView({ behavior: 'smooth' });
      }
    }
  };

  return (
    <header className="sticky top-0 z-50 w-full border-b border-[#B3A2DB]/30 bg-[#5E2CB2]/90 backdrop-blur-md transition-all">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
        {/* Left: Logo with electric cyan dot */}
        <Link
          to="/"
          id="header-logo"
          className="group flex items-center gap-2.5 transition-transform duration-150 hover:scale-[1.01]"
        >
          <span className="h-2.5 w-2.5 rounded-full bg-[#00C6FF] shadow-sm shadow-[#00C6FF]/60" />
          <span className="font-heading text-xl font-black tracking-tight text-[#FFFFFF] uppercase">
            MATCH&amp;SIP
          </span>
        </Link>

        {/* Right side: PLAY TODAY cyan pill button + hamburger menu */}
        <div className="flex items-center gap-2 sm:gap-3">
          <button
            type="button"
            id="header-play-today-btn"
            onClick={handlePlayToday}
            className="cursor-pointer rounded-full bg-[#00C6FF] px-4 sm:px-6 py-2 text-xs sm:text-sm font-black uppercase tracking-wider text-black shadow-md shadow-[#00C6FF]/25 transition-all hover:bg-[#00C6FF]/90 hover:shadow-[#00C6FF]/45 active:scale-95 flex items-center gap-1.5"
          >
            <span>PLAY TODAY</span>
            {selectedSlotsCount > 0 && (
              <span className="ml-1 inline-flex h-4 w-4 items-center justify-center rounded-full bg-[#5E2CB2] text-[10px] font-black text-[#00C6FF]">
                {selectedSlotsCount}
              </span>
            )}
          </button>

          <button
            type="button"
            id="mobile-menu-toggle-btn"
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className="flex h-10 w-10 items-center justify-center rounded-full border border-[#B3A2DB]/40 bg-[#5E2CB2] text-[#FFFFFF] hover:border-[#00C6FF] hover:text-[#00C6FF] transition-colors cursor-pointer"
            aria-label="Toggle navigation menu"
          >
            {mobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
      </div>

      {/* Drawer Menu */}
      {mobileMenuOpen && (
        <div className="border-b border-[#B3A2DB]/30 bg-[#5E2CB2]/98 px-6 py-6 backdrop-blur-xl animate-in slide-in-from-top-2 duration-200">
          <div className="mx-auto max-w-7xl flex flex-col gap-4">
            <div className="flex items-center justify-between pb-3 border-b border-[#B3A2DB]/20">
              <span className="text-xs font-bold uppercase tracking-widest text-[#B3A2DB]">Navigation</span>
            </div>

            <Link
              to="/"
              onClick={() => setMobileMenuOpen(false)}
              className="flex items-center justify-between text-left py-2 font-bold text-[#FFFFFF] hover:text-[#B3A2DB] transition-colors cursor-pointer"
            >
              <span className="flex items-center gap-2">
                <CalendarCheck className="h-4 w-4 text-[#B3A2DB]" />
                <span>Court Booking (Home)</span>
              </span>
            </Link>

            <button
              type="button"
              onClick={() => {
                setMobileMenuOpen(false);
                if (location.pathname !== '/') {
                  navigate('/');
                  setTimeout(() => {
                    const el = document.getElementById('find-us');
                    if (el) el.scrollIntoView({ behavior: 'smooth' });
                  }, 120);
                } else {
                  const el = document.getElementById('find-us');
                  if (el) el.scrollIntoView({ behavior: 'smooth' });
                }
              }}
              className="flex items-center justify-between text-left py-2 font-bold text-[#FFFFFF] hover:text-[#B3A2DB] transition-colors cursor-pointer"
            >
              <span className="flex items-center gap-2">
                <MapPin className="h-4 w-4 text-[#B3A2DB]" />
                <span>Find Us &amp; Directions</span>
              </span>
            </button>

            <div className="pt-2">
              <button
                onClick={handlePlayToday}
                className="w-full rounded-xl bg-[#00C6FF] py-3 text-center text-sm font-black uppercase tracking-wider text-black shadow-lg hover:bg-[#00C6FF]/90 transition-colors cursor-pointer"
              >
                RESERVE YOUR COURT
              </button>
            </div>
          </div>
        </div>
      )}
    </header>
  );
};
