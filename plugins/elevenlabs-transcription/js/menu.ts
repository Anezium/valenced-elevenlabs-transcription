// Politique structurelle d’insertion dans le menu natif d’appui long. Pur : aucun import Discord/React.
// L’arbre exact du client propriétaire N’EST PAS établi ; cette politique n’insère que dans un cas
// univoque et refuse sinon, sans ajouter de groupe séparé spéculatif. Vérification appareil requise.
import { findUniqueSheet } from './tree.js';
import type { ElementLike } from './tree.js';

export interface MenuIdentity {
  /** Type React de la feuille (Design.ActionSheet). */
  sheet: unknown;
  /** Types acceptés pour un groupe natif (ActionSheetRow.Group, TableRow.Group, TableRowGroup : alias déclarés par les types vendor). */
  groups: ReadonlySet<unknown>;
  /** Types acceptés pour une ligne native (ActionSheetRow, TableRow). */
  rows: ReadonlySet<unknown>;
}
export type InsertionRefusal = 'sheet' | 'budget' | 'no-group' | 'no-eligible-group' | 'ambiguous';
export type InsertionPlan = { ok: true; group: ElementLike; groups: number } | { ok: false; reason: InsertionRefusal; groups: number };

export function isElementLike(value: unknown): value is ElementLike {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const item = value as { type?: unknown; props?: unknown };
  return item.type !== undefined && item.type !== null && !!item.props && typeof item.props === 'object';
}
/** Aplatit les tableaux imbriqués et retire null/undefined/booléens, comme React pour les enfants. */
export function flattenChildren(children: unknown, out: unknown[] = [], depth = 0): unknown[] {
  if (depth > 8) return out;
  if (Array.isArray(children)) { for (const child of children) flattenChildren(child, out, depth + 1); return out; }
  if (children === null || children === undefined || typeof children === 'boolean') return out;
  out.push(children);
  return out;
}
/**
 * Groupe éligible : uniquement des lignes natives, aucune variante « danger », au moins une action
 * pressable, et support d’icône (hasIcons sur le groupe ou icône sur chaque ligne). Un fragment ou un
 * composant inconnu parmi les enfants rend le groupe inéligible : on ne devine pas sa structure.
 */
export function eligibleGroup(group: ElementLike, rows: ReadonlySet<unknown>): boolean {
  const children = flattenChildren(group.props.children);
  if (!children.length || !children.every(child => isElementLike(child) && rows.has(child.type))) return false;
  const items = children as ElementLike[];
  if (items.some(row => row.props.variant === 'danger')) return false;
  if (!items.some(row => typeof row.props.onPress === 'function')) return false;
  return group.props.hasIcons === true || items.every(row => row.props.icon !== undefined && row.props.icon !== null);
}
/** Groupes structurellement visibles depuis la feuille : traversée de props.children seulement, jamais de rendu de composant ni descente dans un groupe. */
function collectGroups(sheet: ElementLike, groups: ReadonlySet<unknown>): ElementLike[] | undefined {
  const found: ElementLike[] = []; const seen = new Set<object>(); let budget = 300;
  const visit = (node: unknown, depth: number): boolean => {
    if (--budget < 0 || depth > 12) return false;
    if (!node || typeof node !== 'object' || seen.has(node)) return true;
    seen.add(node);
    if (Array.isArray(node)) { for (const child of node) if (!visit(child, depth + 1)) return false; return true; }
    if (!isElementLike(node)) return true;
    if (groups.has(node.type)) { found.push(node); return true; }
    return visit(node.props.children, depth + 1);
  };
  return visit(sheet.props.children, 0) ? found : undefined;
}
export function planInsertion(tree: unknown, identity: MenuIdentity): InsertionPlan {
  const sheet = findUniqueSheet(tree, identity.sheet);
  if (!sheet) return { ok: false, reason: 'sheet', groups: 0 };
  const groups = collectGroups(sheet, identity.groups);
  if (!groups) return { ok: false, reason: 'budget', groups: 0 };
  if (!groups.length) return { ok: false, reason: 'no-group', groups: 0 };
  const eligible = groups.filter(group => eligibleGroup(group, identity.rows));
  if (!eligible.length) return { ok: false, reason: 'no-eligible-group', groups: groups.length };
  if (eligible.length > 1) return { ok: false, reason: 'ambiguous', groups: groups.length };
  return { ok: true, group: eligible[0]!, groups: groups.length };
}
export const REFUSAL_MESSAGES: Record<InsertionRefusal, string> = {
  sheet: 'Refused: native sheet not found or found more than once; nothing inserted.',
  budget: 'Refused: menu tree too deep or cyclic; nothing inserted.',
  'no-group': 'Refused: no visible native action group; no separate group added.',
  'no-eligible-group': 'Refused: no eligible native group (non-destructive rows with icons); nothing inserted.',
  ambiguous: 'Refused: several eligible native groups; nothing inserted without on-device verification.',
};
