import React from 'react';
import qrCodeImg from './assets/images/Instagram QR Code.jpg';

export default function MaintenancePage() {
  return (
    <div className="min-h-screen w-full flex flex-col items-center justify-center bg-[#5E2CB2] text-white px-4 text-center">
      {/* Status indicator */}
      <div className="flex items-center gap-2 mb-6 rounded-full bg-[#00C6FF]/10 px-4 py-1.5 border border-[#00C6FF]/30">
        <span className="h-2.5 w-2.5 rounded-full bg-[#00C6FF] animate-pulse shadow-sm shadow-[#00C6FF]" />
        <span className="text-xs font-bold tracking-wider uppercase text-[#00C6FF]">
          System Status
        </span>
      </div>

      {/* Title */}
      <h1 className="text-4xl sm:text-6xl font-black uppercase tracking-tight text-white mb-4">
        MATCH & SIP
      </h1>

      {/* Maintenance message */}
      <p className="text-lg sm:text-xl font-medium text-white/90 max-w-md mb-8">
        MATCH & SIP is under maintenance. We will be back soon! You can book thru the link below:
      </p>

      {/* QR Code Card */}
        <img
          src={qrCodeImg}
          alt="Instagram QR Code"
          className="w-48 h-48 object-contain"
        />

    </div>
  );
}