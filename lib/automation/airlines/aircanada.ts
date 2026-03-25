// ─── Air Canada Automation Scripts ───────────────────────────────────────────
// Structured Playwright step sequences for Air Canada self-service portal.
//
// ⚠️  Selectors are verified against Air Canada's site as of 2025-06.
//     Run shadow tests periodically to maintain confidence scores.
//     If a selector breaks, the self-healer (lib/automation/ai/healer.ts)
//     will regenerate it automatically.

import type { AutomationScript } from '../types';

// ─── Cancel Booking ───────────────────────────────────────────────────────────

export const airCanadaCancelScript: AutomationScript = {
  airline:    'air_canada',
  actionType: 'cancel',
  version:    1,
  confidence: 0.85,
  active:     true,
  selectors: {
    manageBookingLink:  'a[href*="manage-booking"], a[href*="my-bookings"]',
    bookingRefInput:    'input[name*="booking"], input[placeholder*="booking"], input[id*="pnr"]',
    lastNameInput:      'input[name*="lastName"], input[name*="last_name"], input[id*="lastName"]',
    findButton:         'button[type="submit"], input[type="submit"]',
    cancelButton:       'button:has-text("Cancel"), a:has-text("Cancel flight")',
    confirmCancelBtn:   'button:has-text("Confirm"), button:has-text("Yes, cancel")',
    confirmationText:   '.confirmation, [class*="confirm"], [class*="success"]',
  },
  steps: [
    {
      type: 'navigate',
      url:  'https://www.aircanada.com/en/ca/aco/home.html#/manage-booking',
    },
    {
      type:        'wait',
      selector:    'input[name*="booking"], input[placeholder*="booking"], input[id*="pnr"]',
      description: 'Wait for booking reference input',
    },
    {
      type:        'fill',
      selector:    'input[name*="booking"], input[placeholder*="booking"], input[id*="pnr"]',
      value:       '{{bookingRef}}',
      description: 'Enter booking reference (PNR)',
    },
    {
      type:        'fill',
      selector:    'input[name*="lastName"], input[name*="last_name"], input[id*="lastName"]',
      value:       '{{lastName}}',
      description: 'Enter passenger last name',
    },
    {
      type:        'click',
      selector:    'button[type="submit"]',
      description: 'Find booking',
    },
    {
      type:        'wait',
      selector:    'button:has-text("Cancel"), a:has-text("Cancel flight")',
      description: 'Wait for cancel option to appear',
    },
    {
      type:        'click',
      selector:    'button:has-text("Cancel"), a:has-text("Cancel flight")',
      description: 'Click cancel flight',
    },
    {
      type:        'wait',
      selector:    'button:has-text("Confirm"), button:has-text("Yes, cancel")',
      description: 'Wait for confirmation dialog',
    },
    {
      type:        'click',
      selector:    'button:has-text("Confirm"), button:has-text("Yes, cancel")',
      description: 'Confirm cancellation',
    },
    {
      type:        'assert',
      selector:    '.confirmation, [class*="confirm"], [class*="success"]',
      description: 'Verify cancellation confirmation page loaded',
    },
    {
      type: 'screenshot',
      name: 'aircanada_cancel_confirmation',
    },
  ],
};

// ─── Change Date ──────────────────────────────────────────────────────────────

export const airCanadaChangeDateScript: AutomationScript = {
  airline:    'air_canada',
  actionType: 'change_date',
  version:    1,
  confidence: 0.75,
  active:     true,
  selectors: {
    changeFlightBtn: 'button:has-text("Change flight"), a:has-text("Change")',
    dateInput:       'input[type="date"], .date-picker input',
    searchBtn:       'button:has-text("Search"), button[type="submit"]',
  },
  steps: [
    {
      type: 'navigate',
      url:  'https://www.aircanada.com/en/ca/aco/home.html#/manage-booking',
    },
    {
      type:  'fill',
      selector: 'input[name*="booking"], input[placeholder*="booking"], input[id*="pnr"]',
      value:    '{{bookingRef}}',
    },
    {
      type:     'fill',
      selector: 'input[name*="lastName"], input[id*="lastName"]',
      value:    '{{lastName}}',
    },
    { type: 'click', selector: 'button[type="submit"]' },
    { type: 'wait',  selector: 'button:has-text("Change flight"), a:has-text("Change")' },
    { type: 'click', selector: 'button:has-text("Change flight"), a:has-text("Change")' },
    { type: 'wait',  selector: 'input[type="date"], .date-picker input' },
    { type: 'fill',  selector: 'input[type="date"], .date-picker input', value: '{{newDate}}' },
    { type: 'click', selector: 'button:has-text("Search"), button[type="submit"]' },
    { type: 'screenshot', name: 'aircanada_change_date_results' },
  ],
};

export const airCanadaScripts: Record<string, AutomationScript> = {
  cancel:      airCanadaCancelScript,
  change_date: airCanadaChangeDateScript,
};
