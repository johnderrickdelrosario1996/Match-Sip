import React, { useRef, useEffect, useState, useCallback } from 'react';

interface PinCodeInputProps {
  pin: string;
  onChange: (newPin: string) => void;
  onSubmit?: (pinToSubmit: string) => void;
  inputRef?: React.RefObject<HTMLInputElement | null>;
  isShaking?: boolean;
  length?: number;
  autoFocus?: boolean;
  id?: string;
  className?: string;
}

export const PinCodeInput: React.FC<PinCodeInputProps> = ({
  pin,
  onChange,
  onSubmit,
  inputRef: externalInputRef,
  isShaking = false,
  length = 4,
  autoFocus = true,
  id = 'admin-pin-input',
  className = '',
}) => {
  const internalInputRef = useRef<HTMLInputElement>(null);
  const activeInputRef = externalInputRef || internalInputRef;

  const containerRef = useRef<HTMLDivElement>(null);
  const slotRefs = useRef<(HTMLDivElement | null)[]>([]);
  const [cursorX, setCursorX] = useState<number>(14);
  const [isFocused, setIsFocused] = useState<boolean>(true);

  // Array of slot indices: [0, 1, 2, 3]
  const slots = Array.from({ length }, (_, i) => i);

  // Compute cursor position relative to circle slots
  const updateCursorPosition = useCallback(() => {
    const currentLength = Math.min(pin.length, length);
    const container = containerRef.current;
    if (!container) return;

    if (currentLength < length) {
      // Position cursor at the left side of slot `currentLength`
      const slotEl = slotRefs.current[currentLength];
      if (slotEl) {
        const slotRect = slotEl.getBoundingClientRect();
        const containerRect = container.getBoundingClientRect();
        // Left edge of the circle (slot is 48px wide, circle is 18px wide -> circle offset is 15px)
        // Cursor sits 4px to the left of the circle
        const circleLeftOffset = (slotRect.width - 18) / 2;
        const targetX = slotRect.left - containerRect.left + circleLeftOffset - 5;
        setCursorX(Math.max(0, targetX));
        return;
      }
    } else {
      // All digits filled: position cursor at the right side of the final circle
      const finalSlotEl = slotRefs.current[length - 1];
      if (finalSlotEl) {
        const slotRect = finalSlotEl.getBoundingClientRect();
        const containerRect = container.getBoundingClientRect();
        const circleRightOffset = (slotRect.width + 18) / 2;
        const targetX = slotRect.left - containerRect.left + circleRightOffset + 5;
        setCursorX(targetX);
        return;
      }
    }

    // Mathematical fallback if DOM rects are not yet available
    // Slot width = 48px, gap = 16px -> step = 64px, initial left offset ~ 13px
    if (currentLength < length) {
      setCursorX(currentLength * 64 + 13);
    } else {
      setCursorX((length - 1) * 64 + 36 + 5);
    }
  }, [pin.length, length]);

  useEffect(() => {
    updateCursorPosition();
  }, [pin, updateCursorPosition]);

  useEffect(() => {
    const handleResize = () => updateCursorPosition();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [updateCursorPosition]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const numeric = e.target.value.replace(/\D/g, '').slice(0, length);
    onChange(numeric);
    if (numeric.length === length && onSubmit) {
      onSubmit(numeric);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace' && pin.length > 0) {
      // Backspace is natively handled by onChange, but this ensures immediate responsive stepping
    } else if (e.key === 'Enter' && onSubmit) {
      onSubmit(pin);
    }
  };

  const handleContainerClick = () => {
    activeInputRef.current?.focus();
    setIsFocused(true);
  };

  return (
    <div
      onClick={handleContainerClick}
      className={`relative flex h-16 sm:h-18 w-full cursor-text items-center justify-center rounded-2xl border transition-all select-none overflow-hidden ${
        isShaking
          ? 'border-red-400 bg-red-500/10 animate-shake'
          : isFocused
          ? 'border-[#00C6FF] bg-black/30 shadow-[0_0_24px_rgba(0,198,255,0.2)] ring-1 ring-[#00C6FF]/40'
          : 'border-[#00C6FF]/60 bg-black/20 hover:border-[#00C6FF]'
      } ${className}`}
    >
      {/* Invisible Real Native Input for Keyboard, Mobile Keypads, and Accessibility */}
      <input
        ref={activeInputRef}
        id={id}
        type="password"
        inputMode="numeric"
        pattern="[0-9]*"
        maxLength={length}
        autoFocus={autoFocus}
        value={pin}
        onChange={handleInputChange}
        onKeyDown={handleKeyDown}
        onFocus={() => setIsFocused(true)}
        onBlur={() => setIsFocused(false)}
        className="absolute inset-0 h-full w-full opacity-0 cursor-text z-20"
        aria-label="4-digit PIN code"
        autoComplete="one-time-code"
      />

      {/* Visual Circles & Dynamic Blinking Cursor Display Container */}
      <div
        ref={containerRef}
        className="relative flex items-center justify-center gap-3 sm:gap-4 px-4 py-2 pointer-events-none z-10"
      >
        {/* The Dynamic Blue Terminal Blinking Cursor (|) - lower vertical placement for baseline harmony */}
        {isFocused && (
          <span
            className="absolute top-1/2 w-[2.5px] sm:w-[3px] h-[34px] sm:h-[38px] rounded-full bg-[#00C6FF] shadow-[0_0_12px_rgba(0,198,255,0.9),0_0_4px_#00C6FF] animate-terminal-cursor transition-transform duration-200 ease-out z-20 pointer-events-none"
            style={{
              left: 0,
              transform: `translate(${cursorX}px, calc(-50% + 5px))`,
            }}
            aria-hidden="true"
          />
        )}

        {/* 4 Circle Slots */}
        {slots.map((index) => {
          const isFilled = index < pin.length;

          return (
            <div
              key={index}
              ref={(el) => {
                slotRefs.current[index] = el;
              }}
              className="relative flex items-center justify-center w-10 sm:w-12 h-10 sm:h-12"
            >
              {/* Circle: unfilled outline or turns solid white when digit entered */}
              <span
                className={`rounded-full transition-all duration-200 ease-out ${
                  isFilled
                    ? 'h-4.5 w-4.5 sm:h-5 sm:w-5 bg-white border-2 border-white shadow-[0_0_12px_rgba(255,255,255,0.95)] scale-110'
                    : 'h-4 w-4 sm:h-4.5 sm:w-4.5 border-2 border-white/35 bg-white/5 scale-100'
                }`}
                aria-label={`Digit slot ${index + 1}: ${isFilled ? 'filled' : 'empty'}`}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
};
