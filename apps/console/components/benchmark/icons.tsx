import type { SVGProps } from "react";

// SCR-601's own glyphs, decoded from the frames' `.html` exports and carried over path for
// path (`scr-601-1280-실행완료`, `-기준미달`, and the base frame). Sizes and colours are the
// frames' — nothing here takes a tint from outside.

type P = SVGProps<SVGSVGElement>;

/** A row the run has not reached: a hollow 3.5px circle at half-white. */
export const RowPendingIcon = (props: P) => (
  <svg {...props} viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
    <circle cx="8" cy="8" r="3.5" stroke="#FCFCFD" strokeOpacity="0.5" />
  </svg>
);

/** A row that came out as expected: the frame's white 16px check. */
export const RowPassIcon = (props: P) => (
  <svg {...props} viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M6.00009 10.7809L3.68676 8.46753C3.42676 8.20753 3.00676 8.20753 2.74676 8.46753C2.48676 8.72753 2.48676 9.14753 2.74676 9.40753L5.53342 12.1942C5.79342 12.4542 6.21342 12.4542 6.47342 12.1942L13.5268 5.14086C13.7868 4.88086 13.7868 4.46086 13.5268 4.20086C13.2668 3.94086 12.8468 3.94086 12.5868 4.20086L6.00009 10.7809Z" fill="#FCFCFD" />
  </svg>
);

/** A row that did not: the block disc in verdict red. */
export const RowFailIcon = (props: P) => (
  <svg {...props} viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M8 1.33398C4.32 1.33398 1.33334 4.32065 1.33334 8.00065C1.33334 11.6807 4.32 14.6673 8 14.6673C11.68 14.6673 14.6667 11.6807 14.6667 8.00065C14.6667 4.32065 11.68 1.33398 8 1.33398ZM2.66667 8.00065C2.66667 5.05398 5.05334 2.66732 8 2.66732C9.23334 2.66732 10.3667 3.08732 11.2667 3.79398L3.79334 11.2673C3.08667 10.3673 2.66667 9.23398 2.66667 8.00065ZM8 13.334C6.76667 13.334 5.63334 12.914 4.73334 12.2073L12.2067 4.73398C12.9133 5.63398 13.3333 6.76732 13.3333 8.00065C13.3333 10.9473 10.9467 13.334 8 13.334Z" fill="#F15B5B" />
  </svg>
);

/** The gate card's 통과 mark — green-600, brighter than the verdict token on the tinted ground. */
export const GatePassIcon = (props: P) => (
  <svg {...props} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M12 2C6.48 2 2 6.48 2 12C2 17.52 6.48 22 12 22C17.52 22 22 17.52 22 12C22 6.48 17.52 2 12 2ZM9.29 16.29L5.7 12.7C5.31 12.31 5.31 11.68 5.7 11.29C6.09 10.9 6.72 10.9 7.11 11.29L10 14.17L16.88 7.29C17.27 6.9 17.9 6.9 18.29 7.29C18.68 7.68 18.68 8.31 18.29 8.7L10.7 16.29C10.32 16.68 9.68 16.68 9.29 16.29Z" fill="#1AD164" />
  </svg>
);

/** The gate card's 미달 mark — a bare cross in red-400. */
export const GateFailIcon = (props: P) => (
  <svg {...props} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M18.3 5.7107C17.91 5.3207 17.28 5.3207 16.89 5.7107L12 10.5907L7.10997 5.7007C6.71997 5.3107 6.08997 5.3107 5.69997 5.7007C5.30997 6.0907 5.30997 6.7207 5.69997 7.1107L10.59 12.0007L5.69997 16.8907C5.30997 17.2807 5.30997 17.9107 5.69997 18.3007C6.08997 18.6907 6.71997 18.6907 7.10997 18.3007L12 13.4107L16.89 18.3007C17.28 18.6907 17.91 18.6907 18.3 18.3007C18.69 17.9107 18.69 17.2807 18.3 16.8907L13.41 12.0007L18.3 7.1107C18.68 6.7307 18.68 6.0907 18.3 5.7107Z" fill="#F67777" />
  </svg>
);

/** The reveal-modal-sized pass mark for the row dialog's title (the frame draws it white). */
export const DialogPassIcon = (props: P) => (
  <svg {...props} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M12 2C6.48 2 2 6.48 2 12C2 17.52 6.48 22 12 22C17.52 22 22 17.52 22 12C22 6.48 17.52 2 12 2ZM9.29 16.29L5.7 12.7C5.31 12.31 5.31 11.68 5.7 11.29C6.09 10.9 6.72 10.9 7.11 11.29L10 14.17L16.88 7.29C17.27 6.9 17.9 6.9 18.29 7.29C18.68 7.68 18.68 8.31 18.29 8.7L10.7 16.29C10.32 16.68 9.68 16.68 9.29 16.29Z" fill="#FCFCFD" />
  </svg>
);

