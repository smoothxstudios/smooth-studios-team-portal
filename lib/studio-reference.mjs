export const STUDIO_INFO_CATEGORIES = ["Contacts", "Access", "Wi-Fi"];

// Keep legacy combined access/Wi-Fi cards while retiring the other reference sections.
export function studioInfoEntries(entries = []) {
  return entries.flatMap(entry => {
    const category = String(entry.category ?? "").trim().toLowerCase();
    let group;
    if (category === "contacts") group = "Contacts";
    else if (["wi-fi", "wifi"].includes(category)) group = "Wi-Fi";
    else if (category === "access") group = "Access";
    else if (category === "access & wi-fi") group = /wi[ -]?fi|network/i.test(entry.label) ? "Wi-Fi" : "Access";
    const label = group === "Contacts" && String(entry.label).trim().toLowerCase() === "studio owner" ? "Smooth" : entry.label;
    return group ? [{ ...entry, category: group, label }] : [];
  });
}
