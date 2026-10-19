// Display saved availability descriptions in the same 12-hour format as events.
// Keep the saved text, links, timestamps and already formatted times unchanged.
export function plannerTimeText(text = '') {
  return text.replace(/https?:\/\/\S+|(?<![\w/:])([01]?\d|2[0-3]):([0-5]\d)(?![\w:]|\s*[ap]\.?m\.?\b)/gi, (match, hour, minute) => {
    if (hour === undefined) return match;
    const value = Number(hour);
    return `${value % 12 || 12}:${minute} ${value < 12 ? 'AM' : 'PM'}`;
  });
}
