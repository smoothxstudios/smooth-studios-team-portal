/** Only operational form answers enter the schedule. Payment/contact fields, booking links and team notes stay out. */
export function rentalDetails(description) {
  if (typeof description !== 'string') return '';
  const source = description.replace(/\[Smooth Studios rental team\][\s\S]*?\[\/Smooth Studios rental team\]/g, '')
    .replace(/<br\s*\/?\s*>|<\/p>|<\/div>/gi, '\n').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '').replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/&#39;|&apos;/gi, "'").replace(/&quot;/gi, '"')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g, '');
  const groups = []; let current = null;
  const setup = /studio|backdrop|background|lighting|lights|equipment|photoshoot|photo shoot|video shoot|shoot type|type of shoot|rental|set[ -]?up|props|guests?|people|attendees|participants|special requests?|additional (?:details|information|notes)|anything else|notes|assistance|purpose/i;
  const privateField = /^(?:name|phone|email|price|paid online|calendar|address|payment|card|signature|agree|terms|cancellation|reschedul)|password|token|acuity|https?:\/\//i;
  for (const raw of source.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || /^[-=_]{3,}$/.test(line)) continue;
    if (privateField.test(line)) { current = null; continue; }
    const field = line.match(/^(.{2,220}?):\s*(.*)$/);
    if (field) {
      current = setup.test(field[1]) && !privateField.test(field[1]) ? { label: field[1], lines: field[2] ? [field[2]] : [] } : null;
      if (current) groups.push(current);
    } else if (current && !/form$|^\d{1,2}[:/]\d{2}/i.test(line)) current.lines.push(line);
  }
  return groups.filter(group => group.lines.length).map(group => `${group.label}:\n${group.lines.join('\n')}`).join('\n\n').slice(0, 8000);
}
