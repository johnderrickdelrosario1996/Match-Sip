import React from 'react';
import { CheckCircle2, X, MapPin, Download, Sparkles, Clock } from 'lucide-react';
import { ConfirmedBooking } from '../types';
import { formatConfirmedTimestamp } from '../utils/dateUtils';

interface BookingSuccessModalProps {
  booking: ConfirmedBooking | null;
  onClose: () => void;
}

export const BookingSuccessModal: React.FC<BookingSuccessModalProps> = ({ booking, onClose }) => {
  if (!booking) return null;

  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 bg-black/80 backdrop-blur-md overflow-y-auto">
      <div className="relative w-full max-w-lg rounded-3xl border-2 border-[#00C6FF]/60 bg-[#5E2CB2] p-6 sm:p-8 shadow-2xl text-[#FFFFFF] my-8">
        
        {/* Close Button */}
        <button
          onClick={onClose}
          className="absolute top-5 right-5 p-2 rounded-full border border-[#B3A2DB]/40 bg-[#5E2CB2] text-[#B3A2DB] hover:text-[#FFFFFF] hover:border-[#00C6FF] transition-colors"
          aria-label="Close confirmation modal"
        >
          <X className="h-5 w-5" />
        </button>

        {/* Success Icon Header */}
        <div className="text-center">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-[#00C6FF]/20 text-[#00C6FF] border border-[#00C6FF]/50 shadow-lg shadow-[#00C6FF]/25 mb-4">
            <CheckCircle2 className="h-9 w-9 stroke-[2.5]" />
          </div>
          <span className="inline-flex items-center gap-1 text-xs font-black tracking-widest text-[#00C6FF] uppercase">
            <Sparkles className="h-3.5 w-3.5" /> RESERVATION CONFIRMED
          </span>
          <h3 className="font-heading text-2xl sm:text-3xl font-extrabold text-[#FFFFFF] mt-1">
            See You on the Kitchen!
          </h3>
          <p className="text-xs sm:text-sm text-[#B3A2DB] mt-1">
            Your booking request has been received! Please wait for our booking confirmation via text message. We look forward to seeing you at MATCH &amp; SIP! 💜
          </p>
        </div>

        {/* Ticket Card */}
        <div className="mt-6 rounded-2xl border border-[#B3A2DB]/40 bg-[#5E2CB2] p-5 relative overflow-hidden">
          {/* Reference badge */}
          <div className="flex items-center justify-between pb-3 border-b border-[#B3A2DB]/30">
            <div>
              <span className="text-[10px] font-bold uppercase tracking-wider text-[#B3A2DB] block">
                Booking Reference
              </span>
              <span className="font-mono text-base font-extrabold text-[#00C6FF] tracking-wider">
                #{booking.bookingReference}
              </span>
            </div>
            <div className="text-right">
              <span className="text-[10px] font-bold uppercase tracking-wider text-[#B3A2DB] block">
                Status
              </span>
              <span className="inline-flex items-center gap-1 rounded-md bg-[#00C6FF]/20 px-2 py-0.5 text-xs font-bold text-[#00C6FF] border border-[#00C6FF]/40">
                Payment Verified
              </span>
            </div>
          </div>

          {/* Player & Court Info */}
          <div className="py-3 space-y-2 text-xs">
            <div className="flex justify-between">
              <span className="text-[#B3A2DB]">Player Name:</span>
              <span className="font-bold text-[#FFFFFF]">{booking.customer.fullName}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-[#B3A2DB]">Mobile:</span>
              <span className="font-mono font-medium text-[#FFFFFF]">{booking.customer.phoneNumber}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-[#B3A2DB]">Reservation Date:</span>
              <span className="font-bold text-[#FFFFFF]">{booking.selectedDate}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-[#B3A2DB] flex items-center gap-1">
                <Clock className="h-3 w-3 text-[#00C6FF]" />
                <span>Confirmed At:</span>
              </span>
              <span className="font-mono font-semibold text-[#00C6FF]">
                {formatConfirmedTimestamp(booking.confirmedAt || booking.createdAt)}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-[#B3A2DB]">Total Paid:</span>
              <span className="font-mono font-extrabold text-[#00C6FF] text-sm">
                ₱{booking.totalAmount.toLocaleString()} PHP
              </span>
            </div>
          </div>

          {/* Reserved Slots list */}
          <div className="pt-3 border-t border-[#B3A2DB]/30">
            <span className="text-[10px] font-bold uppercase tracking-wider text-[#B3A2DB] block mb-2">
              Reserved Court Sessions
            </span>
            <div className="space-y-1.5">
              {booking.slots.map((s, idx) => (
                <div
                  key={idx}
                  className="flex items-center justify-between rounded-lg bg-[#5E2CB2] px-3 py-2 border border-[#B3A2DB]/40 text-xs"
                >
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-[#00C6FF]">{s.courtName}</span>
                    <span className="text-[#B3A2DB] font-mono">{s.timeLabel.replace(/\s*-\s*/, '-')}</span>
                  </div>
                  <span className="font-mono font-semibold text-[#FFFFFF]">₱{s.price}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Location badge */}
          <div className="mt-4 pt-3 border-t border-[#B3A2DB]/30 flex items-center gap-2 text-xs text-[#B3A2DB]">
            <MapPin className="h-4 w-4 text-[#00C6FF] shrink-0" />
            <span>Purok 19, Promise Land, Brgy. Mabuhay, G.S.C.</span>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="mt-6 flex flex-col sm:flex-row items-center gap-3">
          <button
            onClick={handlePrint}
            className="w-full sm:w-auto flex-1 flex items-center justify-center gap-2 rounded-xl border border-[#00C6FF]/60 bg-[#5E2CB2] py-3 text-xs font-bold text-[#00C6FF] hover:bg-[#00C6FF]/20 transition-colors cursor-pointer"
          >
            <Download className="h-4 w-4" />
            <span>SAVE PASS / PRINT</span>
          </button>
          <button
            onClick={onClose}
            className="w-full sm:w-auto flex-1 flex items-center justify-center gap-2 rounded-xl bg-[#00C6FF] py-3 text-xs font-extrabold text-black hover:bg-[#00C6FF]/90 shadow-lg shadow-[#00C6FF]/30 transition-all cursor-pointer"
          >
            <span>DONE / BACK TO APP</span>
          </button>
        </div>

      </div>
    </div>
  );
};
