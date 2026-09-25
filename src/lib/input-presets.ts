// Input attribute presets — spread onto an <Input> so a phone shows the right keyboard and
// the browser can autofill (.agents/docs/MOBILE_PLAN.md, R5). They don't change how a field
// looks or validates; `type` stays whatever the field already used where noted.
//
//   <Input {...INPUT_MONEY} type="number" step="0.01" … />   // decimal keypad
//   <Input {...INPUT_PHONE} … />                              // phone keypad + autofill

/** Amounts, rates, percentages: the decimal keypad (with a point) instead of full QWERTY. */
export const INPUT_MONEY = { inputMode: "decimal" } as const

/** Whole numbers — nights, guests, counts. */
export const INPUT_INTEGER = { inputMode: "numeric" } as const

export const INPUT_PHONE = { type: "tel", inputMode: "tel", autoComplete: "tel" } as const

export const INPUT_EMAIL = {
  type: "email",
  inputMode: "email",
  autoComplete: "email",
  autoCapitalize: "none",
  autoCorrect: "off",
  spellCheck: false,
} as const

/** Search boxes: "Search" on the keyboard's return key, no autocorrect. */
export const INPUT_SEARCH = { type: "search", enterKeyHint: "search", autoCorrect: "off", autoCapitalize: "none", spellCheck: false } as const
