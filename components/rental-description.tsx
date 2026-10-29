export function RentalDescription({ details, showHeading = true, heading = "Rental details" }: { details?: string; showHeading?: boolean; heading?: string }) {
  return <section className="rental-description">{showHeading && <h4>{heading}</h4>}{details?.trim() ? <div className="rental-description-fields">{details.trim().split(/\n\s*\n/).map((part, index) => {
    const split = part.indexOf(":\n");
    return split < 0 ? <p className="rental-form-heading" key={index}>{part}</p> : <dl key={index}><dt>{part.slice(0, split)}</dt><dd>{part.slice(split + 2)}</dd></dl>;
  })}</div> : <p>No rental details were included in the booking.</p>}</section>;
}
