export const GUIDELINE_TOPICS = [
  "Team & assignments", "Opening & closing", "Rentals & clients", "Equipment & backdrops",
  "Cleaning & reset", "Bookings & payments", "Safety & incidents", "Content & privacy",
];

const topics = {
  "Team & scheduling": "Team & assignments", Communication: "Team & assignments",
  "Opening & access": "Opening & closing", "Closing & handoffs": "Opening & closing",
  "Before the rental": "Rentals & clients", "During the rental": "Rentals & clients",
  "Rental preparation": "Rentals & clients", "Client experience": "Rentals & clients",
  "Timing & extensions": "Rentals & clients", "Customer care": "Rentals & clients",
  Equipment: "Equipment & backdrops", "Equipment & lighting": "Equipment & backdrops", "Backdrops & props": "Equipment & backdrops",
  "After the rental": "Cleaning & reset", "Cleaning & supplies": "Cleaning & reset",
  "Payments & bookings": "Bookings & payments", Emergencies: "Safety & incidents",
};
export const guidelineTopic = value => topics[value] ?? value ?? "General";

// Formatting only: keep amounts, timing, exceptions, and policy decisions intact.
export function tidyGuidelineBody(value) {
  return String(value ?? "").replace(/\r\n?/g, "\n").replace(/\u0000/g, "").trim()
    .split("\n").map(line => {
      let clean = line.replace(/[\t ]+/g, " ").trim();
      if (!clean) return "";
      const links = [];
      clean = clean.replace(/https?:\/\/\S+|[\w.+-]+@[\w.-]+/gi, value => {
        links.push(value);
        return `\uE000${links.length - 1}\uE001`;
      });
      clean = clean.replace(/^[*•]\s+/, "- ")
        .replace(/\bi\b/g, "I").replace(/\bim\b/gi, "I'm")
        .replace(/\bdont\b/gi, "don't").replace(/\bdoesnt\b/gi, "doesn't").replace(/\bshouldnt\b/gi, "shouldn't")
        .replace(/\b(\d+(?:\.\d+)?)\s*mins?\b/gi, (_, n) => `${n} ${Number(n) === 1 ? "minute" : "minutes"}`)
        .replace(/\b(\d+(?:\.\d+)?)\s*hrs?\b/gi, (_, n) => `${n} ${Number(n) === 1 ? "hour" : "hours"}`);
      clean = clean.replace(/^(- |\d+[.)] )?([a-z])/, (_, prefix, first) => `${prefix ?? ""}${first.toUpperCase()}`);
      // Leave URLs, email addresses and existing punctuation untouched.
      if (!/[.!?:;]$/.test(clean) && !links.length) clean += ".";
      return clean.replace(/\uE000(\d+)\uE001/g, (_, index) => links[Number(index)]);
    }).join("\n").replace(/\n{3,}/g, "\n\n");
}

export function needsGuidelineAnswer(body) {
  const answer = String(body ?? "").toLowerCase().trim().replace(/[.!?]+$/, "").replace(/[’']/g, "");
  return !answer || /^(?:idk|i dont know(?: yet| right now)?|(?:(?:im|i am) )?not sure(?: yet)?|unsure|tbd|to be (?:decided|determined)|skip(?: for now)?|ask me later|no answer yet|not decided(?: yet)?|(?:ill |i will )?answer later)$/.test(answer);
}

export function organizeGuideline(entry) {
  const formatted = tidyGuidelineBody(entry.body);
  return { ...entry, title: entry.title.trim(), category: guidelineTopic(entry.category), body: formatted.length <= 5000 ? formatted : entry.body.trim() };
}

export function topicOrder(a, b) {
  const left = GUIDELINE_TOPICS.indexOf(a), right = GUIDELINE_TOPICS.indexOf(b);
  return (left < 0 ? 99 : left) - (right < 0 ? 99 : right) || a.localeCompare(b);
}
