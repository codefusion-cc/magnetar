/** Magnetar's mark: a small star, the computer everything falls into, glowing in the look's heat. */
export function BrandMark({ size = 22 }: { size?: number }) {
  const star = Math.round(size * 0.36)
  return (
    <span aria-hidden className="grid shrink-0 place-items-center" style={{ width: size, height: size }}>
      <i className="block rounded-full bg-(--mg-core) shadow-(--mg-halo-small)" style={{ width: star, height: star }} />
    </span>
  )
}
