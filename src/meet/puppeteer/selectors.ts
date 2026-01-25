/**
 * Google Meet DOM Selectors
 *
 * Extracted for easy maintenance as Meet UI changes.
 * These selectors target the English UI and may need updates.
 */

export const SELECTORS = {
  // Pre-join screen
  nameInput: 'input[aria-label="Your name"]',
  cameraOffButton: '[data-is-muted="false"][aria-label*="camera" i], [aria-label*="Turn off camera" i]',
  micOffButton: '[data-is-muted="false"][aria-label*="microphone" i], [aria-label*="Turn off microphone" i]',
  joinButton: [
    'button[data-idom-class*="join"]',
    'button:has-text("Join now")',
    'button:has-text("Ask to join")',
    '[jsname="Qx7uuf"]', // Common join button jsname
  ].join(", "),

  // Meeting room detection
  meetingRoom: '[data-meeting-code], [data-call-id], [data-meeting-title]',

  // More options menu
  moreOptionsButton: '[aria-label="More options"], [aria-label="More actions"]',

  // Captions toggle (in more options menu or toolbar)
  captionsToggle: [
    '[aria-label*="caption" i]',
    '[data-tooltip*="caption" i]',
    'li[role="menuitem"]:has-text("captions")',
  ].join(", "),

  // Caption display area
  captionContainer: [
    '[data-is-speaker-muted]',
    '.a4cQT',
    '[jscontroller="JFyJpf"]',
    '[jscontroller="D1tHje"]', // Alternative controller
  ].join(", "),

  // Individual caption entries
  captionEntry: '.Mz6pEf, .CNusmb, [data-participant-id]',

  // Speaker name within caption
  speakerName: '.zs7s8d, .YTbUzc, [data-sender-name]',

  // Caption text within entry
  captionText: '.iTTPOb, .D2Au0e, [data-text]',

  // Leave meeting button
  leaveButton: '[aria-label="Leave call"], [data-tooltip="Leave call"]',
} as const;

export type Selectors = typeof SELECTORS;
