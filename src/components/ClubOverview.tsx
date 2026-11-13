import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Coffee, Shield, Zap, Sparkles, Clock, MapPin, Users, ArrowRight } from 'lucide-react';
import heroCourtImg from '../assets/images/pickleball court.jpg';

export const ClubOverview: React.FC = () => {
  const navigate = useNavigate();

  const clubFeatures = [
    {
      icon: Zap,
      title: 'Pro Acrylic Courts',
      description: 'Two competition-grade courts (Court 01 & 02) engineered with true ball bounce and high-visibility LED night illumination.',
      tag: '08:00 – 23:00',
    },
    {
      icon: Coffee,
      title: 'Craft Coffee & Matcha',
      description: 'Cool down between rallies at our specialty coffee bar serving signature iced americanos, creamy matcha, and electrolyte refreshers.',
      tag: 'Match & Sip Bar',
    },
    {
      icon: Users,
      title: 'Open Play & Community',
      description: 'From first-timers to tournament regulars, join open mixers every Tuesday and Thursday evening or hire professional pro coaching.',
      tag: 'All Skill Levels',
    },
    {
      icon: Shield,
      title: 'Equipment & Rentals',
      description: 'Lightweight carbon fiber paddle rentals, premium outdoor balls, and grip upgrades available at the front desk.',
      tag: 'Rentals Available',
    },
  ];

  return (
    <section id="club-overview" className="relative w-full bg-[#5E2CB2] text-[#FFFFFF] py-16 sm:py-24 border-t border-[#B3A2DB]/30">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        
        {/* Section Header */}
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 pb-12 border-b border-[#B3A2DB]/20">
          <div className="max-w-2xl">
            <div className="flex items-center gap-2 text-xs font-black uppercase tracking-widest text-[#00C6FF]">
              <Sparkles className="h-4 w-4 text-[#00C6FF]" />
              <span>THE MATCH&amp;SIP EXPERIENCE</span>
            </div>
            <h2 className="font-heading text-3xl sm:text-4xl lg:text-5xl font-black uppercase tracking-tight text-[#FFFFFF] mt-2">
              WHERE RALLIES MEET <span className="text-[#00C6FF]">RELAXATION.</span>
            </h2>
            <p className="mt-4 text-sm sm:text-base text-[#B3A2DB] leading-relaxed">
              We built General Santos City's premier pickleball clubhouse for players who love fast kitchen play, great tunes, and cold drinks. Step onto the court, smash your dinks, and sip your coffee with friends.
            </p>
          </div>

          <button
            type="button"
            onClick={() => navigate('/bookings')}
            className="inline-flex items-center gap-2 self-start md:self-auto rounded-full bg-[#00C6FF] px-6 py-3.5 text-xs sm:text-sm font-black uppercase tracking-wider text-black shadow-lg shadow-[#00C6FF]/30 hover:bg-[#00C6FF]/90 transition-all active:scale-95 cursor-pointer shrink-0"
          >
            <span>RESERVE A COURT</span>
            <ArrowRight className="h-4 w-4" />
          </button>
        </div>

        {/* 4 Feature Pillars */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 pt-12">
          {clubFeatures.map((feat) => {
            const Icon = feat.icon;
            return (
              <div
                key={feat.title}
                className="group relative rounded-2xl sm:rounded-3xl border border-[#B3A2DB]/40 bg-[#FFFFFF]/5 p-6 hover:bg-[#FFFFFF]/10 hover:border-[#00C6FF]/60 transition-all duration-300 flex flex-col justify-between"
              >
                <div>
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#00C6FF]/20 text-[#00C6FF] border border-[#00C6FF]/30 group-hover:bg-[#00C6FF] group-hover:text-black transition-colors">
                      <Icon className="h-6 w-6" />
                    </div>
                    <span className="rounded-full bg-[#B3A2DB]/20 px-2.5 py-1 text-[10px] font-black uppercase tracking-wider text-[#00C6FF]">
                      {feat.tag}
                    </span>
                  </div>

                  <h3 className="font-heading text-lg font-black text-[#FFFFFF] mb-2">
                    {feat.title}
                  </h3>
                  <p className="text-xs sm:text-sm text-[#B3A2DB] leading-relaxed">
                    {feat.description}
                  </p>
                </div>
              </div>
            );
          })}
        </div>

        {/* Court Showcase Card & Club Details */}
        <div className="mt-14 rounded-3xl border border-[#B3A2DB]/40 bg-[#FFFFFF]/5 overflow-hidden shadow-2xl">
          <div className="grid grid-cols-1 lg:grid-cols-12 items-center">
            
            <div className="lg:col-span-7 p-6 sm:p-10 lg:p-12 flex flex-col justify-between">
              <div>
                <span className="text-xs font-black uppercase tracking-widest text-[#00C6FF]">
                  CLUB INFORMATION &amp; HOURS
                </span>
                <h3 className="font-heading text-2xl sm:text-3xl font-black text-[#FFFFFF] mt-2 mb-4">
                  VISIT OUR CLUBHOUSE TODAY
                </h3>
                
                <div className="space-y-4 text-xs sm:text-sm text-[#B3A2DB]">
                  <div className="flex items-start gap-3">
                    <MapPin className="h-5 w-5 text-[#00C6FF] shrink-0 mt-0.5" />
                    <div>
                      <strong className="text-[#FFFFFF] block font-bold">Clubhouse Address</strong>
                      <span>Purok 19, Promise Land, Brgy. Mabuhay, General Santos City, South Cotabato</span>
                    </div>
                  </div>

                  <div className="flex items-start gap-3">
                    <Clock className="h-5 w-5 text-[#00C6FF] shrink-0 mt-0.5" />
                    <div>
                      <strong className="text-[#FFFFFF] block font-bold">Operating Hours</strong>
                      <span>Daily from 08:00 AM – 11:00 PM (Night play under LED spotlights)</span>
                    </div>
                  </div>

                  <div className="flex items-start gap-3">
                    <Zap className="h-5 w-5 text-[#00C6FF] shrink-0 mt-0.5" />
                    <div>
                      <strong className="text-[#FFFFFF] block font-bold">Court Pricing</strong>
                      <span>₱150/hr (Off-peak daytime) • ₱200/hr (Prime night-time slots)</span>
                    </div>
                  </div>
                </div>
              </div>

              <div className="mt-8 pt-6 border-t border-[#B3A2DB]/20 flex flex-wrap items-center gap-4">
                <button
                  type="button"
                  onClick={() => navigate('/bookings')}
                  className="rounded-full bg-[#00C6FF] px-7 py-3 text-xs sm:text-sm font-black uppercase tracking-wider text-black shadow-md shadow-[#00C6FF]/30 hover:bg-[#00C6FF]/90 transition-all cursor-pointer"
                >
                  CHECK LIVE SLOTS NOW
                </button>
                <a
                  href="tel:+639666919170"
                  className="text-xs sm:text-sm font-bold text-[#FFFFFF] hover:text-[#00C6FF] transition-colors py-2 px-4"
                >
                  Call +63 966-691-9170
                </a>
              </div>
            </div>

            <div className="lg:col-span-5 h-72 sm:h-96 lg:h-full min-h-[320px] relative">
              <img
                src={heroCourtImg}
                alt="MATCH&SIP Pickleball Court Facility"
                className="w-full h-full object-cover"
                referrerPolicy="no-referrer"
              />
              <div className="absolute inset-0 bg-gradient-to-t lg:bg-gradient-to-l from-transparent via-[#5E2CB2]/30 to-[#5E2CB2]/90 pointer-events-none" />
              <div className="absolute bottom-4 right-4 rounded-xl bg-black/60 backdrop-blur-md px-3 py-1.5 text-[11px] font-bold text-[#FFFFFF] border border-white/20">
                Outdoor Covered Courts
              </div>
            </div>

          </div>
        </div>

      </div>
    </section>
  );
};
