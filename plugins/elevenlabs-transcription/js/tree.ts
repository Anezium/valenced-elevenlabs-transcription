// Recherche bornée, sans exécuter de composant ni parcourir de Fiber arbitraire.
export interface ElementLike { type: unknown; props: { children?: unknown; [key: string]: unknown } }
export function findUniqueSheet(root: unknown, type: unknown): ElementLike | undefined {
  const found: ElementLike[] = []; const seen = new Set<object>(); let budget = 300;
  function visit(node: unknown, depth: number) {
    if (--budget < 0 || depth > 20 || !node || typeof node !== 'object' || seen.has(node)) return;
    seen.add(node);
    if (Array.isArray(node)) { for (const child of node) visit(child, depth + 1); return; }
    const item = node as ElementLike;
    if (item.type === type && item.props && typeof item.props === 'object') { found.push(item); return; }
    if (item.props && typeof item.props === 'object') visit(item.props.children, depth + 1);
  }
  visit(root, 0);
  return found.length === 1 && budget >= 0 ? found[0] : undefined;
}
