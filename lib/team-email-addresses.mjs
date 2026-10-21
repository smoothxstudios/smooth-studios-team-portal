// Keep one account per person while matching all of their Calendar addresses.
export function invitationEmails(value) {
  const emails = [...new Set((typeof value === "string" ? value : "")
    .split(/[,;\r\n]+/).map(email => email.trim().toLowerCase()).filter(Boolean))];
  if (emails.length > 10) throw new Error("Use no more than 10 email addresses per person.");
  if (emails.some(email => email.length > 254 || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email))) {
    throw new Error("Enter valid email addresses, separated by commas.");
  }
  return emails;
}
