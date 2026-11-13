import React, { useState, useEffect, useRef } from 'react';
import { MapPin, Clock, Phone, Mail, Navigation, ExternalLink } from 'lucide-react';

export const FindUsSection: React.FC = () => {
  const sectionRef = useRef<HTMLElement>(null);
  const [shouldLoadMap, setShouldLoadMap] = useState<boolean>(false);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          setShouldLoadMap(true);
          observer.disconnect();
        }
      },
      { rootMargin: '300px' }
    );

    if (sectionRef.current) {
      observer.observe(sectionRef.current);
    }

    return () => observer.disconnect();
  }, []);

  // Exact GPS Coordinates: 6°09'54.0"N 125°09'31.6"E (6.165000, 125.158778)
  const coordinatesDms = `6°09'54.0"N 125°09'31.6"E`;
  const latitude = 6.165;
  const longitude = 125.158778;
  const venueLabel = 'Match&Sip';

  const googleMapsUrl = `https://maps.google.com/?q=${latitude},${longitude}+(${encodeURIComponent(venueLabel)})`;
  const wazeUrl = `https://waze.com/ul?ll=${latitude},${longitude}&navigate=yes&zoom=17`;
  // Clean embed map centered precisely on Match&Sip coordinates
  const embedMapUrl = `https://maps.google.com/maps?q=${latitude},${longitude}&t=&z=17&ie=UTF8&output=embed`;

  return (
    <section
      ref={sectionRef}
      id="find-us"
      className="relative w-full border-t border-[#B3A2DB]/30 bg-[#5E2CB2] py-16 sm:py-20 text-[#FFFFFF] overflow-hidden"
    >
      {/* Decorative Background Glows */}
      <div className="pointer-events-none absolute -top-24 left-1/4 h-72 w-72 rounded-full bg-[#00C6FF]/10 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-24 right-1/4 h-80 w-80 rounded-full bg-[#1A0B2E]/60 blur-3xl" />

      <div className="relative mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        {/* Section Header */}
        <div className="mb-10 sm:mb-12">
          <h2 className="font-heading text-3xl sm:text-4xl md:text-5xl font-black uppercase tracking-tight text-[#FFFFFF]">
            FIND OUR COURTS
          </h2>
          <p className="mt-2 text-sm sm:text-base text-[#B3A2DB] max-w-2xl font-normal">
            Visit MATCH&amp;SIP in General Santos City. Drop by for high-intensity rallies on our courts, then unwind with specialty brews and chilled drinks.
          </p>
        </div>

        {/* 2-Column Responsive Layout */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-stretch">
          {/* Left Column: Venue Details & Quick Actions */}
          <div className="lg:col-span-6 flex flex-col justify-between rounded-3xl border border-[#B3A2DB]/30 bg-[#1A0B2E]/50 p-6 sm:p-8 backdrop-blur-xl shadow-2xl">
            <div className="space-y-6">
              {/* Venue Brand & Badge */}
              <div className="flex items-center justify-between pb-4 border-b border-[#B3A2DB]/20">
                <div className="flex items-center gap-3">
                  <span className="h-3 w-3 rounded-full bg-[#00C6FF] shadow-sm shadow-[#00C6FF]/70" />
                  <h3 className="font-heading text-2xl font-black uppercase tracking-tight text-[#FFFFFF]">
                    MATCH&amp;SIP
                  </h3>
                </div>
                <span className="rounded-full bg-[#00C6FF]/15 border border-[#00C6FF]/30 px-3 py-1 text-[11px] font-black uppercase tracking-wider text-[#00C6FF]">
                  Courts 01 &amp; 02
                </span>
              </div>

              {/* Detail Items */}
              <div className="space-y-4">
                {/* Address & Exact GPS Pin */}
                <div className="flex items-start gap-3.5 rounded-2xl border border-white/10 bg-white/[0.04] p-4 transition-colors hover:border-[#00C6FF]/40 hover:bg-white/[0.07]">
                  <div className="h-10 w-10 shrink-0 rounded-xl bg-[#00C6FF]/15 border border-[#00C6FF]/30 flex items-center justify-center text-[#00C6FF] mt-0.5">
                    <MapPin className="h-5 w-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <span className="block text-[11px] font-bold uppercase tracking-wider text-[#B3A2DB]">
                        Court Location &amp; Address
                      </span>
                      <span className="inline-flex items-center gap-1 rounded-md bg-[#00C6FF]/15 border border-[#00C6FF]/30 px-2 py-0.5 text-[10px] font-mono font-black text-[#00C6FF]">
                        <span className="h-1.5 w-1.5 rounded-full bg-[#00C6FF]" />
                        PINNED AT {coordinatesDms}
                      </span>
                    </div>
                    <p className="mt-1 text-sm sm:text-base font-semibold text-[#FFFFFF] leading-snug">
                      Purok 19, Promise Land, Brgy. Mabuhay, General Santos City
                    </p>
                    <p className="mt-1 text-xs text-[#00C6FF] font-medium flex items-center gap-1.5">
                      <span>Venue Marker:</span>
                      <strong className="underline underline-offset-2">Match&amp;Sip</strong>
                      <span className="text-[#B3A2DB]/70">• South Cotabato, Philippines</span>
                    </p>
                  </div>
                </div>

                {/* Operating Hours */}
                <div className="flex items-start gap-3.5 rounded-2xl border border-white/10 bg-white/[0.04] p-4 transition-colors hover:border-[#00C6FF]/40 hover:bg-white/[0.07]">
                  <div className="h-10 w-10 shrink-0 rounded-xl bg-[#00C6FF]/15 border border-[#00C6FF]/30 flex items-center justify-center text-[#00C6FF] mt-0.5">
                    <Clock className="h-5 w-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <span className="block text-[11px] font-bold uppercase tracking-wider text-[#B3A2DB]">
                      Operating Schedule
                    </span>
                    <p className="mt-0.5 text-sm sm:text-base font-semibold text-[#FFFFFF] leading-snug">
                      08:00 – 24:00 (Mon – Sun)
                    </p>
                    <span className="mt-1 inline-flex items-center gap-1.5 text-xs text-[#00C6FF]/90 font-medium">
                      <span className="h-1.5 w-1.5 rounded-full bg-[#00C6FF] animate-pulse" />
                      Open Daily for Advance &amp; Walk-in Plays
                    </span>
                  </div>
                </div>

                {/* Contact Info */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                  <a
                    href="tel:+639666919170"
                    className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.04] p-3.5 transition-all hover:border-[#00C6FF]/40 hover:bg-white/[0.07] group"
                  >
                    <div className="h-9 w-9 shrink-0 rounded-lg bg-[#00C6FF]/15 border border-[#00C6FF]/30 flex items-center justify-center text-[#00C6FF]">
                      <Phone className="h-4 w-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <span className="block text-[10px] font-bold uppercase tracking-wider text-[#B3A2DB]">
                        Phone / SMS
                      </span>
                      <span className="block truncate text-xs sm:text-sm font-bold text-[#FFFFFF] group-hover:text-[#00C6FF] transition-colors">
                        +63 966-691-9170
                      </span>
                    </div>
                  </a>

                  <a
                    href="mailto:matchandsip@gmail.com"
                    className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.04] p-3.5 transition-all hover:border-[#00C6FF]/40 hover:bg-white/[0.07] group"
                  >
                    <div className="h-9 w-9 shrink-0 rounded-lg bg-[#00C6FF]/15 border border-[#00C6FF]/30 flex items-center justify-center text-[#00C6FF]">
                      <Mail className="h-4 w-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <span className="block text-[10px] font-bold uppercase tracking-wider text-[#B3A2DB]">
                        Email Inquiries
                      </span>
                      <span className="block truncate text-xs sm:text-sm font-bold text-[#FFFFFF] group-hover:text-[#00C6FF] transition-colors">
                        matchandsip@gmail.com
                      </span>
                    </div>
                  </a>
                </div>
              </div>
            </div>

            {/* Navigation Action Buttons */}
            <div className="mt-8 pt-6 border-t border-[#B3A2DB]/20">
              <span className="block mb-3 text-xs font-bold uppercase tracking-wider text-[#B3A2DB]">
                Navigate to MATCH&amp;SIP:
              </span>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <a
                  href={googleMapsUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-center gap-2 rounded-xl bg-[#00C6FF] px-5 py-3.5 text-xs sm:text-sm font-black uppercase tracking-wider text-black shadow-lg shadow-[#00C6FF]/25 hover:bg-[#00C6FF]/90 hover:scale-[1.02] active:scale-98 transition-all cursor-pointer"
                >
                  <Navigation className="h-4 w-4 fill-black" />
                  <span>Get Directions</span>
                  <ExternalLink className="h-3.5 w-3.5 opacity-80" />
                </a>

                <a
                  href={wazeUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-center gap-2 rounded-xl border border-[#00C6FF]/50 bg-white/[0.07] px-5 py-3.5 text-xs sm:text-sm font-black uppercase tracking-wider text-[#FFFFFF] hover:border-[#00C6FF] hover:bg-[#00C6FF]/15 hover:text-[#00C6FF] hover:scale-[1.02] active:scale-98 transition-all cursor-pointer"
                >
                  <Navigation className="h-4 w-4 text-[#00C6FF]" />
                  <span>Open in Waze</span>
                  <ExternalLink className="h-3.5 w-3.5 text-[#B3A2DB]" />
                </a>
              </div>
            </div>
          </div>

          {/* Right Column: Interactive Google Map */}
          <div className="lg:col-span-6 flex flex-col min-h-[380px] sm:min-h-[440px] lg:min-h-full">
            <div className="relative flex-1 w-full rounded-3xl border border-[#B3A2DB]/30 bg-[#1A0B2E]/60 p-2 sm:p-2.5 backdrop-blur-xl shadow-2xl overflow-hidden flex flex-col">
              {/* Map Floating Header Tag */}
              <div className="absolute top-4 left-4 z-10 flex items-center gap-2 rounded-full border border-black/30 bg-[#1A0B2E]/90 px-3.5 py-1.5 text-xs font-semibold text-[#FFFFFF] shadow-lg backdrop-blur-md">
                <span className="h-2 w-2 rounded-full bg-[#00C6FF] animate-ping" />
                <span className="text-[11px] font-bold uppercase tracking-wider text-[#00C6FF]">
                  Match&amp;Sip Pin
                </span>
                <span className="text-[#B3A2DB]/70 text-[10px]">|</span>
                <span className="text-[11px] text-[#FFFFFF]/90 font-mono hidden sm:inline">{coordinatesDms}</span>
              </div>

              {/* Interactive Google Map iframe (deferred until scrolled into view) */}
              {shouldLoadMap ? (
                <iframe
                  title="Match&Sip Pin Location Map - 6°09'54.0&quot;N 125°09'31.6&quot;E"
                  src={embedMapUrl}
                  width="100%"
                  height="100%"
                  className="w-full h-full min-h-[360px] sm:min-h-[420px] rounded-2xl border-0 filter contrast-[105%] saturate-[110%]"
                  allowFullScreen={true}
                  loading="lazy"
                  referrerPolicy="no-referrer-when-downgrade"
                />
              ) : (
                <div className="w-full h-full min-h-[360px] sm:min-h-[420px] rounded-2xl flex flex-col items-center justify-center bg-black/30 p-6 text-center">
                  <div className="h-8 w-8 rounded-full border-2 border-[#00C6FF] border-t-transparent animate-spin mb-3" />
                  <span className="text-xs font-bold uppercase tracking-widest text-[#00C6FF]">
                    Loading Venue Map...
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};
