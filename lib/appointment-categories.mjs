export const APPOINTMENT_CATEGORIES = [
  {
    id: "studio-rentals",
    label: "Studio Rentals",
    patterns: ["studio rental"],
  },
  {
    id: "graduation",
    label: "Graduation",
    patterns: ["graduation", "composite editing package"],
  },
  {
    id: "campaign",
    label: "Campaign",
    patterns: ["campaign"],
  },
  {
    id: "video",
    label: "Video",
    patterns: ["promo video", "event recap package", "music video"],
  },
  {
    id: "business",
    label: "Business",
    patterns: [
      "professional digitals",
      "group photoshoot",
      "product photography",
      "venue photography",
      "professional headshot",
      "corporate headshot",
    ],
  },
  {
    id: "outside",
    label: "Outside",
    patterns: [
      "quick lifestyle portrait",
      "event portrait package",
      "outside portrait package",
      "group portrait package",
      "half day portrait package",
      "full day portrait package",
    ],
  },
  {
    id: "studio-packages",
    label: "Studio Packages",
    patterns: [
      "modeling package",
      "single picture",
      "quick portrait package",
      "beauty headshot",
      "silver portrait package",
      "gold portrait package",
      "platinum portrait package",
    ],
  },
  {
    id: "other",
    label: "Other",
    patterns: [],
  },
];

export function categorizeAppointment(title = "") {
  const normalized = title.toLowerCase().replace(/\s+/g, " ").trim();
  return APPOINTMENT_CATEGORIES.find(
    (category) => category.id !== "other" && category.patterns.some((pattern) => normalized.includes(pattern)),
  ) ?? APPOINTMENT_CATEGORIES[APPOINTMENT_CATEGORIES.length - 1];
}
