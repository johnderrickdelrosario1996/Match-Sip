import React, { useState } from 'react';
import { 
  X, 
  Search, 
  Calendar, 
  Clock, 
  CheckCircle2, 
  Phone, 
  User, 
  ShieldCheck, 
  ExternalLink,
  Database,
  FileText
} from 'lucide-react';
import { ConfirmedBooking } from '../types';
import { getTodayDateString, formatConfirmedTimestamp } from '../utils/dateUtils';

interface ReservationsModalProps {
  isOpen: boolean;
  onClose: () => void;
  bookings: ConfirmedBooking[];
  isLoading: boolean;
}

export const ReservationsModal: React.FC<ReservationsModalProps> = ({
  isOpen,
  onClose,
  bookings,
  isLoading,
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedBookingProof, setSelectedBookingProof] = useState<string | null>(null);

  if (!isOpen) return null;

  const todayStr = getTodayDateString();

  const getStartTime = (b: ConfirmedBooking): string => {
    if (!b.slots || b.slots.length === 0) return '00:00';
    const times: string[] = [];
    for (const s of b.slots) {
      if (s.timeLabel) {
        const match = s.timeLabel.match(/^(\d{1,2}:\d{2})/);
        if (match) {
          const [h, m] = match[1].split(':');
          times.push(`${h.padStart(2, '0')}:${m}`);
        }
      }
    }
    if (times.length === 0) return '00:00';
    times.sort();
    return times[0];
  };

  const filteredBookings = bookings
    .filter((b) => {
      const q = searchTerm.toLowerCase().trim();
      if (!q) return true;
      return (
        b.bookingReference.toLowerCase().includes(q) ||
        b.customer.fullName.toLowerCase().includes(q) ||
        b.customer.phoneNumber.toLowerCase().includes(q) ||
        b.selectedDate.includes(q) ||
        (b.customer?.notes || '').toLowerCase().includes(q)
      );
    })
    .sort((a, b) => {
      const dateA = a.selectedDate || '';
      const dateB = b.selectedDate || '';
      const timeA = getStartTime(a);
      const timeB = getStartTime(b);

      const getRank = (d: string) => {
        if (d === todayStr) return 0;
        if (d > todayStr) return 1;
        return 2;
      };

      const rankA = getRank(dateA);
      const rankB = getRank(dateB);

      if (rankA !== rankB) return rankA - rankB;

      if (rankA === 0) {
        if (timeA !== timeB) return timeA.localeCompare(timeB);
        return (b.createdAt || b.bookingReference).localeCompare(a.createdAt || a.bookingReference);
      }

      if (rankA === 1) {
        if (dateA !== dateB) return dateA.localeCompare(dateB);
        if (timeA !== timeB) return timeA.localeCompare(timeB);
        return (b.createdAt || b.bookingReference).localeCompare(a.createdAt || a.bookingReference);
      }

      // Past
      if (dateA !== dateB) return dateB.localeCompare(dateA);
      if (timeA !== timeB) return timeA.localeCompare(timeB);
      return (b.createdAt || b.bookingReference).localeCompare(a.createdAt || a.bookingReference);
    });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-black/80 backdrop-blur-md overflow-y-auto animate-in fade-in">
      <div className="relative w-full max-w-3xl rounded-3xl border-2 border-[#00C6FF]/50 bg-[#5E2CB2] p-5 sm:p-8 shadow-2xl text-[#FFFFFF] my-8 flex flex-col max-h-[90vh]">
        
        {/* Modal Header */}
        <div className="flex items-start justify-between pb-4 border-b border-[#B3A2DB]/30">
          <div>
            <div className="flex items-center gap-2 text-xs font-black uppercase tracking-widest text-[#00C6FF]">
              <Database className="h-4 w-4 text-[#00C6FF]" />
              <span>CLOUD FIRESTORE DATABASE</span>
              <span className="inline-flex items-center gap-1 rounded-full bg-[#00C6FF]/20 px-2 py-0.5 text-[10px] text-[#00C6FF] border border-[#00C6FF]/40">
                <span className="h-1.5 w-1.5 rounded-full bg-[#00C6FF] animate-ping" /> Real-time Live
              </span>
            </div>
            <h3 className="font-heading text-2xl sm:text-3xl font-black text-[#FFFFFF] mt-1">
              Court Reservations
            </h3>
            <p className="text-xs text-[#B3A2DB] mt-0.5">
              Persistent records of booked slots, player details, and verified InstaPay transactions.
            </p>
          </div>

          <button
            onClick={onClose}
            className="rounded-full p-2 border border-[#B3A2DB]/40 bg-[#5E2CB2] text-[#B3A2DB] hover:text-[#FFFFFF] hover:border-[#00C6FF] transition-colors"
            aria-label="Close database modal"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Search Filter Bar */}
        <div className="py-4">
          <div className="relative">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-[#B3A2DB]" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search by Player Name, Phone (+63), Date, or Ref #..."
              className="w-full rounded-xl border border-[#B3A2DB]/50 bg-[#5E2CB2] pl-10 pr-4 py-2.5 text-xs sm:text-sm font-medium text-[#FFFFFF] placeholder-[#B3A2DB]/60 focus:border-[#00C6FF] focus:outline-none focus:ring-1 focus:ring-[#00C6FF] transition-all"
            />
          </div>
        </div>

        {/* Bookings List Area */}
        <div className="flex-1 overflow-y-auto space-y-3 pr-1 py-1">
          {isLoading ? (
            <div className="py-12 text-center text-xs text-[#B3A2DB] flex flex-col items-center gap-2">
              <div className="h-6 w-6 animate-spin rounded-full border-2 border-[#00C6FF] border-t-transparent" />
              <span>Synchronizing with Cloud Firestore...</span>
            </div>
          ) : filteredBookings.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-[#B3A2DB]/40 p-8 text-center text-[#B3A2DB]">
              <Calendar className="h-8 w-8 mx-auto mb-2 text-[#00C6FF]/60" />
              <p className="text-sm font-bold text-[#FFFFFF]">No reservations found</p>
              <p className="text-xs mt-1">
                {searchTerm ? 'No results match your search filter.' : 'Book a court session in the matrix above to create your first persistent reservation.'}
              </p>
            </div>
          ) : (
            filteredBookings.map((b) => (
              <div
                key={b.bookingReference}
                className="rounded-2xl border border-[#B3A2DB]/35 bg-[#5E2CB2]/90 p-4 sm:p-5 transition-all hover:border-[#00C6FF]/60 shadow-md"
              >
                {/* Top Row: Ref & Verification Badge */}
                <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-[#B3A2DB]/20">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-sm sm:text-base font-extrabold text-[#00C6FF]">
                      #{b.bookingReference}
                    </span>
                    <span className="text-[10px] text-[#B3A2DB] font-mono">
                      • {b.selectedDate}
                    </span>
                  </div>

                  <div className="flex items-center gap-2">
                    <span className="inline-flex items-center gap-1 rounded-md bg-[#00C6FF]/20 px-2.5 py-0.5 text-xs font-bold text-[#00C6FF] border border-[#00C6FF]/40">
                      <CheckCircle2 className="h-3 w-3" />
                      {b.status || 'VERIFIED'}
                    </span>
                    <span className="font-mono text-sm font-extrabold text-[#FFFFFF]">
                      ₱{b.totalAmount} PHP
                    </span>
                  </div>
                </div>

                {/* Middle Row: Customer Info & Slots */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 py-3 text-xs">
                  {/* Customer Info */}
                  <div className="space-y-1.5">
                    <div className="flex items-center gap-2 text-[#FFFFFF]">
                      <User className="h-3.5 w-3.5 text-[#00C6FF]" />
                      <span className="font-bold">{b.customer.fullName}</span>
                    </div>
                    <div className="flex items-center gap-2 text-[#B3A2DB]">
                      <Phone className="h-3.5 w-3.5 text-[#00C6FF]" />
                      <span className="font-mono">{b.customer.phoneNumber}</span>
                    </div>
                    <div className="flex items-center gap-2 text-[#B3A2DB]">
                      <ShieldCheck className="h-3.5 w-3.5 text-[#00C6FF]" />
                      <span>Method: {b.paymentMethod || 'InstaPay QR'}</span>
                    </div>
                    <div className="flex items-center gap-2 text-[#00C6FF]">
                      <Clock className="h-3.5 w-3.5 text-[#00C6FF]" />
                      <span className="font-semibold">{formatConfirmedTimestamp(b.confirmedAt || b.createdAt)}</span>
                    </div>
                  </div>

                  {/* Reserved Slots */}
                  <div>
                    <span className="text-[10px] font-bold uppercase tracking-wider text-[#B3A2DB] block mb-1.5">
                      Reserved Court Slots ({b.slots.length})
                    </span>
                    <div className="flex flex-wrap gap-1.5">
                      {b.slots.map((s, idx) => (
                        <span
                          key={idx}
                          className="inline-flex items-center gap-1 rounded-md bg-[#5E2CB2] px-2 py-1 text-[11px] font-semibold text-[#FFFFFF] border border-[#B3A2DB]/40"
                        >
                          <Clock className="h-3 w-3 text-[#00C6FF]" />
                          {s.courtName}: {s.timeLabel.replace(/\s*-\s*/, '-')}
                        </span>
                      ))}
                    </div>
                  </div>

                  {/* Note / Special Requests */}
                  {b.customer?.notes && b.customer.notes.trim() ? (
                    <div className="mt-2 pt-2 border-t border-[#B3A2DB]/20">
                      <div className="rounded-lg bg-amber-400/10 border border-amber-400/25 p-2 text-xs">
                        <div className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-amber-300 mb-0.5">
                          <FileText className="h-3 w-3 text-amber-400 shrink-0" />
                          <span>Notes / Special Requests:</span>
                        </div>
                        <p className="text-[11px] text-white/90 font-medium leading-relaxed break-words whitespace-pre-wrap pl-4">
                          {b.customer.notes.trim()}
                        </p>
                      </div>
                    </div>
                  ) : null}
                </div>

                {/* Footer proof view if available */}
                {b.paymentProofUrl && (
                  <div className="pt-2 border-t border-[#B3A2DB]/20 flex items-center justify-between text-xs">
                    <span className="text-[11px] text-[#B3A2DB]">InstaPay Receipt Proof Attached</span>
                    <button
                      type="button"
                      onClick={() => setSelectedBookingProof(b.paymentProofUrl || null)}
                      className="text-[11px] font-bold text-[#00C6FF] hover:underline inline-flex items-center gap-1 cursor-pointer"
                    >
                      <ExternalLink className="h-3 w-3" /> View Receipt
                    </button>
                  </div>
                )}
              </div>
            ))
          )}
        </div>

        {/* Modal Footer */}
        <div className="pt-4 border-t border-[#B3A2DB]/30 flex items-center justify-between text-xs text-[#B3A2DB]">
          <span>Total Database Bookings: <strong className="text-[#00C6FF]">{bookings.length}</strong></span>
          <button
            onClick={onClose}
            className="rounded-xl bg-[#00C6FF] px-5 py-2 font-black uppercase text-black hover:bg-[#00C6FF]/90 transition-colors"
          >
            Close
          </button>
        </div>

      </div>

      {/* Nested Receipt Proof Preview Modal */}
      {selectedBookingProof && (
        <div className="fixed inset-0 z-60 flex items-center justify-center p-4 bg-black/90 backdrop-blur-md">
          <div className="relative max-w-sm rounded-2xl bg-[#FFFFFF] p-4 text-black text-center shadow-2xl">
            <button
              onClick={() => setSelectedBookingProof(null)}
              className="absolute top-2 right-2 rounded-full p-1.5 text-gray-500 hover:text-black hover:bg-gray-100"
            >
              <X className="h-5 w-5" />
            </button>
            <h4 className="text-xs font-black uppercase text-[#5E2CB2] mb-2">InstaPay Payment Proof</h4>
            <div className="max-h-96 overflow-hidden rounded-xl border border-gray-200">
              <img
                src={selectedBookingProof}
                alt="Payment proof screenshot"
                className="w-full h-auto object-contain"
              />
            </div>
            <button
              onClick={() => setSelectedBookingProof(null)}
              className="mt-3 w-full rounded-xl bg-[#5E2CB2] py-2 text-xs font-bold text-[#FFFFFF]"
            >
              Back
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
