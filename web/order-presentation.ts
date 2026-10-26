/** Rotate only the presentation, leaving the room's persisted order untouched. */
export function turnFirst<T extends { id: string }>(people: T[], currentId: string | undefined): T[] {
  const index = people.findIndex(person => person.id === currentId);
  return index > 0 ? [...people.slice(index), ...people.slice(0, index)] : people;
}

/** Translate one insertion in the rotated view without rotating everyone else's saved order. */
export function canonicalInsertion(canonical: string[], id: string, presented: string[]): string[] {
  const index = presented.indexOf(id);
  if (index < 0 || !canonical.includes(id) || presented.length !== canonical.length ||
      new Set(presented).size !== canonical.length || presented.some(value => !canonical.includes(value))) {
    throw new Error('The participant order changed. Review the order and try again.');
  }
  const ids = canonical.filter(value => value !== id);
  const following = presented[index + 1];
  const previous = presented[index - 1];
  const target = following ? ids.indexOf(following) : previous ? ids.indexOf(previous) + 1 : 0;
  ids.splice(target, 0, id);
  return ids;
}
