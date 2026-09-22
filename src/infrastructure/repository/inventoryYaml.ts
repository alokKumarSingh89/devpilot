import { parseDocument, stringify } from 'yaml';
import { InventoryFailure } from '../../domain/repository/InventoryFailure';
import { MAX_INVENTORY_BYTES, type Inventory } from '../../domain/repository/inventory';
import { validateInventory } from '../../domain/repository/validateInventory';

export function parseInventoryYaml(text: string): Inventory {
  try {
    if (Buffer.byteLength(text, 'utf8') > MAX_INVENTORY_BYTES) throw new InventoryFailure('INVALID_INVENTORY');
    const document = parseDocument(text, { schema: 'core', version: '1.2', uniqueKeys: true, prettyErrors: false });
    if (document.errors.length || document.warnings.length) throw new InventoryFailure('INVALID_INVENTORY');
    const data: unknown = document.toJS({ maxAliasCount: 0 });
    return validateInventory(data);
  } catch { throw new InventoryFailure('INVALID_INVENTORY'); }
}
export function serializeInventoryYaml(value: Inventory): string {
  const text = stringify(validateInventory(value), { lineWidth: 0 });
  if (Buffer.byteLength(text, 'utf8') > MAX_INVENTORY_BYTES) throw new InventoryFailure('INVALID_INVENTORY');
  return text;
}
