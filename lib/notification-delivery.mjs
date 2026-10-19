export function deliveryLabel(alert, devices = 0) {
  if (alert.openedAt) return 'Opened';
  if (alert.receivedAt) return 'Received on device';
  if (alert.acceptedAt) return 'Sent · receipt unconfirmed';
  if (alert.retrying) return 'Retrying';
  if (alert.failed) return 'Needs attention';
  if (!devices) return 'No push device';
  if (alert.queued) return 'Queued';
  return 'Delivery unconfirmed';
}
