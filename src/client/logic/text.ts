export function needsBoundarySpace(text: string, next: string): boolean {
  return text.length > 0 && next.length > 0 && /\S$/u.test(text) && /^\S/u.test(next);
}
