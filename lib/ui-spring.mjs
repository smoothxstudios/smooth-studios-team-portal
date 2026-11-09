/** Exact critically damped spring step; retarget without discarding velocity. */
export function stepSpring(position, velocity, target, elapsed, response = .32) {
  const omega = 2 * Math.PI / response;
  const offset = position - target;
  const impulse = velocity + omega * offset;
  const decay = Math.exp(-omega * Math.min(elapsed, .064));
  const dt = Math.min(elapsed, .064);
  return { position: target + (offset + impulse * dt) * decay, velocity: (velocity - omega * impulse * dt) * decay };
}
export function shouldDismissSheet(position, velocity, height) {
  // A deliberate upward release reverses the dismissal, even after a long drag.
  if (velocity < -120) return false;
  return position > Math.min(180, height * .35) || (velocity > 450 && position > 24 && position + velocity * .2 > height * .3);
}
