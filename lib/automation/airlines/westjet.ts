// ─── WestJet Automation Scripts ───────────────────────────────────────────────
// Playwright step sequences for WestJet self-service portal.
//
// ⚠️  Selectors verified against WestJet's site as of 2025-06.
//     Confidence scores updated by shadow tests + execution history.

import type { AutomationScript } from '../types';

// ─── Cancel Booking ───────────────────────────────────────────────────────────

export const westJetCancelScript: AutomationScript = {
  airline:    'westjet',
  actionType: 'cancel',
  version:    1,
  confidence: 0.80,
  active:     true,
  selectors: {
    manageTripsLink: 'a[href*="manage-trips"], a[href*="my-trips"]',
    bookingRefInput: '#confirmationNumber, input[name*="confirmation"], input[placeholder*="confirmation"]',
    lastNameInput:   '#lastName, input[name*="lastName"], input[placeholder*="last name"]',
    continueBtn:     'button:has-text("Continue"), button:has-text("Find my trip")',
    cancelBtn:       'button:has-text("Cancel"), a:has-text("Cancel booking")',
    confirmBtn:      'button:has-text("Confirm cancellation"), button:has-text("Yes, cancel")',
    successMsg:      '.wj-confirmation, [class*="success"], h1:has-text("Cancelled")',
  },
  steps: [
    {
      type: 'navigate',
      url:  'https://www.westjet.com/en-ca/trips/manage',
    },
    {
      type:        'wait',
      selector:    '#confirmationNumber, input[name*="confirmation"]',
      description: 'Wait for manage trips form',
    },
    {
      type:        'fill',
      selector:    '#confirmationNumber, input[name*="confirmation"]',
      value:       '{{bookingRef}}',
      description: 'Enter confirmation number',
    },
    {
      type:        'fill',
      selector:    '#lastName, input[name*="lastName"]',
      value:       '{{lastName}}',
      description: 'Enter last name',
    },
    {
      type:        'click',
      selector:    'button:has-text("Continue"), button:has-text("Find my trip")',
      description: 'Find trip',
    },
    {
      type:        'wait',
      selector:    'button:has-text("Cancel"), a:has-text("Cancel booking")',
      description: 'Wait for cancel option',
    },
    {
      type:        'click',
      selector:    'button:has-text("Cancel"), a:has-text("Cancel booking")',
      description: 'Click cancel',
    },
    {
      type:        'wait',
      selector:    'button:has-text("Confirm cancellation"), button:has-text("Yes, cancel")',
      description: 'Wait for confirmation dialog',
    },
    {
      type:        'click',
      selector:    'button:has-text("Confirm cancellation"), button:has-text("Yes, cancel")',
      description: 'Confirm cancellation',
    },
    {
      type:        'assert',
      selector:    '.wj-confirmation, [class*="success"], h1:has-text("Cancelled")',
      description: 'Verify cancellation success page',
    },
    { type: 'screenshot', name: 'westjet_cancel_confirmation' },
  ],
};

// ─── Change Date ──────────────────────────────────────────────────────────────

export const westJetChangeDateScript: AutomationScript = {
  airline:    'westjet',
  actionType: 'change_date',
  version:    1,
  confidence: 0.70,
  active:     true,
  selectors: {},
  steps: [
    {
      type: 'navigate',
      url:  'https://www.westjet.com/en-ca/trips/manage',
    },
    { type: 'fill', selector: '#confirmationNumber, input[name*="confirmation"]', value: '{{bookingRef}}' },
    { type: 'fill', selector: '#lastName, input[name*="lastName"]',               value: '{{lastName}}' },
    { type: 'click', selector: 'button:has-text("Continue"), button:has-text("Find my trip")' },
    { type: 'wait',  selector: 'button:has-text("Change"), a:has-text("Change flight")' },
    { type: 'click', selector: 'button:has-text("Change"), a:has-text("Change flight")' },
    { type: 'screenshot', name: 'westjet_change_date_flow' },
  ],
};

export const westJetScripts: Record<string, AutomationScript> = {
  cancel:      westJetCancelScript,
  change_date: westJetChangeDateScript,
};