/** The empty column's concentric-rings disc, 40px on a 6% ground. */
export const EmptyTargetIcon = (props: P) => (
  <svg {...props} viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M0 20C0 8.95431 8.95431 0 20 0C31.0457 0 40 8.95431 40 20C40 31.0457 31.0457 40 20 40C8.95431 40 0 31.0457 0 20Z" fill="#FCFCFD" fillOpacity="0.06" />
    <path d="M20 30C18.6167 30 17.3167 29.7375 16.1 29.2125C14.8833 28.6875 13.825 27.975 12.925 27.075C12.025 26.175 11.3125 25.1167 10.7875 23.9C10.2625 22.6833 10 21.3833 10 20C10 18.6167 10.2625 17.3167 10.7875 16.1C11.3125 14.8833 12.025 13.825 12.925 12.925C13.825 12.025 14.8833 11.3125 16.1 10.7875C17.3167 10.2625 18.6167 10 20 10C21.3833 10 22.6833 10.2625 23.9 10.7875C25.1167 11.3125 26.175 12.025 27.075 12.925C27.975 13.825 28.6875 14.8833 29.2125 16.1C29.7375 17.3167 30 18.6167 30 20C30 21.3833 29.7375 22.6833 29.2125 23.9C28.6875 25.1167 27.975 26.175 27.075 27.075C26.175 27.975 25.1167 28.6875 23.9 29.2125C22.6833 29.7375 21.3833 30 20 30ZM20 28C22.2333 28 24.125 27.225 25.675 25.675C27.225 24.125 28 22.2333 28 20C28 17.7667 27.225 15.875 25.675 14.325C24.125 12.775 22.2333 12 20 12C17.7667 12 15.875 12.775 14.325 14.325C12.775 15.875 12 17.7667 12 20C12 22.2333 12.775 24.125 14.325 25.675C15.875 27.225 17.7667 28 20 28ZM20 26C18.3333 26 16.9167 25.4167 15.75 24.25C14.5833 23.0833 14 21.6667 14 20C14 18.3333 14.5833 16.9167 15.75 15.75C16.9167 14.5833 18.3333 14 20 14C21.6667 14 23.0833 14.5833 24.25 15.75C25.4167 16.9167 26 18.3333 26 20C26 21.6667 25.4167 23.0833 24.25 24.25C23.0833 25.4167 21.6667 26 20 26ZM20 24C21.1 24 22.0417 23.6083 22.825 22.825C23.6083 22.0417 24 21.1 24 20C24 18.9 23.6083 17.9583 22.825 17.175C22.0417 16.3917 21.1 16 20 16C18.9 16 17.9583 16.3917 17.175 17.175C16.3917 17.9583 16 18.9 16 20C16 21.1 16.3917 22.0417 17.175 22.825C17.9583 23.6083 18.9 24 20 24ZM20 22C19.45 22 18.9792 21.8042 18.5875 21.4125C18.1958 21.0208 18 20.55 18 20C18 19.45 18.1958 18.9792 18.5875 18.5875C18.9792 18.1958 19.45 18 20 18C20.55 18 21.0208 18.1958 21.4125 18.5875C21.8042 18.9792 22 19.45 22 20C22 20.55 21.8042 21.0208 21.4125 21.4125C21.0208 21.8042 20.55 22 20 22Z" fill="#FCFCFD" />
  </svg>
);

/**
 * The per-type recall ring, 16px. The frame builds it from two fill paths (outer r8, inner
 * r5.6 — a 2.4px ring); a stroke of that thickness on the midline radius draws the same ring
 * and can carry a fraction, which the fill paths cannot.
 */
export function DonutGauge({ value, missed }: { value: number; missed: boolean }) {
  const radius = 6.8;
  const circumference = 2 * Math.PI * radius;
  return (
    <svg viewBox="0 0 16 16" className="size-4 flex-none -rotate-90" aria-hidden>
      <circle cx="8" cy="8" r={radius} fill="none" strokeWidth="2.4" className="stroke-(--primitive-opacity-white-alpha-10)" />
      <circle
        cx="8"
        cy="8"
        r={radius}
        fill="none"
        strokeWidth="2.4"
        strokeDasharray={`${circumference * Math.min(1, Math.max(0, value))} ${circumference}`}
        className={missed ? "stroke-verdict-block" : "stroke-blue-800"}
      />
    </svg>
  );
}
