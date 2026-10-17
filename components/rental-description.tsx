export function RentalDescription({ details }: { details?: string }) {
  return <section className="rental-description"><h4>Rental details</h4><p>{details?.trim() || "No rental setup details were included in the booking."}</p></section>;
}
