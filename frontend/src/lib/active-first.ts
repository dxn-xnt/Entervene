/** Active options first; preserve the existing order and source array. */
export function activeFirst<T>(items: readonly T[] | null | undefined): T[] {
  const isActive = (item: T) => (item as { is_active?: boolean }).is_active === true;
  return [...(items ?? []).filter(isActive), ...(items ?? []).filter((item) => !isActive(item))];
}
