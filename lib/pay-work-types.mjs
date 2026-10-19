export const DEFAULT_PAY_WORK_TYPES = [
  { id: 'onboarding', label: 'Onboarding' },
  { id: 'training', label: 'Training' },
  { id: 'other', label: 'Other work' },
];

export function payWorkTypeLabel(value) {
  if (typeof value !== 'string') throw new Error('Enter a work type name.');
  const label = value.normalize('NFKC').trim().replace(/\s+/g, ' ');
  if (!label || label.length > 60 || /[\u0000-\u001f\u007f]/.test(label)) throw new Error('Use a work type name between 1 and 60 characters.');
  return label;
}
