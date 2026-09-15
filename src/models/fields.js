export const optionalText = value => typeof value === 'string' ? value.trim() || undefined : value == null ? undefined : value;
export const emailField = { type: String, trim: true, lowercase: true, set: optionalText, maxlength: 254, match: /^[^\s@]+@[^\s@]+\.[^\s@]+$/ };
export const phoneField = { type: String, trim: true, set: value => {
  const normalized = optionalText(value);
  if (typeof normalized !== 'string') return normalized;
  const digits = normalized.replace(/[\s()-]/g, '');
  return /^\d+$/.test(digits) ? `+${digits}` : digits;
}, match: /^\+[1-9]\d{6,14}$/ };
export const slugField = { type: String, required: true, trim: true, lowercase: true, maxlength: 180, match: /^[a-z0-9]+(?:-[a-z0-9]+)*$/, unique: true };
export const urlField = { type: String, trim: true, maxlength: 2048, validate: {
  validator: value => { if (!value) return true; try { return ['http:', 'https:'].includes(new URL(value).protocol); } catch { return false; } },
  message: 'Must be an HTTP(S) URL',
} };
